from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from chunking import chunk_label, chunk_pdf_pages, extract_pdf_pages
from local_kb import article_permalink, load_articles
from local_manuals import MANUALS_DIR, load_manuals

ROOT = Path(__file__).resolve().parent.parent


@dataclass
class IndexDocument:
    doc_id: str
    doc_type: str
    title: str
    content: str
    tags: str = ""
    payload: dict[str, Any] = field(default_factory=dict)


def _clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def _manual_base_payload(manual: dict[str, Any], manual_id: str) -> dict[str, Any]:
    return {
        "manual_id": manual_id,
        "filename": (manual.get("filename") or "").strip(),
        "source_url": (manual.get("source_url") or "").strip(),
        "summary": (manual.get("summary") or "").strip(),
    }


def _manual_chunk_documents(
    manual: dict[str, Any],
    manual_id: str,
    title: str,
    tags: str,
    pdf_path: Path,
) -> list[IndexDocument]:
    pages = extract_pdf_pages(pdf_path)
    chunks = chunk_pdf_pages(pages)
    if not chunks:
        return []

    base = _manual_base_payload(manual, manual_id)
    docs: list[IndexDocument] = []
    for chunk in chunks:
        section = chunk_label(chunk.page_start, chunk.page_end, chunk.chunk_index)
        chunk_title = f"{title} — {section}"
        content = _clean_text(f"{title}. {tags}. {chunk.text}")
        doc_id = f"manual:{manual_id}:chunk:{chunk.chunk_index:04d}"
        if chunk.page_start is not None:
            doc_id = (
                f"manual:{manual_id}:p{chunk.page_start:03d}:c{chunk.chunk_index:02d}"
            )

        docs.append(
            IndexDocument(
                doc_id=doc_id,
                doc_type="manual",
                title=chunk_title,
                content=content,
                tags=tags,
                payload={
                    **base,
                    "parent_title": title,
                    "is_chunk": True,
                    "chunk_index": chunk.chunk_index,
                    "page_start": chunk.page_start,
                    "page_end": chunk.page_end,
                    "chunk_text": chunk.text,
                },
            )
        )
    return docs


def collect_documents() -> list[IndexDocument]:
    docs: list[IndexDocument] = []

    for article in load_articles():
        kb = (article.get("kb_number") or "").upper()
        if not kb:
            continue
        title = (article.get("title") or kb).strip()
        summary = (article.get("summary") or "").strip()
        body = (article.get("body") or "").strip()
        tag_list = list(article.get("tags") or [])
        if kb and kb not in {str(t).upper() for t in tag_list}:
            tag_list.insert(0, kb)
        tags = " ".join(str(t) for t in tag_list)
        product = (article.get("product") or "M500").strip()
        content = _clean_text(f"{kb}. {title}. {summary}. {body}")
        docs.append(
            IndexDocument(
                doc_id=f"article:{kb}",
                doc_type="article",
                title=title,
                content=content,
                tags=tags,
                payload={
                    "number": kb,
                    "product": product,
                    "summary": summary,
                    "body": body,
                    "permalink": article_permalink(article),
                    "tags": article.get("tags") or [],
                },
            )
        )

    for manual in load_manuals():
        manual_id = (manual.get("id") or "").strip()
        if not manual_id:
            continue
        title = (manual.get("title") or manual_id).strip()
        summary = (manual.get("summary") or "").strip()
        tags = " ".join(manual.get("tags") or [])
        filename = (manual.get("filename") or "").strip()
        pdf_path = MANUALS_DIR / Path(filename).name if filename else None

        if pdf_path and pdf_path.is_file():
            chunk_docs = _manual_chunk_documents(
                manual, manual_id, title, tags, pdf_path
            )
            if chunk_docs:
                docs.extend(chunk_docs)
                continue

        content = _clean_text(f"{title}. {summary}. {tags}")
        docs.append(
            IndexDocument(
                doc_id=f"manual:{manual_id}",
                doc_type="manual",
                title=title,
                content=content,
                tags=tags,
                payload=_manual_base_payload(manual, manual_id),
            )
        )

    return docs


def source_paths() -> list[Path]:
    paths: list[Path] = []
    kb_dir = ROOT / "data-sources" / "m500-kb" / "articles"
    if kb_dir.is_dir():
        paths.extend(kb_dir.glob("KB*.json"))
    manifest = ROOT / "data-sources" / "msi-library" / "manifest.json"
    if manifest.is_file():
        paths.append(manifest)
    if MANUALS_DIR.is_dir():
        paths.extend(MANUALS_DIR.glob("*.pdf"))
    return paths
