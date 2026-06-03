# M500 Troubleshooting Search (MVP demo)

Local **hybrid search** for M500 troubleshooting:

- **Full-text index** — SQLite FTS5 with BM25 ranking
- **Semantic similarity** — free local embeddings ([FastEmbed](https://github.com/qdrant/fastembed) + `BAAI/bge-small-en-v1.5`)
- **Combined ranking** — weighted merge of text + vector scores; each result shows a **similarity %**

Data: JSON articles in `data-sources/m500-kb/` and MSI manuals in `data-sources/msi-library/` (manifest + optional PDFs).

## First-time setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python ..\scripts\rebuild_index.py
```

The first index build downloads the embedding model (~130 MB, one-time, free).

## Run

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn main:app --reload --host 127.0.0.1 --port 8001
```

Open **http://127.0.0.1:8001**

The index auto-rebuilds on startup when source files change. Force rebuild:

```powershell
python scripts\rebuild_index.py
# or POST http://127.0.0.1:8001/api/index/rebuild
```

## How search works

| Layer | Technology | Role |
|-------|------------|------|
| Full-text | SQLite FTS5 (`porter` tokenizer) | Keyword / symptom terms, BM25 rank |
| Semantic | FastEmbed local ONNX model | “Similar case” matching via cosine similarity |
| Final rank | 35% text + 65% vector (default) | `score`; `similarity` is the raw vector cosine (0–1) |

Natural-language queries work well (e.g. *device shows invalid serial on boot*) even when exact KB wording differs.

**MSI library PDFs** are sub-chunked during indexing (~350 words, overlapping windows, page-aware) so search can match text *inside* manuals, not just titles/summaries.

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/search?q=...&min_similarity=0.2` | Hybrid search |
| `GET /api/config` | Source + index stats |
| `POST /api/index/rebuild` | Rebuild FTS + embeddings |
| `GET /api/manuals/{file}.pdf` | Serve local PDF |

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/rebuild_index.py` | Build FTS5 + vector index |
| `scripts/check_kb_json.py` | Validate article JSON |
| `scripts/sanitize_for_json.py` | Escape pasted body text |
| `scripts/new-kb-article.ps1` | Create stub article JSON |
