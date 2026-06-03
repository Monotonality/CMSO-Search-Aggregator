from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from documents import collect_documents, source_paths
from embeddings import TFIDF_MODEL, embed_corpus, embed_query, ensure_tfidf_vectorizer
from local_manuals import MANUALS_DIR, _manual_url

ROOT = Path(__file__).resolve().parent.parent
INDEX_PATH = ROOT / "data-sources" / "search_index.db"
INDEX_VERSION = "2"
MAX_CHUNKS_PER_MANUAL = 4
DEFAULT_FTS_WEIGHT = 0.35
DEFAULT_VECTOR_WEIGHT = 0.65
DEFAULT_MIN_SIMILARITY = 0.2

# search_mode → weights and vector cutoff (see hybrid_search)
SEARCH_MODES: dict[str, dict[str, float | str]] = {
    "hybrid": {
        "label": "Smart mix",
        "description": "Keyword + semantic blend (default)",
        "fts_weight": 0.35,
        "vector_weight": 0.65,
        "min_similarity": 0.2,
    },
    "keyword": {
        "label": "Keyword",
        "description": "Full-text match (BM25) — exact terms and tags",
        "fts_weight": 1.0,
        "vector_weight": 0.0,
        "min_similarity": 0.0,
    },
    "semantic": {
        "label": "Semantic",
        "description": "Meaning similarity (TF-IDF vectors) — paraphrases",
        "fts_weight": 0.0,
        "vector_weight": 1.0,
        "min_similarity": 0.2,
    },
    "generic": {
        "label": "Balanced",
        "description": "Equal keyword and semantic weighting",
        "fts_weight": 0.5,
        "vector_weight": 0.5,
        "min_similarity": 0.15,
    },
}


def normalize_search_mode(mode: str | None) -> str:
    key = (mode or "hybrid").strip().lower()
    return key if key in SEARCH_MODES else "hybrid"


def search_mode_info(mode: str | None) -> dict[str, Any]:
    key = normalize_search_mode(mode)
    cfg = SEARCH_MODES[key]
    return {
        "id": key,
        "label": str(cfg["label"]),
        "description": str(cfg["description"]),
        "fts_weight": float(cfg["fts_weight"]),
        "vector_weight": float(cfg["vector_weight"]),
        "min_similarity": float(cfg["min_similarity"]),
    }


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _source_fingerprint() -> str:
    parts: list[str] = []
    for path in sorted(source_paths(), key=lambda p: str(p)):
        stat = path.stat()
        parts.append(f"{path.name}:{stat.st_mtime_ns}:{stat.st_size}")
    raw = "|".join(parts).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _pack_vector(vector: np.ndarray) -> bytes:
    return vector.astype(np.float32).tobytes()


def _unpack_vector(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32)


