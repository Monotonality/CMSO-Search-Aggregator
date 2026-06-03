# M500 knowledge articles (local JSON)

Curated troubleshooting articles for the **M500** demo. Each file is one article you exported or wrote by hand.

## Add an article

1. Copy `_template.json` to `articles/KB00XXXXX.json` (use any stable `kb_number` id).
2. Fill `title`, `tags`, and `body` (body text powers search).
3. Validate: `python scripts/check_kb_json.py`

## Required fields

- `kb_number` — stable id (e.g. `KB0037462`)
- `title` — short description
- `product` — `M500`
- `body` — plain text (enables symptom/error search)

Optional: `summary`, `tags`. `permalink` — KB URL (if omitted, CMSO URL is built from `kb_number`). Use **Open KB** in search results.
