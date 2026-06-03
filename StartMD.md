# System Context: M500 Troubleshooting MVP

## 1. Project Objective & Scope

Lightweight, read-only **contextual retrieval demo** for Software Systems Technologists (SSTs) working **M500** issues. The MVP searches:

1. **Local KB JSON** — sample troubleshooting articles you converted to JSON
2. **MSI library manuals** — metadata in `manifest.json` plus optional local PDFs from Motorola Solutions public docs

### In scope (this demo)

* Keyword search across article body text (symptoms, error codes, steps)
* Keyword search across manual titles/tags/summaries
* Open local PDFs when present under `data-sources/msi-library/`

### Out of scope (for now)

* Live transcript stream and entity extraction
* Live external ticketing APIs
* Customer network layout data
* Any external ticketing or knowledge APIs

---

## 2. Architecture (current)

```
[ Search UI ]
     │
     ▼
[ FastAPI hybrid search ]
     ├─► SQLite FTS5 (BM25)          full-text index
     ├─► TF-IDF vectors (local)      semantic similarity (2026 hackathon default)
     ├─► Voice (optional)            local Ollama only — see 2026 Hackathon AI Guidance.md
     └─► data-sources/
           ├─ m500-kb/articles/*.json
           └─ msi-library/manifest.json + *.pdf
```

Index file: `data-sources/search_index.db` (rebuild via `scripts/rebuild_index.py`).

Future vision: transcript → heuristic parser → parallel retrieval → unified technician dashboard.
