"""Thin wrapper around the Gmail API: auth, fetching, labelling, replying."""

from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import parseaddr
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

log = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",  # read + send + labels
]


@dataclass
class Email:
    id: str
    thread_id: str
    subject: str
    sender: str  # full "Name <addr>" form
    sender_email: str  # bare address
    sender_name: str
    body: str
    message_id_header: str  # RFC 822 Message-ID, for threading replies
    references: str


class GmailClient:
    def __init__(self, credentials_file: str, token_file: str) -> None:
        self.credentials_file = credentials_file
        self.token_file = token_file
        self.service = build("gmail", "v1", credentials=self._authenticate())
        self._label_cache: dict[str, str] = {}
        profile = self.service.users().getProfile(userId="me").execute()
        self.my_address: str = profile["emailAddress"].lower()
        log.info("Authenticated as %s", self.my_address)

    # -- auth -----------------------------------------------------------------

    def _authenticate(self) -> Credentials:
        creds: Credentials | None = None
        if Path(self.token_file).exists():
            creds = Credentials.from_authorized_user_file(self.token_file, SCOPES)
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                if not Path(self.credentials_file).exists():
                    raise FileNotFoundError(
                        f"Gmail OAuth client file not found: {self.credentials_file}. "
                        "Download it from Google Cloud Console (see README)."
                    )
                flow = InstalledAppFlow.from_client_secrets_file(
                    self.credentials_file, SCOPES
                )
                creds = flow.run_local_server(port=0)
            with open(self.token_file, "w", encoding="utf-8") as fh:
                fh.write(creds.to_json())
        return creds

    # -- fetching -------------------------------------------------------------

    def search(self, query: str, max_results: int = 50) -> list[Email]:
        resp = (
            self.service.users()
            .messages()
            .list(userId="me", q=query, maxResults=max_results)
            .execute()
        )
        refs = resp.get("messages", [])
        return [self._fetch(m["id"]) for m in refs]

    def _fetch(self, msg_id: str) -> Email:
        msg = (
            self.service.users()
            .messages()
            .get(userId="me", id=msg_id, format="full")
            .execute()
        )
        payload = msg.get("payload", {})
        headers = {h["name"].lower(): h["value"] for h in payload.get("headers", [])}
        sender = headers.get("from", "")
        name, addr = parseaddr(sender)
        return Email(
            id=msg["id"],
            thread_id=msg["threadId"],
            subject=headers.get("subject", "(no subject)"),
            sender=sender,
            sender_email=addr.lower(),
            sender_name=name or addr.split("@")[0],
            body=self._extract_body(payload),
            message_id_header=headers.get("message-id", ""),
            references=headers.get("references", ""),
        )

    @staticmethod
    def _extract_body(payload: dict) -> str:
        """Walk MIME parts, preferring text/plain."""

        def decode(data: str) -> str:
            return base64.urlsafe_b64decode(data.encode()).decode(errors="replace")

        def walk(part: dict, want: str) -> str | None:
            if part.get("mimeType") == want and part.get("body", {}).get("data"):
                return decode(part["body"]["data"])
            for sub in part.get("parts", []) or []:
                found = walk(sub, want)
                if found:
                    return found
            return None

        text = walk(payload, "text/plain")
        if text:
            return text
        html = walk(payload, "text/html")
        if html:
            # crude but dependency-free HTML -> text
            import re

            no_tags = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
            no_tags = re.sub(r"<[^>]+>", " ", no_tags)
            return re.sub(r"\s+", " ", no_tags).strip()
        return ""

    # -- labels ---------------------------------------------------------------

    def _label_id(self, name: str) -> str:
        if name in self._label_cache:
            return self._label_cache[name]
        labels = self.service.users().labels().list(userId="me").execute()["labels"]
        for lb in labels:
            if lb["name"] == name:
                self._label_cache[name] = lb["id"]
                return lb["id"]
        created = (
            self.service.users()
            .labels()
            .create(userId="me", body={"name": name})
            .execute()
        )
        self._label_cache[name] = created["id"]
        return created["id"]

    def has_label(self, email: Email, label_name: str) -> bool:
        msg = (
            self.service.users()
            .messages()
            .get(userId="me", id=email.id, format="minimal")
            .execute()
        )
        return self._label_id(label_name) in msg.get("labelIds", [])

    def mark_processed(self, email: Email, label_name: str, mark_read: bool) -> None:
        body: dict = {"addLabelIds": [self._label_id(label_name)]}
        if mark_read:
            body["removeLabelIds"] = ["UNREAD"]
        self.service.users().messages().modify(
            userId="me", id=email.id, body=body
        ).execute()

    # -- sending --------------------------------------------------------------

    def send_reply(self, original: Email, reply_text: str) -> str:
        """Send a reply in the same thread as the original message."""
        msg = EmailMessage()
        msg["To"] = original.sender
        msg["From"] = self.my_address
        subject = original.subject
        if not subject.lower().startswith("re:"):
            subject = f"Re: {subject}"
        msg["Subject"] = subject
        if original.message_id_header:
            msg["In-Reply-To"] = original.message_id_header
            refs = f"{original.references} {original.message_id_header}".strip()
            msg["References"] = refs
        msg.set_content(reply_text)

        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        sent = (
            self.service.users()
            .messages()
            .send(userId="me", body={"raw": raw, "threadId": original.thread_id})
            .execute()
        )
        return sent["id"]
