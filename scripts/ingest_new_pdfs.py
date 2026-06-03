#!/usr/bin/env python3
"""Copy PDFs from project 'New PDF' folder into MSI library and update manifest.json."""
from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NEW_PDF_DIR = ROOT / "New PDF"
LIBRARY = ROOT / "data-sources" / "msi-library"
MANIFEST = LIBRARY / "manifest.json"


def manual_id_from_filename(filename: str) -> str:
    stem = Path(filename).stem.lower()
    prefix = re.match(r"^(mn\d+[a-z0-9-]*|mtn-\d+-\d+|wgd[\d]+-[a-z0-9]+|bc_[a-z0-9_]+)", stem)
    if prefix:
        return re.sub(r"[^a-z0-9]+", "-", prefix.group(1)).strip("-")[:80]
    slug = re.sub(r"[^a-z0-9]+", "-", stem).strip("-")
    return slug[:80] or "manual"


def title_from_filename(filename: str) -> str:
    stem = Path(filename).stem
    stem = re.sub(r"^MN\d+[A-Z0-9-]*_", "", stem, flags=re.I)
    stem = re.sub(r"^(enus_|multilingual_)+", "", stem, flags=re.I)
    stem = stem.replace("_", " ").strip()
    if re.fullmatch(r"MTN-\d+-\d+", stem, flags=re.I):
        return stem.upper()
    if stem.upper() == "BC BAAS":
        return "BC BAAS"
    return stem or Path(filename).stem


def tags_from_filename(filename: str, title: str) -> list[str]:
    blob = f"{filename} {title}".lower()
    tags = ["MSI Library", "local"]
    if "svx" in blob or "pmpn5021" in blob or "pmpn4686" in blob or "vrsm" in blob:
        tags.append("SVX")
    if "m500" in blob or "in-car" in blob or "mn01" in blob:
        tags.append("M500")
    if "battery" in blob or "charger" in blob or "dock" in blob:
        tags.append("charger")
    if "baas" in blob:
        tags.append("BAAS")
    return list(dict.fromkeys(tags))


def manifest_entry_for_pdf(filename: str) -> dict:
    title = title_from_filename(filename)
    return {
        "id": manual_id_from_filename(filename),
        "title": title,
        "filename": filename,
        "summary": f"Local MSI manual: {title}.",
        "tags": tags_from_filename(filename, title),
        "source_url": "",
    }


def load_manifest() -> dict:
    if not MANIFEST.is_file():
        return {"product": "M500, SVX", "source": "Local MSI library", "manuals": []}
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def main() -> int:
    if not NEW_PDF_DIR.is_dir():
        print(f"Folder not found: {NEW_PDF_DIR}", file=sys.stderr)
        return 1

    pdfs = sorted(NEW_PDF_DIR.glob("*.pdf"))
    if not pdfs:
        print(f"No PDF files in {NEW_PDF_DIR}")
        return 0

    LIBRARY.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()
    manuals: list[dict] = list(manifest.get("manuals") or [])
    by_filename = {
        (m.get("filename") or "").strip(): m for m in manuals if m.get("filename")
    }
    existing_ids = {m.get("id") for m in manuals if m.get("id")}

    copied = 0
    added = 0
    for src in pdfs:
        dest = LIBRARY / src.name
        if not dest.exists() or dest.stat().st_size != src.stat().st_size:
            shutil.copy2(src, dest)
            copied += 1
            print(f"Copied: {src.name}")
        else:
            print(f"Already in library: {src.name}")

        if src.name in by_filename:
            continue

        entry = manifest_entry_for_pdf(src.name)
        base_id = entry["id"]
        n = 2
        while entry["id"] in existing_ids:
            entry["id"] = f"{base_id}-{n}"
            n += 1
        existing_ids.add(entry["id"])
        by_filename[src.name] = entry
        manuals.append(entry)
        added += 1
        print(f"  + manifest: {entry['id']} — {entry['title']}")

    manifest["manuals"] = manuals
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"\nDone. Copied {copied} file(s), added {added} manifest entr(y/ies).")
    print("Run: python scripts/rebuild_index.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
