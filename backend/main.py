from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

logger = logging.getLogger("uvicorn.error")

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from information_sources import filter_hits_by_source, parse_sources_param, sources_for_config
from local_kb import stats as kb_stats
from local_manuals import manuals_dir, stats as manual_stats
from search_index import (
    SEARCH_MODES,
    ensure_index,
    get_document,
    hybrid_search,
    index_stats,
    normalize_search_mode,
    rebuild_index,
    search_mode_info,
)
from hackathon_ai import compliance_summary
from voice_intent import check_ollama, extract_search_queries

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
DATA_SOURCES = ROOT / "data-sources"

APP_VERSION = "3.0.0-hybrid-search"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Serve the UI immediately; build/rebuild index in the background."""
    app.state.index_ready = False
    app.state.index_task = None

    async def _build_index() -> None:
        try:
            result = await asyncio.to_thread(ensure_index)
            app.state.index_ready = True
            logger.info("Search index ready: %s", result)
        except Exception as exc:
            logger.exception("Search index build failed: %s", exc)

    app.state.index_task = asyncio.create_task(_build_index())
    yield
    task = app.state.index_task
    if task and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="CMSO Signal",
    version="3.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:8000",
        "http://localhost:8000",
        "http://127.0.0.1:8001",
        "http://localhost:8001",
        "http://127.0.0.1:8002",
        "http://localhost:8002",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict[str, str]:
    idx = index_stats()
    building = bool(
        getattr(app.state, "index_task", None)
        and not app.state.index_task.done()
    )
    ready = bool(idx.get("ready", False)) or bool(getattr(app.state, "index_ready", False))
    return {
        "status": "ok",
        "version": APP_VERSION,
        "product": "CMSO Signal",
        "index_ready": str(ready and not building),
        "index_building": str(building),
    }


@app.get("/api/config")
async def config() -> dict[str, Any]:
    kb = kb_stats()
    manuals = manual_stats()
    idx = index_stats()
    return {
        "product": "CMSO Signal",
        "focus": "troubleshooting",
        "data_sources_root": str(DATA_SOURCES.relative_to(ROOT)),
        "kb": kb,
        "msi_library": manuals,
        "search_index": idx,
        "search_modes": [
            {
                "id": mode_id,
                "label": str(cfg["label"]),
                "description": str(cfg["description"]),
            }
            for mode_id, cfg in SEARCH_MODES.items()
        ],
        "information_sources": sources_for_config(),
        "hackathon_compliance": compliance_summary(),
    }


@app.get("/api/hackathon/compliance")
async def hackathon_compliance() -> dict[str, Any]:
    """2026 hackathon AI rules summary for judges and operators."""
    return compliance_summary()


@app.post("/api/index/rebuild")
async def index_rebuild() -> dict[str, Any]:
    """Rebuild FTS + vector index from data-sources."""
    return rebuild_index()


@app.get("/api/search")
async def search(
    q: str = "",
    limit: int = 20,
    mode: str = "hybrid",
    sources: str = "",
    min_similarity: float | None = None,
) -> dict[str, Any]:
    """Search with selectable mode: hybrid, keyword, semantic, or generic (balanced)."""
    search_mode = normalize_search_mode(mode)
    mode_meta = search_mode_info(search_mode)
    source_types = parse_sources_param(sources)

    if not q.strip():
        return {
            "query": q,
            "count": 0,
            "article_count": 0,
            "manual_count": 0,
            "results": [],
            "articles": [],
            "manuals": [],
            "search_mode": search_mode,
            "search_mode_label": mode_meta["label"],
            "sources": sources,
        }

    cap = min(limit, 50)
    all_types = parse_sources_param(None)
    if search_mode == "semantic":
        fetch_limit = min(cap * 6, 120)
    elif source_types < all_types:
        fetch_limit = min(cap * 4, 80)
    else:
        fetch_limit = cap
    hits = hybrid_search(
        q,
        limit=fetch_limit,
        search_mode=search_mode,
        min_similarity=min_similarity,
    )
    hits = filter_hits_by_source(hits, source_types)[:cap]
    results = [{k: v for k, v in h.items() if k != "doc_type"} for h in hits]
    articles = [r for r in results if r.get("source_type") == "kb"]
    manuals = [r for r in results if r.get("source_type") == "msi_library"]

    return {
        "query": q,
        "count": len(results),
        "article_count": len(articles),
        "manual_count": len(manuals),
        "results": results,
        "articles": articles,
        "manuals": manuals,
        "search_mode": search_mode,
        "search_mode_label": mode_meta["label"],
        "search_mode_description": mode_meta["description"],
        "min_similarity": mode_meta["min_similarity"],
        "sources": sources,
    }


class VoiceSegmentRequest(BaseModel):
    transcript_segment: str = Field(..., min_length=1, max_length=4000)
    mode: str = "hybrid"
    sources: str = ""
    max_queries: int = Field(2, ge=1, le=3)
    limit_per_query: int = Field(8, ge=1, le=20)
    use_llm: bool = True
    ollama_model: str | None = None


def _search_hits_for_voice(
    q: str,
    *,
    search_mode: str,
    sources: str,
    limit: int,
) -> list[dict[str, Any]]:
    source_types = parse_sources_param(sources)
    all_types = parse_sources_param(None)
    cap = min(limit, 20)
    if search_mode == "semantic":
        fetch_limit = min(cap * 6, 120)
    elif source_types < all_types:
        fetch_limit = min(cap * 4, 80)
    else:
        fetch_limit = cap
    hits = hybrid_search(q, limit=fetch_limit, search_mode=search_mode)
    hits = filter_hits_by_source(hits, source_types)[:cap]
    return [{k: v for k, v in h.items() if k != "doc_type"} for h in hits]


@app.get("/api/voice/status")
async def voice_status(model: str | None = Query(None)) -> dict[str, Any]:
    """Ollama availability for local voice query extraction."""
    status = await check_ollama(model)
    from voice_intent import voice_llm_enabled

    status["voice_llm_enabled"] = voice_llm_enabled()
    return status


@app.post("/api/voice/process-segment")
async def voice_process_segment(body: VoiceSegmentRequest) -> dict[str, Any]:
    """
    Turn a transcript chunk into search queries (Ollama) and run hybrid search
    with the client's current mode and source filters.
    """
    search_mode = normalize_search_mode(body.mode)
    intent = await extract_search_queries(
        body.transcript_segment,
        max_queries=body.max_queries,
        use_llm=body.use_llm,
        model=body.ollama_model,
    )
    queries: list[str] = intent.get("queries") or []
    segment = body.transcript_segment.strip()
    if not queries and len(segment) >= 8:
        from voice_intent import _strip_filler

        fallback = _strip_filler(segment)[:200]
        if fallback:
            queries = [fallback]
            intent = {**intent, "source": "heuristic", "queries": queries}
    bundles: list[dict[str, Any]] = []
    for q in queries:
        results = _search_hits_for_voice(
            q,
            search_mode=search_mode,
            sources=body.sources,
            limit=body.limit_per_query,
        )
        articles = [r for r in results if r.get("source_type") == "kb"]
        manuals = [r for r in results if r.get("source_type") == "msi_library"]
        bundles.append(
            {
                "query": q,
                "count": len(results),
                "article_count": len(articles),
                "manual_count": len(manuals),
                "results": results,
            }
        )

    return {
        "transcript_segment": body.transcript_segment.strip(),
        "queries": queries,
        "bundles": bundles,
        "intent_source": intent.get("source"),
        "ollama_error": intent.get("ollama_error"),
        "search_mode": search_mode,
        "search_mode_label": search_mode_info(search_mode)["label"],
        "sources": body.sources,
    }


@app.get("/api/document/{doc_id:path}")
async def document_detail(doc_id: str) -> dict[str, Any]:
    """Full document for expand-in-place view."""
    detail = get_document(doc_id)
    if not detail:
        raise HTTPException(
            status_code=404,
            detail=f"Document not found: {doc_id}. Run scripts/rebuild_index.py if the index is empty.",
        )
    return detail


@app.get("/api/manuals/{filename}")
async def get_manual(filename: str) -> FileResponse:
    safe_name = Path(filename).name
    if not safe_name.lower().endswith(".pdf"):
        raise HTTPException(status_code=404, detail="Manual not found")

    path = manuals_dir() / safe_name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Manual not found")

    return FileResponse(path, media_type="application/pdf", filename=safe_name)


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(FRONTEND / "index.html")


if FRONTEND.is_dir():
    app.mount("/static", StaticFiles(directory=FRONTEND), name="static")
