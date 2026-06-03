#!/usr/bin/env python3
"""Validate all M500 KB article JSON files."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARTICLES = ROOT / "data-sources" / "m500-kb" / "articles"
KB_RE = re.compile(r"KB\d{7}", re.I)


def main() -> int:
    issues: list[tuple[str, list[str], list[str]]] = []
    ok: list[tuple[str, str, int, list[str]]] = []

    for path in sorted(ARTICLES.glob("KB*.json")):
        name = path.stem
        file_issues: list[str] = []
        warnings: list[str] = []

        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            issues.append((name, [f"Invalid JSON: {exc}"], []))
            continue

        kb = (data.get("kb_number") or "").upper()
        body = (data.get("body") or "").strip()
        title = (data.get("title") or "").strip()
        product = (data.get("product") or "").strip()

        if name.upper() != kb:
            file_issues.append(f"Filename {name} != kb_number {kb}")
        if not KB_RE.fullmatch(kb):
            file_issues.append(f"kb_number must match KB#######, got {kb!r}")
        if not title:
            file_issues.append("Missing title")
        if product and product.upper() != "M500":
            warnings.append(f"product is {product!r}, expected M500")
        elif not product:
            warnings.append("no product field")
        if len(body) < 100:
            file_issues.append(f"body too short ({len(body)} chars)")
        elif len(body) < 300:
            warnings.append(f"body short ({len(body)} chars)")
        if not data.get("tags"):
            warnings.append("no tags")
        if not (data.get("summary") or "").strip():
            warnings.append("no summary")
        if not (data.get("permalink") or "").strip():
            warnings.append("no permalink (default CMSO URL will be used)")

        if file_issues:
            issues.append((name, file_issues, warnings))
        else:
            ok.append((name, title[:70], len(body), warnings))

    print(f"OK: {len(ok)}  |  NEEDS FIX: {len(issues)}\n")
    for name, title, blen, warnings in ok:
        warn = f"  (warn: {', '.join(warnings)})" if warnings else ""
        print(f"  [OK] {name}: {title} ({blen} chars){warn}")

    if issues:
        print()
        for name, file_issues, warnings in issues:
            print(f"  [FIX] {name}:")
            for item in file_issues:
                print(f"        - {item}")
            for item in warnings:
                print(f"        - warn: {item}")

    return 1 if issues else 0


if __name__ == "__main__":
    sys.exit(main())