@contextmanager
def _connect():
    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(INDEX_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS index_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS documents (
            doc_id TEXT PRIMARY KEY,
            doc_type TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '',
            payload_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
            doc_id UNINDEXED,
            title,
            content,
            tags,
            tokenize='porter unicode61'
        );

        CREATE TABLE IF NOT EXISTS embeddings (
            doc_id TEXT PRIMARY KEY,
            dim INTEGER NOT NULL,
            vector BLOB NOT NULL,
            FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE
        );
        """
    )


def _set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO index_meta(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def _get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute(
        "SELECT value FROM index_meta WHERE key = ?", (key,)
    ).fetchone()
    return row["value"] if row else None


def _manual_root_id(doc_id: str) -> str | None:
    if not doc_id.startswith("manual:"):
        return None
    parts = doc_id.split(":")
    return parts[1] if len(parts) > 1 else None


def _pdf_url_with_page(url: str | None, page: int | None) -> str | None:
    if not url or page is None:
        return url
    return f"{url}#page={page}"


def index_stats() -> dict[str, Any]:
    if not INDEX_PATH.is_file():
        return {
            "ready": False,
            "document_count": 0,
            "model": "none",
            "vector_backend": "none",
            "path": str(INDEX_PATH.relative_to(ROOT)),
        }

    with _connect() as conn:
        _init_schema(conn)
        count = conn.execute("SELECT COUNT(*) AS c FROM documents").fetchone()["c"]
        chunk_count = conn.execute(
            "SELECT COUNT(*) AS c FROM documents WHERE doc_id LIKE 'manual:%:%'"
        ).fetchone()["c"]
        return {
            "ready": count > 0,
            "document_count": count,
            "manual_chunk_count": chunk_count,
            "built_at": _get_meta(conn, "built_at"),
            "model": _get_meta(conn, "embed_model"),
            "vector_backend": _get_meta(conn, "embed_model"),
            "source_fingerprint": _get_meta(conn, "source_fingerprint"),
            "path": str(INDEX_PATH.relative_to(ROOT)),
            "fts_weight": DEFAULT_FTS_WEIGHT,
            "vector_weight": DEFAULT_VECTOR_WEIGHT,
            "chunk_words": 350,
        }


def needs_rebuild() -> bool:
    if not INDEX_PATH.is_file():
        return True
    with _connect() as conn:
        _init_schema(conn)
        if _get_meta(conn, "index_version") != INDEX_VERSION:
            return True
        if conn.execute("SELECT COUNT(*) AS c FROM documents").fetchone()["c"] == 0:
            return True
        return _get_meta(conn, "source_fingerprint") != _source_fingerprint()


def rebuild_index() -> dict[str, Any]:
    docs = collect_documents()
    if not docs:
        return {"document_count": 0, "message": "No documents to index"}

    texts = [d.content or d.title for d in docs]
    vectors, embed_model, tfidf_blob = embed_corpus(texts)

    with _connect() as conn:
        _init_schema(conn)
        conn.execute("DELETE FROM embeddings")
        conn.execute("DELETE FROM documents")
        conn.execute("DELETE FROM documents_fts")

        for doc, vector in zip(docs, vectors):
            conn.execute(
                """
                INSERT INTO documents(doc_id, doc_type, title, content, tags, payload_json)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    doc.doc_id,
                    doc.doc_type,
                    doc.title,
                    doc.content,
                    doc.tags,
                    json.dumps(doc.payload, ensure_ascii=False),
                ),
            )
            conn.execute(
                """
                INSERT INTO documents_fts(doc_id, title, content, tags)
                VALUES (?, ?, ?, ?)
                """,
                (doc.doc_id, doc.title, doc.content, doc.tags),
            )
            conn.execute(
                """
                INSERT INTO embeddings(doc_id, dim, vector)
                VALUES (?, ?, ?)
                """,
                (doc.doc_id, int(vector.shape[0]), _pack_vector(vector)),
            )

        _set_meta(conn, "index_version", INDEX_VERSION)
        _set_meta(conn, "built_at", _utc_now())
        _set_meta(conn, "embed_model", embed_model)
        _set_meta(conn, "tfidf_vectorizer", tfidf_blob)
        _set_meta(conn, "source_fingerprint", _source_fingerprint())

    if embed_model == TFIDF_MODEL and tfidf_blob:
        ensure_tfidf_vectorizer(tfidf_blob)

    return {
        "document_count": len(docs),
        "built_at": _utc_now(),
        "model": embed_model,
        "vector_backend": embed_model,
    }


def ensure_index() -> dict[str, Any]:
    if not needs_rebuild():
        return {"document_count": index_stats()["document_count"], "skipped": True}
    try:
        return rebuild_index()
    except Exception as exc:
        stats = index_stats()
        if stats.get("document_count", 0) > 0:
            return {"skipped": True, "warning": str(exc), **stats}
        raise


def _kb_number_from_query(query: str) -> str | None:
    """Extract KB####### if the query is (or contains) a knowledge article number."""
    term = query.strip()
    m = re.search(r"\b(KB\s*\d{7})\b", term, flags=re.I)
    if m:
        return re.sub(r"\s+", "", m.group(1), flags=re.I).upper()
    m = re.fullmatch(r"KB\s*(\d{7})", term, flags=re.I)
    if m:
        return f"KB{m.group(1)}"
    return None


def _build_fts_query(query: str) -> str:
    parts: list[str] = []
    kb = _kb_number_from_query(query)
    if kb:
        parts.append(f'"{kb}"')
        digits = kb[2:]
        if digits:
            parts.append(f'"{digits}"')

    tokens = re.findall(r"[\w][\w-]*", query, flags=re.UNICODE)
    tokens = [t for t in tokens if len(t) >= 2]
    for t in tokens:
        quoted = f'"{t.replace(chr(34), "")}"'
        if quoted not in parts:
            parts.append(quoted)
    if not parts:
        return ""
    return " OR ".join(parts)


