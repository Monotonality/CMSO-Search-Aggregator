from __future__ import annotations

from typing import Any

INFORMATION_SOURCES: list[dict[str, Any]] = [
    {
        "id": "kb",
        "label": "KB",
        "source_type": "kb",
        "enabled": True,
        "description": "Local M500 knowledge base articles",
    },
    {
        "id": "msi_library",
        "label": "MSI Library",
        "source_type": "msi_library",
        "enabled": True,
        "description": "Manual PDF library",
    },
    {
        "id": "google_chat",
        "label": "Google Chat History",
        "source_type": "google_chat",
        "enabled": False,
        "description": "Not connected — coming soon",
    },
    {
        "id": "snow_kb",
        "label": "SnowKB",
        "source_type": "snow_kb",
        "enabled": False,
        "description": "ServiceNow KB — not connected",
    },
    {
        "id": "google_drive",
        "label": "Google Drive",
        "source_type": "google_drive",
        "enabled": False,
        "description": "Not connected — coming soon",
    },
    {
        "id": "salesforce",
        "label": "Salesforce",
        "source_type": "salesforce",
        "enabled": False,
        "description": "Salesforce — not connected",
    },
]

_SOURCE_BY_ID = {s["id"]: s for s in INFORMATION_SOURCES}
_ENABLED_IDS = {s["id"] for s in INFORMATION_SOURCES if s["enabled"]}


def sources_for_config() -> list[dict[str, Any]]:
    return [
        {
            "id": s["id"],
            "label": s["label"],
            "enabled": bool(s["enabled"]),
            "description": s.get("description", ""),
        }
        for s in INFORMATION_SOURCES
    ]


def parse_sources_param(sources: str | None) -> set[str]:
    """
    Parse comma-separated source ids (e.g. kb,msi_library).
    Returns source_type values to include. Unknown/disabled ids are ignored.
  """
    if not sources or not str(sources).strip():
        return {
            _SOURCE_BY_ID[sid]["source_type"]
            for sid in _ENABLED_IDS
        }

    types: set[str] = set()
    for raw in sources.split(","):
        sid = raw.strip().lower()
        if sid not in _ENABLED_IDS:
            continue
        types.add(_SOURCE_BY_ID[sid]["source_type"])
    if not types:
        return {_SOURCE_BY_ID[sid]["source_type"] for sid in _ENABLED_IDS}
    return types


def filter_hits_by_source(
    hits: list[dict[str, Any]], source_types: set[str]
) -> list[dict[str, Any]]:
    if not source_types:
        return []
    return [h for h in hits if h.get("source_type") in source_types]
