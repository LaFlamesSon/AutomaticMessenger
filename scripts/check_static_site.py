from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "web"


def main():
    missing = []
    references = 0
    pages = list(ROOT.rglob("*.html"))
    for page in pages:
        content = page.read_text(encoding="utf-8")
        for target in re.findall(r'(?:href|src)="([^"#?]+)', content):
            if not target.startswith("/"):
                continue
            references += 1
            local = ROOT / target.lstrip("/")
            if not (local.exists() or (local / "index.html").exists()):
                missing.append((str(page.relative_to(ROOT)), target))
    print(f"html_pages={len(pages)} internal_references={references} missing={len(missing)}")
    for page, target in missing:
        print(f"MISSING {page}: {target}")
    raise SystemExit(1 if missing else 0)


if __name__ == "__main__":
    main()
