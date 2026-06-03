from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

# Word-based chunks (no extra tokenizer dependency).
CHUNK_WORDS = 350
CHUNK_OVERLAP = 60
MIN_CHUNK_WORDS = 40

# Skip localized legal/regulatory pages bundled in en-us PDFs.
_FRENCH_HINTS = (
    " le ",
    " la ",
    " les ",
    " des ",
    " pour ",
    " avec ",
    " dans ",
    " vous ",
    " une ",
    " est ",
    " sont ",
    " cette ",
    " votre ",
    " droit ",
    " garantie ",
    " sécurité ",
    " securite ",
    " avertissement ",
    " utilisation ",
    " appareil ",
    " défaillance ",
    " remboursement ",
)
_ENGLISH_HINTS = (
    " the ",
    " and ",
    " for ",
    " with ",
    " this ",
    " your ",
    " are ",
    " from ",
    " guide ",
    " warning ",
    " safety ",
    " device ",
    " charger ",
)


def is_primarily_french(text: str) -> bool:
    """Heuristic: Motorola en-us PDFs often append fr-ca / fr-fr legal sections."""
    sample = f" {(text or '').lower()} "
    if len(sample) < 80:
        return False
    fr = sum(sample.count(word) for word in _FRENCH_HINTS)
    en = sum(sample.count(word) for word in _ENGLISH_HINTS)
    if fr < 6:
        return False
    return fr > max(en, 1) * 1.15


@dataclass
class TextChunk:
    text: str
    chunk_index: int
    page_start: int | None = None
    page_end: int | None = None


def _words(text: str) -> list[str]:
    return re.findall(r"\S+", text)


def chunk_plain_text(text: str, *, chunk_words: int = CHUNK_WORDS) -> list[TextChunk]:
    """Split plain text into overlapping word windows."""
    words = _words(text)
    if not words:
        return []

    if len(words) <= chunk_words:
        return [TextChunk(text=" ".join(words), chunk_index=0)]

    chunks: list[TextChunk] = []
    start = 0
    index = 0
    while start < len(words):
        end = min(start + chunk_words, len(words))
        piece = " ".join(words[start:end])
        if len(_words(piece)) >= MIN_CHUNK_WORDS or not chunks:
            chunks.append(TextChunk(text=piece, chunk_index=index))
            index += 1
        if end >= len(words):
            break
        start = max(end - CHUNK_OVERLAP, start + 1)

    return chunks


def extract_pdf_pages(path: Path, *, max_pages: int = 200) -> list[tuple[int, str]]:
    if not path.is_file():
        return []
    try:
        from pypdf import PdfReader
    except ImportError:
        return []

    try:
        reader = PdfReader(str(path))
        pages: list[tuple[int, str]] = []
        for i, page in enumerate(reader.pages[:max_pages]):
            raw = page.extract_text() or ""
            cleaned = re.sub(r"\s+", " ", raw).strip()
            if cleaned:
                pages.append((i + 1, cleaned))
        return pages
    except Exception:
        return []


def chunk_pdf_pages(
    pages: list[tuple[int, str]],
    *,
    chunk_words: int = CHUNK_WORDS,
) -> list[TextChunk]:
    """
    Chunk PDF text while preserving page references.
    Short pages are merged; long pages are split into sub-chunks.
    """
    if not pages:
        return []

    chunks: list[TextChunk] = []
    buffer_words: list[str] = []
    buffer_page_start: int | None = None
    buffer_page_end: int | None = None
    chunk_index = 0

    def flush_buffer() -> None:
        nonlocal chunk_index, buffer_words, buffer_page_start, buffer_page_end
        if not buffer_words:
            return
        text = " ".join(buffer_words)
        if is_primarily_french(text):
            buffer_words = []
            buffer_page_start = None
            buffer_page_end = None
            return
        chunks.append(
            TextChunk(
                text=text,
                chunk_index=chunk_index,
                page_start=buffer_page_start,
                page_end=buffer_page_end,
            )
        )
        chunk_index += 1
        buffer_words = []
        buffer_page_start = None
        buffer_page_end = None

    for page_num, page_text in pages:
        if is_primarily_french(page_text):
            continue
        page_words = _words(page_text)
        if not page_words:
            continue

        if len(page_words) > chunk_words:
            flush_buffer()
            for sub in chunk_plain_text(page_text, chunk_words=chunk_words):
                chunks.append(
                    TextChunk(
                        text=sub.text,
                        chunk_index=chunk_index,
                        page_start=page_num,
                        page_end=page_num,
                    )
                )
                chunk_index += 1
            continue

        if buffer_words and len(buffer_words) + len(page_words) > chunk_words:
            flush_buffer()

        if not buffer_words:
            buffer_page_start = page_num
        buffer_page_end = page_num
        buffer_words.extend(page_words)

    flush_buffer()
    return chunks


def chunk_label(page_start: int | None, page_end: int | None, chunk_index: int) -> str:
    if page_start is not None and page_end is not None:
        if page_start == page_end:
            return f"p. {page_start}"
        return f"pp. {page_start}–{page_end}"
    return f"section {chunk_index + 1}"