def _kb_direct_fts_boost(conn: sqlite3.Connection, query: str) -> dict[str, float]:
    kb = _kb_number_from_query(query)
    if not kb:
        return {}
    doc_id = f"article:{kb}"
    row = conn.execute(
        "SELECT 1 FROM documents WHERE doc_id = ?", (doc_id,)
    ).fetchone()
    if not row:
        return {}
    return {doc_id: 1.0}


def _normalize_scores(scores: dict[str, float]) -> dict[str, float]:
    if not scores:
        return {}
    lo = min(scores.values())
    hi = max(scores.values())
    if hi <= lo:
        return {k: 1.0 for k in scores}
    return {k: (v - lo) / (hi - lo) for k, v in scores.items()}


def _bm25_to_score(rank: float) -> float:
    return 1.0 / (1.0 + abs(float(rank)))


def _fts_search(conn: sqlite3.Connection, query: str, limit: int) -> dict[str, float]:
    fts_q = _build_fts_query(query)
    if not fts_q:
        return {}

    rows = conn.execute(
        """
        SELECT doc_id, bm25(documents_fts) AS rank
        FROM documents_fts
        WHERE documents_fts MATCH ?
        ORDER BY rank
        LIMIT ?
        """,
        (fts_q, limit),
    ).fetchall()

    return {row["doc_id"]: _bm25_to_score(row["rank"]) for row in rows}


def _vector_search(conn: sqlite3.Connection, query: str) -> dict[str, float]:
    model_name = _get_meta(conn, "embed_model") or ""
    tfidf_blob = _get_meta(conn, "tfidf_vectorizer") or ""
    if not model_name:
        return {}
    if model_name == TFIDF_MODEL and tfidf_blob:
        ensure_tfidf_vectorizer(tfidf_blob)

    query_vec = embed_query(query, model_name, tfidf_blob=tfidf_blob)
    if query_vec.size == 0:
        return {}

    scores: dict[str, float] = {}
    rows = conn.execute("SELECT doc_id, vector FROM embeddings").fetchall()
    for row in rows:
        doc_vec = _unpack_vector(row["vector"])
        if doc_vec.shape[0] != query_vec.shape[0]:
            continue
        doc_norm = np.linalg.norm(doc_vec)
        if doc_norm > 0:
            doc_vec = doc_vec / doc_norm
        sim = float(np.dot(query_vec, doc_vec))
        scores[row["doc_id"]] = max(0.0, min(1.0, sim))
    return scores


def _tags_from_doc(doc: sqlite3.Row, payload: dict[str, Any]) -> list[str]:
    raw = payload.get("tags")
    if isinstance(raw, list):
        return [str(t).strip() for t in raw if str(t).strip()]
    tags_col = (doc["tags"] or "").strip()
    if tags_col:
        return [t for t in tags_col.split() if t]
    return []


def _source_fields(doc_type: str) -> dict[str, str]:
    if doc_type == "article":
        return {
            "source_type": "kb",
            "source_label": "KB",
            "source": "m500-kb",
        }
    return {
        "source_type": "msi_library",
        "source_label": "MSI Library",
        "source": "msi-library",
    }


def _snippet(text: str, max_len: int = 220) -> str:
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    if not cleaned:
        return ""
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 1].rstrip() + "…"


