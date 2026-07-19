"""Keyword matching: decide which rule (if any) applies to an email."""

from __future__ import annotations

import re

from .config import Rule
from .gmail_client import Email


def _keyword_in(text: str, keyword: str) -> bool:
    """Whole-word, case-insensitive match so 'paid' doesn't hit 'unpaid'... unless
    the keyword itself contains spaces, in which case do a substring match."""
    if " " in keyword:
        return keyword.lower() in text.lower()
    return re.search(rf"\b{re.escape(keyword)}\b", text, re.IGNORECASE) is not None


def match_rule(email: Email, rules: list[Rule]) -> tuple[Rule, list[str]] | None:
    """Return the first rule whose keywords appear in the email, plus the
    keywords that matched. Rules are evaluated in config order."""
    for rule in rules:
        areas = {
            "subject": email.subject if "subject" in rule.match_in else "",
            "body": email.body if "body" in rule.match_in else "",
        }
        haystack = "\n".join(v for v in areas.values() if v)
        matched = [kw for kw in rule.keywords if _keyword_in(haystack, kw)]
        if matched:
            return rule, matched
    return None
