"""The inbox agent: sweep once, or run continuously on an interval."""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field

from .config import Config
from .gmail_client import Email, GmailClient
from .matcher import match_rule
from .responder import build_reply

log = logging.getLogger(__name__)

_NO_REPLY_RE = re.compile(r"^(no[-._]?reply|do[-._]?not[-._]?reply|noreply)", re.IGNORECASE)


@dataclass
class SweepResult:
    scanned: int = 0
    replied: list[str] = field(default_factory=list)  # "sender — subject" lines
    skipped: list[str] = field(default_factory=list)
    dry_run_previews: list[tuple[Email, str]] = field(default_factory=list)


class Agent:
    def __init__(self, config: Config, dry_run: bool = False) -> None:
        self.config = config
        self.dry_run = dry_run
        self.gmail = GmailClient(config.credentials_file, config.token_file)
        # Thread IDs replied to during this process's lifetime (the Gmail label
        # is the durable record; this avoids double replies within one run).
        self._seen_threads: set[str] = set()

    # -- filters --------------------------------------------------------------

    def _should_skip(self, email: Email) -> str | None:
        """Return a human-readable reason to skip, or None to proceed."""
        if email.sender_email == self.gmail.my_address:
            return "own message"
        if email.thread_id in self._seen_threads:
            return "thread already handled this run"
        if self.config.skip_no_reply_senders and _NO_REPLY_RE.match(
            email.sender_email.split("@")[0]
        ):
            return "no-reply sender"
        if self.gmail.has_label(email, self.config.processed_label):
            return "already processed"
        return None

    # -- one sweep ------------------------------------------------------------

    def sweep(self) -> SweepResult:
        result = SweepResult()
        emails = self.gmail.search(self.config.query)
        result.scanned = len(emails)
        log.info("Scanned %d message(s) matching query: %s", len(emails), self.config.query)

        for email in emails:
            if len(result.replied) + len(result.dry_run_previews) >= self.config.max_replies_per_run:
                log.info("Reached max_replies_per_run (%d); stopping sweep",
                         self.config.max_replies_per_run)
                break

            skip_reason = self._should_skip(email)
            if skip_reason:
                result.skipped.append(f"{email.sender_email} — {skip_reason}")
                log.debug("Skip %s: %s", email.sender_email, skip_reason)
                continue

            match = match_rule(email, self.config.rules)
            if not match:
                continue
            rule, keywords = match
            log.info(
                "Match: '%s' from %s (rule '%s', keywords: %s)",
                email.subject, email.sender_email, rule.name, ", ".join(keywords),
            )

            reply = build_reply(email, rule, self.config)
            self._seen_threads.add(email.thread_id)

            if self.dry_run:
                result.dry_run_previews.append((email, reply))
                continue

            self.gmail.send_reply(email, reply)
            self.gmail.mark_processed(
                email, self.config.processed_label, self.config.mark_as_read
            )
            result.replied.append(f"{email.sender} — {email.subject}")
            log.info("Replied to %s", email.sender_email)

        return result

    # -- continuous loop ------------------------------------------------------

    def run_forever(self, interval_seconds: int) -> None:
        log.info("Agent running; checking inbox every %ds. Ctrl-C to stop.", interval_seconds)
        while True:
            try:
                result = self.sweep()
                if result.replied:
                    log.info("Sent %d repl(ies) this cycle", len(result.replied))
            except KeyboardInterrupt:
                raise
            except Exception:  # noqa: BLE001 — keep the agent alive across transient errors
                log.exception("Sweep failed; will retry next cycle")
            time.sleep(interval_seconds)
