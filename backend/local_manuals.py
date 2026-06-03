from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
MANUALS_DIR = ROOT / "data-sources" / "msi-library"
MANIFEST_PATH = MANUALS_DIR / "manifest.json"


def manuals_dir() -> Path:
    return MANUALS_DIR


def _load_manifest_data() -> dict[str, Any]:
    if not MANIFEST_PATH.is_file():
        return {"manuals": []}
    try:
        data = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"manuals": []}
    return data if isinstance(data, dict) else {"manuals": []}


def _title_from_pdf_filename(filename: str) -> str:
    stem = Path(filename).stem
    stem = re.sub(r"^MN\d+[A-Z0-9-]*_", "", stem, flags=re.I)
    stem = re.sub(r"^(enus_|multilingual_)+", "", stem, flags=re.I)
    title = stem.replace("_", " ").strip()
    return title or filename


def _manual_id_from_filename(filename: str) -> str:
    stem = Path(filename).stem.lower()
    prefix = re.match(r"^(mn\d+[a-z0-9-]*|mtn-\d+-\d+|wgd[\d]+-[a-z0-9]+|bc_[a-z0-9_]+)", stem)
    if prefix:
        return re.sub(r"[^a-z0-9]+", "-", prefix.group(1)).strip("-")[:80]
    return re.sub(r"[^a-z0-9]+", "-", stem).strip("-")[:80] or "manual"


def _stub_manual_for_pdf(pdf_path: Path) -> dict[str, Any]:
    name = pdf_path.name
    title = _title_from_pdf_filename(name)
    blob = f"{name} {title}".lower()
    tags = ["MSI Library", "local"]
    if "svx" in blob:
        tags.append("SVX")
    if "m500" in blob:
        tags.append("M500")
    return {
        "id": _manual_id_from_filename(name),
        "title": title,
        "filename": name,
        "summary": f"Local MSI manual: {title}.",
        "tags": tags,
        "source_url": "",
    }


def load_manuals() -> list[dict[str, Any]]:
    entries = _load_manifest_data().get("manuals") or []
    manuals: list[dict[str, Any]] = []
    seen_filenames: set[str] = set()
    seen_ids: set[str] = set()
    for entry in entries:
        if isinstance(entry, dict) and entry.get("id"):
            manuals.append(entry)
            fn = (entry.get("filename") or "").strip()
            if fn:
                seen_filenames.add(fn)
            seen_ids.add(entry["id"])

    if MANUALS_DIR.is_dir():
        for pdf_path in sorted(MANUALS_DIR.glob("*.pdf")):
            if pdf_path.name in seen_filenames:
                continue
            stub = _stub_manual_for_pdf(pdf_path)
            base_id = stub["id"]
            n = 2
            while stub["id"] in seen_ids:
                stub["id"] = f"{base_id}-{n}"
                n += 1
            seen_ids.add(stub["id"])
            seen_filenames.add(pdf_path.name)
            manuals.append(stub)
    return manuals


def stats() -> dict[str, Any]:
    manuals = load_manuals()
    on_disk = sum(
        1
        for m in manuals
        if (MANUALS_DIR / (m.get("filename") or "")).is_file()
    )
    return {
        "enabled": MANIFEST_PATH.is_file(),
        "manual_count": len(manuals),
        "on_disk_count": on_disk,
        "path": str(MANUALS_DIR.relative_to(ROOT)),
    }


def _score(manual: dict[str, Any], query: str) -> int:
    q = query.lower()
    score = 0
    fields = [
        manual.get("id", ""),
        manual.get("title", ""),
        manual.get("summary", ""),
        manual.get("filename", ""),
        " ".join(manual.get("tags") or []),
    ]
    blob = " ".join(str(f) for f in fields).lower()
    for term in q.split():
        if len(term) < 2:
            continue
        if term in blob:
            score += 2
    if q in blob:
        score += 3
    return score


def _snippet(text: str, max_len: int = 220) -> str:
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    if not cleaned:
        return ""
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 1].rstrip() + "…"


def _manual_url(manual: dict[str, Any]) -> str | None:
    filename = (manual.get("filename") or "").strip()
    if not filename:
        return None
    path = MANUALS_DIR / Path(filename).name
    if path.is_file():
        return f"/api/manuals/{path.name}"
    source_url = (manual.get("source_url") or "").strip()
    return source_url or None


def search(query: str, limit: int = 10) -> list[dict[str, Any]]:
    term = query.strip()
    if not term:
        return []

    ranked: list[tuple[int, dict[str, Any]]] = []
    for manual in load_manuals():
        score = _score(manual, term)
        if score > 0:
            ranked.append((score, manual))

    ranked.sort(key=lambda x: (-x[0], x[1].get("id", "")))

    results: list[dict[str, Any]] = []
    for _, manual in ranked[:limit]:
        filename = (manual.get("filename") or "").strip()
        on_disk = bool(filename and (MANUALS_DIR / Path(filename).name).is_file())
        results.append(
            {
                "id": manual.get("id", ""),
                "title": manual.get("title") or manual.get("id", ""),
                "filename": filename,
                "snippet": _snippet(manual.get("summary", "")),
                "url": _manual_url(manual),
                "on_disk": on_disk,
                "source": "msi-library",
            }
        )
    return results