def _result_row(
    doc: sqlite3.Row,
    *,
    score: float,
    fts_score: float,
    vector_score: float,
    similarity: float,
) -> dict[str, Any]:
    payload = json.loads(doc["payload_json"] or "{}")
    doc_type = doc["doc_type"]
    content = doc["content"] or ""

    if doc_type == "article":
        permalink = (payload.get("permalink") or "").strip() or None
        return {
            "doc_id": doc["doc_id"],
            "id": payload.get("number", doc["doc_id"]),
            "number": payload.get("number", ""),
            "title": doc["title"],
            "snippet": _snippet(payload.get("body") or content),
            "product": payload.get("product", "M500"),
            "permalink": permalink,
            "url": permalink,
            "tags": _tags_from_doc(doc, payload),
            "doc_type": "article",
            "score": round(score, 4),
            "fts_score": round(fts_score, 4),
            "vector_score": round(vector_score, 4),
            "similarity": round(similarity, 4),
            **_source_fields(doc_type),
        }

    manual_id = payload.get("manual_id", "")
    filename = (payload.get("filename") or "").strip()
    on_disk = bool(filename and (MANUALS_DIR / Path(filename).name).is_file())
    manual_stub = {
        "id": manual_id,
        "filename": filename,
        "source_url": payload.get("source_url", ""),
    }
    base_url = _manual_url(manual_stub) if manual_stub else None
    source_url = (payload.get("source_url") or "").strip() or None

    if payload.get("is_chunk"):
        chunk_text = (payload.get("chunk_text") or content).strip()
        page_start = payload.get("page_start")
        page_end = payload.get("page_end")
        return {
            "doc_id": doc["doc_id"],
            "id": manual_id or doc["doc_id"],
            "title": doc["title"],
            "parent_title": payload.get("parent_title") or doc["title"],
            "filename": filename,
            "snippet": _snippet(chunk_text),
            "url": _pdf_url_with_page(base_url, page_start),
            "permalink": source_url,
            "on_disk": on_disk,
            "is_chunk": True,
            "chunk_index": payload.get("chunk_index"),
            "page_start": page_start,
            "page_end": page_end,
            "tags": _tags_from_doc(doc, payload),
            "doc_type": "manual",
            "score": round(score, 4),
            "fts_score": round(fts_score, 4),
            "vector_score": round(vector_score, 4),
            "similarity": round(similarity, 4),
            **_source_fields(doc_type),
        }

    return {
        "doc_id": doc["doc_id"],
        "id": manual_id or doc["doc_id"],
        "title": doc["title"],
        "filename": filename,
        "snippet": _snippet(payload.get("summary") or content),
        "url": base_url,
        "permalink": source_url,
        "on_disk": on_disk,
        "tags": _tags_from_doc(doc, payload),
        "doc_type": "manual",
        "score": round(score, 4),
        "fts_score": round(fts_score, 4),
        "vector_score": round(vector_score, 4),
        "similarity": round(similarity, 4),
        **_source_fields(doc_type),
    }


def _resolve_doc_id(conn: sqlite3.Connection, doc_id: str) -> str | None:
    raw = (doc_id or "").strip()
    if not raw:
        return None
    if conn.execute(
        "SELECT 1 FROM documents WHERE doc_id = ?", (raw,)
    ).fetchone():
        return raw
    m = re.fullmatch(r"KB\s*(\d{6,8})", raw, flags=re.I)
    if m:
        candidate = f"article:KB{m.group(1)}"
        if conn.execute(
            "SELECT 1 FROM documents WHERE doc_id = ?", (candidate,)
        ).fetchone():
            return candidate
    if not raw.startswith(("article:", "manual:")):
        for prefix in ("article:", "manual:"):
            candidate = f"{prefix}{raw}"
            if conn.execute(
                "SELECT 1 FROM documents WHERE doc_id = ?", (candidate,)
            ).fetchone():
                return candidate
    return None


def get_document(doc_id: str) -> dict[str, Any] | None:
    with _connect() as conn:
        _init_schema(conn)
        resolved = _resolve_doc_id(conn, doc_id) or doc_id.strip()
        row = conn.execute(
            "SELECT * FROM documents WHERE doc_id = ?", (resolved,)
        ).fetchone()
        if not row:
            return None

        payload = json.loads(row["payload_json"] or "{}")
        doc_type = row["doc_type"]

        if doc_type == "article":
            permalink = (payload.get("permalink") or "").strip() or None
            return {
                "doc_id": row["doc_id"],
                "doc_type": "article",
                "number": payload.get("number", ""),
                "title": row["title"],
                "summary": payload.get("summary", ""),
                "body": payload.get("body", ""),
                "tags": payload.get("tags") or [],
                "product": payload.get("product", "M500"),
                "permalink": permalink,
                "url": permalink,
            }

        manual_id = payload.get("manual_id", "")
        filename = (payload.get("filename") or "").strip()
        on_disk = bool(filename and (MANUALS_DIR / Path(filename).name).is_file())
        manual_stub = {
            "id": manual_id,
            "filename": filename,
            "source_url": payload.get("source_url", ""),
        }
        pdf_url = _manual_url(manual_stub) if manual_stub else None
        source_url = (payload.get("source_url") or "").strip() or None

        if payload.get("is_chunk"):
            page_start = payload.get("page_start")
            return {
                "doc_id": row["doc_id"],
                "doc_type": "manual",
                "title": row["title"],
                "parent_title": payload.get("parent_title", ""),
                "summary": payload.get("summary", ""),
                "body": payload.get("chunk_text") or row["content"] or "",
                "tags": (row["tags"] or "").split(),
                "filename": filename,
                "on_disk": on_disk,
                "is_chunk": True,
                "page_start": page_start,
                "page_end": payload.get("page_end"),
                "chunk_index": payload.get("chunk_index"),
                "url": _pdf_url_with_page(pdf_url, page_start),
                "permalink": source_url,
            }

        return {
            "doc_id": row["doc_id"],
            "doc_type": "manual",
            "title": row["title"],
            "summary": payload.get("summary", ""),
            "body": row["content"] or payload.get("summary", ""),
            "tags": (row["tags"] or "").split(),
            "filename": filename,
            "on_disk": on_disk,
            "url": pdf_url,
            "permalink": source_url,
        }


