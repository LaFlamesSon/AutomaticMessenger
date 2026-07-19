"""Build reply text from a template: placeholders filled by free heuristics,
optionally upgraded by an LLM through any OpenAI-compatible endpoint (e.g. a
free local Ollama model)."""

from __future__ import annotations

import json
import logging
import re

from .config import Config, Rule
from .gmail_client import Email

log = logging.getLogger(__name__)

PLACEHOLDER_RE = re.compile(r"\{\{\s*(\w+)\s*\}\}")

# Generic mailbox providers — their domain is not a company name.
_GENERIC_DOMAINS = {
    "gmail", "googlemail", "yahoo", "hotmail", "outlook", "live", "aol",
    "icloud", "me", "proton", "protonmail", "gmx", "mail", "zoho",
}


def _company_from_email(email: Email) -> str:
    domain = email.sender_email.rsplit("@", 1)[-1] if "@" in email.sender_email else ""
    root = domain.split(".")[0] if domain else ""
    if root and root.lower() not in _GENERIC_DOMAINS:
        return root.capitalize()
    return email.sender_name


def _topic_from_subject(subject: str) -> str:
    topic = re.sub(r"^(re|fwd?)\s*:\s*", "", subject.strip(), flags=re.IGNORECASE)
    if not topic:
        return "your email"
    # Lowercase the leading capital so the topic reads naturally mid-sentence,
    # but leave acronyms (e.g. "SEO services") alone.
    if topic[0].isupper() and not topic[:2].isupper():
        topic = topic[0].lower() + topic[1:]
    return topic


def heuristic_fill_ins(email: Email) -> dict[str, str]:
    """Free, dependency-less placeholder values derived from the email itself."""
    first_name = email.sender_name.split()[0] if email.sender_name.split() else "there"
    return {
        "sender_name": email.sender_name or "there",
        "first_name": first_name,
        "company": _company_from_email(email),
        "topic": _topic_from_subject(email.subject),
        "subject": email.subject,
    }


def ai_fill_ins(email: Email, placeholders: list[str], config: Config) -> dict[str, str]:
    """Ask an OpenAI-compatible endpoint (e.g. local Ollama) to extract the
    placeholder values from the email. Raises on any failure — caller falls
    back to heuristics."""
    from openai import OpenAI  # imported lazily; optional dependency

    client = OpenAI(base_url=config.llm_base_url, api_key=config.llm_api_key)
    prompt = (
        "You extract fields from an email for a reply template. "
        f"Return ONLY a JSON object with these keys: {placeholders}.\n"
        "- sender_name: the sender's name\n"
        "- first_name: their first name\n"
        "- company: the company they represent\n"
        "- topic: a short phrase (max 8 words) for what the email is about\n"
        "- subject: the email subject\n"
        "If a value can't be determined, use a sensible neutral fallback "
        '(e.g. "there" for names).\n\n'
        f"From: {email.sender}\nSubject: {email.subject}\n\n{email.body[:4000]}"
    )
    resp = client.chat.completions.create(
        model=config.llm_model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0,
    )
    text = resp.choices[0].message.content or ""
    json_match = re.search(r"\{.*\}", text, re.S)
    if not json_match:
        raise ValueError(f"LLM returned no JSON: {text[:200]}")
    data = json.loads(json_match.group(0))
    return {k: str(v) for k, v in data.items() if isinstance(k, str)}


def build_reply(email: Email, rule: Rule, config: Config) -> str:
    placeholders = PLACEHOLDER_RE.findall(rule.template)
    values = heuristic_fill_ins(email)

    if config.ai_fill_ins and placeholders:
        try:
            ai_values = ai_fill_ins(email, placeholders, config)
            # AI augments the heuristics; heuristics remain the safety net.
            values.update({k: v for k, v in ai_values.items() if v and v.strip()})
        except Exception as exc:  # noqa: BLE001 — any LLM failure degrades gracefully
            log.warning("AI fill-ins unavailable (%s); using heuristics", exc)

    def substitute(match: re.Match) -> str:
        return values.get(match.group(1), match.group(0))

    reply = PLACEHOLDER_RE.sub(substitute, rule.template).strip()
    if config.signature.strip():
        reply = f"{reply}\n\n{config.signature.strip()}"
    return reply
