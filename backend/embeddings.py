from __future__ import annotations

import base64
import hashlib
import os
import pickle
from typing import Any

import numpy as np

FASTEMBED_MODEL = "BAAI/bge-small-en-v1.5"
TFIDF_MODEL = "tfidf-sklearn"

_embedder: Any | None = None
_embed_mode: str | None = None
_tfidf_vectorizer: Any | None = None
_tfidf_blob_hash: str | None = None


def embed_mode() -> str:
    return _embed_mode or "none"


def _load_fastembed():
    global _embedder, _embed_mode
    from fastembed import TextEmbedding

    _embedder = TextEmbedding(model_name=FASTEMBED_MODEL)
    _embed_mode = FASTEMBED_MODEL


def _fit_tfidf(texts: list[str]) -> list[np.ndarray]:
    global _tfidf_vectorizer, _embed_mode
    from sklearn.feature_extraction.text import TfidfVectorizer

    _tfidf_vectorizer = TfidfVectorizer(stop_words="english", max_features=8000)
    matrix = _tfidf_vectorizer.fit_transform(texts)
    _embed_mode = TFIDF_MODEL
    return [_row_vector(matrix, i) for i in range(matrix.shape[0])]


def _row_vector(matrix: Any, index: int) -> np.ndarray:
    row = matrix.getrow(index)
    dense = np.asarray(row.todense()).reshape(-1).astype(np.float32)
    norm = np.linalg.norm(dense)
    if norm > 0:
        dense = dense / norm
    return dense


def serialize_tfidf_vectorizer() -> str:
    if _tfidf_vectorizer is None:
        return ""
    return base64.b64encode(pickle.dumps(_tfidf_vectorizer)).decode("ascii")


def _blob_hash(blob: str) -> str:
    return hashlib.sha256(blob.encode("ascii")).hexdigest()


def ensure_tfidf_vectorizer(blob: str) -> None:
    """Reload vectorizer when the index was rebuilt in another process."""
    global _tfidf_vectorizer, _embed_mode, _tfidf_blob_hash
    if not blob:
        raise RuntimeError("TF-IDF vectorizer blob missing from index metadata")
    digest = _blob_hash(blob)
    if _tfidf_vectorizer is not None and _tfidf_blob_hash == digest:
        return
    _tfidf_vectorizer = pickle.loads(base64.b64decode(blob.encode("ascii")))
    _embed_mode = TFIDF_MODEL
    _tfidf_blob_hash = digest


def load_tfidf_vectorizer(blob: str) -> None:
    ensure_tfidf_vectorizer(blob)


def _use_fastembed() -> bool:
    return os.getenv("USE_FASTEMBED", "").lower() in ("1", "true", "yes")


def embed_corpus(texts: list[str]) -> tuple[list[np.ndarray], str, str]:
    """
    Returns (vectors, model_name, optional tfidf_serialized).
    Defaults to TF-IDF (offline). Set USE_FASTEMBED=1 to try FastEmbed first.
    """
    if not texts:
        return [], "none", ""

    if _use_fastembed():
        try:
            _load_fastembed()
            vectors = [
                np.asarray(v, dtype=np.float32) for v in _embedder.embed(texts)
            ]
            return vectors, FASTEMBED_MODEL, ""
        except Exception:
            pass

    vectors = _fit_tfidf(texts)
    return vectors, TFIDF_MODEL, serialize_tfidf_vectorizer()


def embed_query(query: str, model_name: str, tfidf_blob: str = "") -> np.ndarray:
    if not query.strip():
        return np.array([], dtype=np.float32)

    if model_name == TFIDF_MODEL:
        ensure_tfidf_vectorizer(tfidf_blob)
        vec = _tfidf_vectorizer.transform([query])
        return _row_vector(vec, 0)

    if _embedder is None or _embed_mode != FASTEMBED_MODEL:
        _load_fastembed()
    vector = np.asarray(next(_embedder.embed([query])), dtype=np.float32)
    norm = np.linalg.norm(vector)
    if norm > 0:
        vector = vector / norm
    return vector
