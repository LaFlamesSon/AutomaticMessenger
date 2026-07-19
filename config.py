"""Configuration loading and validation for AutomaticMessenger."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml

DEFAULT_CONFIG_PATH = Path("config.yaml")


@dataclass
class Rule:
    """One matching rule: a set of keywords and the reply template to use."""

    name: str
    keywords: list[str]
    template: str
    match_in: list[str] = field(default_factory=lambda: ["subject", "body"])

    def __post_init__(self) -> None:
        if not self.keywords:
            raise ValueError(f"Rule '{self.name}' has no keywords")
        if not self.template.strip():
            raise ValueError(f"Rule '{self.name}' has an empty template")
        for area in self.match_in:
            if area not in ("subject", "body"):
                raise ValueError(
                    f"Rule '{self.name}': match_in must be 'subject' or 'body', got '{area}'"
                )


@dataclass
class Config:
    rules: list[Rule]
    # Gmail
    credentials_file: str = "credentials.json"
    token_file: str = "token.json"
    processed_label: str = "AutoMessenger/Processed"
    # Behaviour
    query: str = "in:inbox is:unread newer_than:7d"
    max_replies_per_run: int = 10
    mark_as_read: bool = True
    skip_no_reply_senders: bool = True
    # AI fill-ins (optional). Uses the OpenAI-compatible chat API, which also
    # works with a free local model via Ollama (base_url http://localhost:11434/v1).
    # If disabled or unreachable, free built-in heuristics fill the placeholders.
    ai_fill_ins: bool = False
    llm_base_url: str = "http://localhost:11434/v1"
    llm_model: str = "llama3.2"
    # Signature appended to every reply
    signature: str = ""

    @classmethod
    def load(cls, path: Path | str = DEFAULT_CONFIG_PATH) -> "Config":
        path = Path(path)
        if not path.exists():
            raise FileNotFoundError(
                f"Config file not found: {path}. "
                "Copy config.example.yaml to config.yaml and edit it."
            )
        with open(path, "r", encoding="utf-8") as fh:
            raw = yaml.safe_load(fh) or {}

        rules_raw = raw.pop("rules", [])
        if not rules_raw:
            raise ValueError("Config must define at least one rule under 'rules:'")
        rules = [
            Rule(
                name=r.get("name", f"rule-{i + 1}"),
                keywords=[str(k) for k in r.get("keywords", [])],
                template=r.get("template", ""),
                match_in=r.get("match_in", ["subject", "body"]),
            )
            for i, r in enumerate(rules_raw)
        ]

        known = {f for f in cls.__dataclass_fields__ if f != "rules"}
        unknown = set(raw) - known
        if unknown:
            raise ValueError(f"Unknown config keys: {', '.join(sorted(unknown))}")

        return cls(rules=rules, **{k: v for k, v in raw.items() if k in known})

    @property
    def llm_api_key(self) -> str:
        # Ollama ignores the key; a real OpenAI endpoint needs OPENAI_API_KEY set.
        return os.environ.get("OPENAI_API_KEY", "ollama")