def hybrid_search(
    query: str,
    *,
    limit: int = 20,
    search_mode: str = "hybrid",
    min_similarity: float | None = None,
    fts_weight: float | None = None,
    vector_weight: float | None = None,
) -> list[dict[str, Any]]:
    term = query.strip()
    if not term:
        return []

    mode_key = normalize_search_mode(search_mode)
    mode_cfg = search_mode_info(mode_key)
    fts_w = float(fts_weight if fts_weight is not None else mode_cfg["fts_weight"])
    vec_w = float(vector_weight if vector_weight is not None else mode_cfg["vector_weight"])
    min_sim = float(
        min_similarity if min_similarity is not None else mode_cfg["min_similarity"]
    )

    with _connect() as conn:
        _init_schema(conn)
        fts_limit = limit * 3 if mode_key != "semantic" else limit
        fts_raw = _fts_search(conn, term, limit=fts_limit)
        fts_raw = {**fts_raw, **_kb_direct_fts_boost(conn, term)}
        vec_raw = _vector_search(conn, term)

    if mode_key == "keyword":
        all_ids = set(fts_raw)
    elif mode_key == "semantic":
        all_ids = {doc_id for doc_id, sim in vec_raw.items() if sim >= min_sim}
    else:
        all_ids = set(fts_raw) | set(vec_raw)
    if not all_ids:
        return []

    fts_norm = _normalize_scores(fts_raw)
    vec_norm = _normalize_scores({k: vec_raw[k] for k in all_ids if k in vec_raw})

    combined: list[tuple[float, str, float, float, float]] = []
    for doc_id in all_ids:
        fts_s = fts_norm.get(doc_id, 0.0)
        vec_sim = vec_raw.get(doc_id, 0.0)
        vec_s = vec_norm.get(doc_id, 0.0)
        if mode_key == "keyword":
            if fts_s == 0.0:
                continue
        elif mode_key == "semantic":
            if vec_sim < min_sim:
                continue
        elif vec_sim < min_sim and fts_s == 0.0:
            continue
        score = fts_w * fts_s + vec_w * vec_s
        combined.append((score, doc_id, fts_s, vec_sim, vec_sim))

    combined.sort(key=lambda x: (-x[0], x[1]))

    manual_hits: dict[str, int] = {}
    capped: list[tuple[float, str, float, float, float]] = []
    for item in combined:
        root = _manual_root_id(item[1])
        if root and (":" in item[1][len("manual:") :]):
            if manual_hits.get(root, 0) >= MAX_CHUNKS_PER_MANUAL:
                continue
            manual_hits[root] = manual_hits.get(root, 0) + 1
        capped.append(item)
        if len(capped) >= limit:
            break

    with _connect() as conn:
        results: list[dict[str, Any]] = []
        for score, doc_id, fts_s, _, sim in capped:
            row = conn.execute(
                "SELECT * FROM documents WHERE doc_id = ?", (doc_id,)
            ).fetchone()
            if not row:
                continue
            results.append(
                _result_row(
                    row,
                    score=score,
                    fts_score=fts_s,
                    vector_score=vec_raw.get(doc_id, 0.0),
                    similarity=sim,
                )
            )
        return results
