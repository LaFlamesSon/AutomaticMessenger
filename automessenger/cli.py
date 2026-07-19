"""Command-line interface for AutomaticMessenger."""

from __future__ import annotations

import argparse
import logging
import sys

from .agent import Agent
from .config import DEFAULT_CONFIG_PATH, Config


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="automessenger",
        description=(
            "Inbox agent that auto-replies to Gmail messages matching your "
            "configured keywords (e.g. 'paid', 'advertisement')."
        ),
    )
    parser.add_argument(
        "-c", "--config", default=str(DEFAULT_CONFIG_PATH),
        help="Path to config file (default: config.yaml)",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="Debug logging"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sweep = sub.add_parser("sweep", help="Scan the inbox once and reply to matches")
    sweep.add_argument(
        "--dry-run", action="store_true",
        help="Show the replies that WOULD be sent without sending anything",
    )

    run = sub.add_parser("run", help="Run continuously, sweeping on an interval")
    run.add_argument(
        "--interval", type=int, default=300, metavar="SECONDS",
        help="Seconds between inbox checks (default: 300)",
    )
    run.add_argument(
        "--dry-run", action="store_true",
        help="Continuously scan and log would-be replies without sending",
    )

    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )

    try:
        config = Config.load(args.config)
    except (FileNotFoundError, ValueError) as exc:
        print(f"Config error: {exc}", file=sys.stderr)
        return 1

    agent = Agent(config, dry_run=getattr(args, "dry_run", False))

    if args.command == "run":
        try:
            agent.run_forever(args.interval)
        except KeyboardInterrupt:
            print("\nStopped.")
        return 0

    # sweep
    result = agent.sweep()
    print(f"\nScanned {result.scanned} message(s).")
    if result.dry_run_previews:
        print(f"\n--- DRY RUN: {len(result.dry_run_previews)} repl(ies) would be sent ---")
        for email, reply in result.dry_run_previews:
            print(f"\nTo: {email.sender}\nRe: {email.subject}\n{'-' * 40}\n{reply}\n{'-' * 40}")
    for line in result.replied:
        print(f"Replied: {line}")
    if not result.replied and not result.dry_run_previews:
        print("No new matching emails.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
