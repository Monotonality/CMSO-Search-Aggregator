# CMSO Signal

**SIGNAL** — **S**earch **I**ntegrated **G**eneral **N**atural **A**utomatic **L**ookup.

Hackathon demo for **M500** troubleshooting. Data stays on disk: JSON articles in `data-sources/m500-kb/` and MSI manuals in `data-sources/msi-library/`.

## Quick start

Double-click **`run.cmd`**, or from the project root:

```powershell
.\scripts\start.ps1
```

Opens **http://127.0.0.1:8001/** — creates the venv, installs deps, builds the index on first run, and optionally starts Ollama for voice assist.

| Flag | Effect |
|------|--------|
| `-NoOllama` | Voice uses rule-based query extraction only |
| `-RebuildIndex` | Force rebuild `data-sources/search_index.db` |
| `-KillPort` | Free port 8001, then start |
| `-NoBrowser` | Do not open a browser tab |

## First-time setup (manual)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python ..\scripts\rebuild_index.py
```

Optional voice LLM: `ollama pull gemma3:4b`

## Features

- **Hybrid search** — SQLite FTS5 (BM25) + local TF-IDF vectors, merged ranking with similarity %
- **Search modes** — hybrid, keyword, semantic, generic
- **Source filters** — KB articles and/or MSI library manuals
- **Voice assist** — browser speech → search queries via local Ollama (rule-based fallback)
- **Pinned results & ticket notes** — session sidebar with investigation template and ticket form popup
- **PDF chunking** — manuals indexed by page-aware chunks (~350 words), not just titles

The index auto-rebuilds on startup when source files change. Force rebuild: `python scripts\rebuild_index.py` or `POST /api/index/rebuild`.

## Hackathon AI compliance

Follows **`2026 Hackathon AI Guidance.md`**. Summary:

| Area | Approach |
|------|----------|
| LLM | **Ollama** only (local); approved families: Llama, Mistral/Mixtral, Phi, Gemma (≤9B) |
| Default voice model | `gemma3:4b` |
| Search vectors | **TF-IDF** (scikit-learn, offline) |
| Strict mode | `HACKATHON_STRICT=1` (default) blocks non-compliant models and FastEmbed |
| No Ollama | `.\scripts\start.ps1 -NoOllama` or `VOICE_USE_LLM=0` |
| Post-event cleanup | `scripts/hackathon_cleanup.ps1` |

Check runtime status: `GET /api/hackathon/compliance` and `GET /api/voice/status`.

Advanced (non-hackathon): `HACKATHON_STRICT=0` and `USE_FASTEMBED=1` for FastEmbed (`BAAI/bge-small-en-v1.5`).

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/search?q=...&mode=hybrid&sources=kb,msi_library` | Hybrid search |
| `GET /api/document/{doc_id}` | Full document for expand-in-place |
| `GET /api/config` | Sources, index stats, compliance |
| `GET /api/voice/status` | Ollama availability |
| `POST /api/voice/process-segment` | Transcript → queries → search results |
| `GET /api/manuals/{file}.pdf` | Serve local PDF |
| `POST /api/index/rebuild` | Rebuild index |

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/start.ps1` / `run.cmd` | Setup + run (canonical entry point) |
| `scripts/rebuild_index.py` | Build FTS5 + vector index |
| `scripts/check_kb_json.py` | Validate article JSON |
| `scripts/new-kb-article.ps1` | Create stub KB article |
| `scripts/sanitize_for_json.py` | Escape pasted article body text |
| `scripts/download_msi_pdfs.py` | Fetch MSI library PDFs |
| `scripts/ingest_new_pdfs.py` | Copy PDFs from `New PDF/` into library |
| `scripts/hackathon_cleanup.ps1` | Remove local Ollama models post-event |
