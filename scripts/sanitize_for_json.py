#!/usr/bin/env python3
"""
Make pasted KB text safe to drop into a JSON string value (e.g. "body" field).

Usage:
  python sanitize_for_json.py                    # type/paste text, end with Ctrl+Z Enter (Windows) or Ctrl+D (Unix)
  python sanitize_for_json.py -f article.txt
  python sanitize_for_json.py -f article.txt --field body   # prints "body": "..."
  python sanitize_for_json.py -f article.txt --raw          # escaped string only, no quotes

Copy the output into your .json file between the quotes for "body".
"""

from __future__ import annotations

import argparse
import json
import re
import sys


def clean_text(text: str) -> str:
    if text.startswith("\ufeff"):
        text = text.removeprefix("\ufeff")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Remove control chars except tab/newline
    text = "".join(ch for ch in text if ch == "\n" or ch == "\t" or ord(ch) >= 32)
    # Collapse excessive blank lines (optional readability)
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip()


def to_json_string(text: str) -> str:
    return json.dumps(clean_text(text), ensure_ascii=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Sanitize text for JSON string fields.")
    parser.add_argument("-f", "--file", help="Read from file instead of stdin")
    parser.add_argument(
        "--field",
        default="",
        help='If set, print as JSON key/value, e.g. --field body → "body": "..."',
    )
    parser.add_argument(
        "--raw",
        action="store_true",
        help="Print escaped content only (no surrounding quotes)",
    )
    args = parser.parse_args()

    if args.file:
        raw = open(args.file, encoding="utf-8").read()
    else:
        print("Paste article text, then end input:", file=sys.stderr)
        print("  Windows: Ctrl+Z then Enter", file=sys.stderr)
        print("  Mac/Linux: Ctrl+D", file=sys.stderr)
        raw = sys.stdin.read()

    escaped = to_json_string(clean_text(raw))

    if args.raw:
        # dumps adds quotes; strip them for raw inner content
        out = escaped[1:-1] if len(escaped) >= 2 else escaped
    elif args.field:
        key = json.dumps(args.field, ensure_ascii=False)
        out = f"{key}: {escaped}"
    else:
        out = escaped

    sys.stdout.write(out)
    if not out.endswith("\n"):
        sys.stdout.write("\n")


if __name__ == "__main__":
    main()
