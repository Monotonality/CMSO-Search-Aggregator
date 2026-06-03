# CMSO Signal (M500 troubleshooting search — hackathon demo)

Local **hybrid search** for M500 troubleshooting:

- **Full-text index** — SQLite FTS5 with BM25 ranking
- **Semantic similarity** — local TF-IDF vectors (default, no generative AI download)
- **Combined ranking** — weighted merge of text + vector scores; each result shows a **similarity %**
- **Voice assist (optional)** — browser speech + **local Ollama** query extraction, with rule-based fallback

Data: JSON articles in `data-sources/m500-kb/` and MSI manuals in `data-sources/msi-library/` (manifest + optional PDFs).

## 2026 Hackathon AI compliance

This project follows **`2026 Hackathon AI Guidance.md`**:

| Area | Approach |
|------|----------|
| LLM tooling | **Ollama** only (local); no ChatGPT, DeepSeek, Qwen, cloud consumer AI, etc. |
| Default voice model | `gemma3:4b` (Gemma family, ≤9B) — `ollama pull gemma3:4b` |
| Search vectors | **TF-IDF** (scikit-learn, fully offline) |
| Strict mode | `HACKATHON_STRICT=1` (default) blocks non-compliant Ollama models and FastEmbed |
| Voice without Ollama | `scripts/start_backend_no_ollama.ps1` or `VOICE_USE_LLM=0` |
| After the event | `scripts/hackathon_cleanup.ps1` — remove local Ollama models; use AI Hub / AI Eval if continuing |

API: `GET /api/hackathon/compliance` and `model_compliance` on `GET /api/voice/status`.

Approved model families: **Llama, Mistral/Mixtral, Phi, Gemma**. Avoid cloud-tagged models (`*-cloud`), models &gt;9B, and community fine-tunes.

## First-time setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python ..\scripts\rebuild_index.py
```

Optional voice LLM (local):

```powershell
ollama pull gemma3:4b
```

## Run (easiest)

Double-click **`run.cmd`** in the project folder, or:

```powershell
.\scripts\start.ps1
```

This script creates the venv and installs deps if needed, builds the search index on first run, tries to start Ollama, opens the browser, and runs the API on **http://127.0.0.1:8001/**.

| Flag | Effect |
|------|--------|
| `-NoOllama` | Voice uses rule-based extraction only (no Ollama required) |
| `-RebuildIndex` | Force rebuild `search_index.db` |
| `-KillPort` | Stop whatever is listening on port 8001, then start fresh |
| `-NoBrowser` | Do not open a browser tab |

Other entry points:

```powershell
.\scripts\start.ps1 -NoOllama
.\scripts\start_backend_no_ollama.ps1
```

The index auto-rebuilds on startup when source files change. Force rebuild:

```powershell
python scripts\rebuild_index.py
# or POST http://127.0.0.1:8001/api/index/rebuild
```

## How search works

| Layer | Technology | Role |
|-------|------------|------|
| Full-text | SQLite FTS5 (`porter` tokenizer) | Keyword / symptom terms, BM25 rank |
| Semantic | TF-IDF (local sklearn) | Similar-case matching via cosine similarity |
| Final rank | 35% text + 65% vector (default) | `score`; `similarity` is the raw vector cosine (0–1) |

**MSI library PDFs** are sub-chunked during indexing (~350 words, overlapping windows, page-aware) so search can match text *inside* manuals, not just titles/summaries.

Advanced (non-hackathon): set `HACKATHON_STRICT=0` and `USE_FASTEMBED=1` to try FastEmbed (`BAAI/bge-small-en-v1.5`).

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/search?q=...&min_similarity=0.2` | Hybrid search |
| `GET /api/config` | Source + index stats + compliance summary |
| `GET /api/hackathon/compliance` | Hackathon AI rules snapshot |
| `POST /api/index/rebuild` | Rebuild FTS + embeddings |
| `GET /api/voice/status` | Ollama + model compliance |
| `GET /api/manuals/{file}.pdf` | Serve local PDF |

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/rebuild_index.py` | Build FTS5 + vector index |
| `scripts/start.ps1` / `run.cmd` | **One-command** setup + run |
| `scripts/start_server.ps1` | Alias for `start.ps1` |
| `scripts/run_all.ps1` | Alias for `start.ps1` |
| `scripts/start_backend_no_ollama.ps1` | API without Ollama LLM |
| `scripts/hackathon_cleanup.ps1` | Remove local Ollama models post-event |
| `scripts/check_kb_json.py` | Validate article JSON |
| `scripts/sanitize_for_json.py` | Escape pasted body text |
| `scripts/new-kb-article.ps1` | Create stub article JSON |
