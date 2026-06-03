from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_KB_DIR = ROOT / "data-sources" / "m500-kb" / "articles"
DEFAULT_PERMALINK_TEMPLATE = (
    "https://cmsosnow.service-now.com/kb?id=kb_article_view&sysparm_article={kb_number}"
)


def article_permalink(article: dict[str, Any]) -> str:
    """Explicit permalink in JSON, or built from kb_number."""
    explicit = (article.get("permalink") or "").strip()
    if explicit:
        return explicit
    kb = (article.get("kb_number") or "").upper()
    if kb:
        return DEFAULT_PERMALINK_TEMPLATE.format(kb_number=kb)
    return ""


def kb_data_dir() -> Path:
    return DEFAULT_KB_DIR


def load_articles() -> list[dict[str, Any]]:
    directory = kb_data_dir()
    if not directory.is_dir():
        return []

    articles: list[dict[str, Any]] = []
    for path in sorted(directory.glob("*.json")):
        if path.name.startswith("_"):
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if isinstance(data, dict) and data.get("kb_number"):
            articles.append(data)
    return articles


def stats() -> dict[str, Any]:
    articles = load_articles()
    with_body = sum(1 for a in articles if (a.get("body") or "").strip())
    return {
        "enabled": kb_data_dir().is_dir(),
        "article_count": len(articles),
        "with_body_count": with_body,
        "path": str(kb_data_dir().relative_to(ROOT)),
    }


def _score(article: dict[str, Any], query: str) -> int:
    q = query.lower()
    score = 0
    fields = [
        article.get("kb_number", ""),
        article.get("title", ""),
        article.get("summary", ""),
        article.get("body", ""),
        article.get("product", ""),
        " ".join(article.get("tags") or []),
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
        return "No body text in this article yet."
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 1].rstrip() + "…"


def search(query: str, limit: int = 20) -> list[dict[str, Any]]:
    term = query.strip()
    if not term:
        return []

    ranked: list[tuple[int, dict[str, Any]]] = []
    for article in load_articles():
        score = _score(article, term)
        if score > 0:
            ranked.append((score, article))

    ranked.sort(key=lambda x: (-x[0], x[1].get("kb_number", "")))

    results: list[dict[str, Any]] = []
    for _, article in ranked[:limit]:
        body = article.get("body") or ""
        results.append(
            {
                "id": article.get("kb_number", ""),
                "number": article.get("kb_number", ""),
                "title": article.get("title") or article.get("kb_number", ""),
                "summary": article.get("summary", ""),
                "snippet": _snippet(body or article.get("summary", "")),
                "product": article.get("product", ""),
                "source": "m500-kb",
            }
        )
    return results
