#!/usr/bin/env python3
"""Rebuild the hybrid FTS + vector search index."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from search_index import rebuild_index  # noqa: E402


def main() -> int:
    print("Rebuilding search index (FTS5 + embeddings)...")
    print("Uses local TF-IDF vectors (hackathon-compliant; no model download).")
    stats = rebuild_index()
    print(stats)
    if stats.get("document_count", 0) > 0:
        from search_index import index_stats

        idx = index_stats()
        chunks = idx.get("manual_chunk_count", 0)
        if chunks:
            print(f"MSI manual chunks indexed: {chunks}")
        else:
            print(
                "No PDF chunks yet — copy manuals into data-sources/msi-library/ "
                "and rebuild."
            )
    return 0 if stats.get("document_count", 0) > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
