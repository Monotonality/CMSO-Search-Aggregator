"""Extract troubleshooting search queries from speech via local Ollama (optional fallback)."""

from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx

def _ollama_base_urls() -> list[str]:
    primary = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
    urls = [primary]
    if "127.0.0.1" in primary and "localhost" not in urls:
        urls.append(primary.replace("127.0.0.1", "localhost"))
    elif "localhost" in primary and "127.0.0.1" not in primary:
        urls.append(primary.replace("localhost", "127.0.0.1"))
    return urls


OLLAMA_BASE = _ollama_base_urls()[0]
OLLAMA_MODEL = os.environ.get(
    "OLLAMA_VOICE_MODEL",
    os.environ.get("OLLAMA_MODEL", "tinyllama"),
)
OLLAMA_TIMEOUT = float(os.environ.get("OLLAMA_TIMEOUT_SEC", "45"))


def voice_llm_enabled() -> bool:
    """Set VOICE_USE_LLM=0 to skip Ollama (heuristic query extraction only)."""
    return os.environ.get("VOICE_USE_LLM", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )

SYSTEM_PROMPT = """You extract technical troubleshooting search queries from spoken transcript segments.
Return JSON only with this shape: {"queries": ["query one", "query two"]}
Rules:
- Output 0 to 3 short search queries (product + symptom, error code, or hardware topic).
- Ignore greetings, filler, and off-topic chat.
- Prefer concrete terms: error codes, KB numbers (e.g. KB0058926), product names (M500, SVX).
- If nothing is searchable, return {"queries": []}.
"""

_KB_RE = re.compile(r"\bKB\d{6,8}\b", re.I)
_ERROR_RE = re.compile(r"\berror\s*#?\s*(\d{3,5})\b", re.I)
_PRODUCT_RE = re.compile(r"\b(M500|SVX\d*|APX\d*|IMPRE(?:SS)?)\b", re.I)
_FILLER_START = re.compile(
    r"^(?:"
    r"(?:i(?:'m| am)\s+)?having\s+(?:issues?|problems?)\s+with\s+"
    r"|(?:i\s+)?(?:have|got)\s+(?:a\s+)?(?:issues?|problems?)\s+with\s+"
    r"|(?:help|issue)\s+with\s+"
    r"|(?:um|uh|so|well),?\s+"
    r")+",
    re.I,
)
_SYMPTOM_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bno\s+power\b", re.I), "no power"),
    (re.compile(r"\bwon'?t\s+power\b", re.I), "won't power on"),
    (re.compile(r"\bnot\s+powering\b", re.I), "not powering on"),
    (re.compile(r"\bdead\b", re.I), "dead radio"),
    (re.compile(r"\bno\s+transmit\b", re.I), "no transmit"),
    (re.compile(r"\bno\s+audio\b", re.I), "no audio"),
]


def _normalize_query(q: str) -> str:
    return " ".join(q.split()).strip()


def _dedupe_queries(queries: list[str], max_queries: int) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in queries:
        q = _normalize_query(raw)
        if len(q) < 3:
            continue
        key = q.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(q[:200])
        if len(out) >= max_queries:
            break
    return out


def _parse_queries_json(text: str) -> list[str]:
    text = text.strip()
    if not text:
        return []
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            try:
                data = json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                return []
        else:
            return []
    if isinstance(data, dict):
        raw = data.get("queries") or data.get("search_queries") or []
    elif isinstance(data, list):
        raw = data
    else:
        return []
    if not isinstance(raw, list):
        return []
    return [str(x) for x in raw if x]


def _strip_filler(text: str) -> str:
    core = _FILLER_START.sub("", text).strip()
    return core or text


def _heuristic_queries(transcript: str, max_queries: int) -> list[str]:
    text = _normalize_query(transcript)
    if len(text) < 8:
        return []
    found: list[str] = []
    for m in _KB_RE.finditer(text):
        found.append(m.group(0).upper())
    for m in _ERROR_RE.finditer(text):
        found.append(f"error {m.group(1)}")
    if found:
        return _dedupe_queries(found, max_queries)

    products = [m.group(0).upper() for m in _PRODUCT_RE.finditer(text)]
    product = products[0] if products else None
    for pattern, label in _SYMPTOM_PATTERNS:
        if pattern.search(text):
            if product:
                found.append(f"{product} {label}")
            else:
                found.append(label)
    if found:
        return _dedupe_queries(found, max_queries)

    core = _strip_filler(text)
    if product and core and core.lower() != product.lower():
        found.append(core)
        if not any(product in q for q in found):
            found.append(f"{product} {core}")
    elif product:
        found.append(f"{product} troubleshooting")
    else:
        parts = re.split(r"(?<=[.!?])\s+", core)
        tail = parts[-1] if parts else core
        if len(tail) >= 8:
            found.append(tail)
        else:
            found.append(core[-160:])

    queries = _dedupe_queries(found, max_queries)
    if not queries and len(text) >= 8:
        queries = _dedupe_queries([core], max_queries)
    return queries


def _model_is_pulled(model: str, names: list[str]) -> bool:
    """True if tags list includes the configured model (with or without :tag)."""
    base = model.split(":")[0].lower()
    for name in names:
        n = name.lower()
        if n == model.lower() or n.split(":")[0] == base:
            return True
    return False


async def check_ollama() -> dict[str, Any]:
    """Whether Ollama is reachable and which model is configured."""
    if not voice_llm_enabled():
        return {
            "available": False,
            "base_url": OLLAMA_BASE,
            "model": OLLAMA_MODEL,
            "llm_disabled": True,
            "hint": "VOICE_USE_LLM=0 — using heuristic query extraction only.",
        }
    last_error: str | None = None
    for base in _ollama_base_urls():
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{base}/api/tags")
                r.raise_for_status()
                body = r.json()
                names = [
                    str(m.get("name", ""))
                    for m in body.get("models", [])
                    if m.get("name")
                ]
                pulled = _model_is_pulled(OLLAMA_MODEL, names)
                return {
                    "available": True,
                    "base_url": base,
                    "model": OLLAMA_MODEL,
                    "models": names[:12],
                    "model_pulled": pulled,
                    "hint": (
                        None
                        if pulled
                        else f'Model "{OLLAMA_MODEL}" not found. Run: ollama pull {OLLAMA_MODEL}'
                    ),
                }
        except Exception as exc:
            last_error = str(exc)
    return {
        "available": False,
        "base_url": OLLAMA_BASE,
        "model": OLLAMA_MODEL,
        "error": last_error or "Connection refused",
        "hint": (
            "Start Ollama, then pull a model. On corporate networks, "
            "cloudflarestorage.com is often blocked — try personal hotspot, "
            f"HTTPS_PROXY, or copy models from another PC. Smaller: ollama pull tinyllama"
        ),
    }


async def extract_search_queries(
    transcript: str,
    *,
    max_queries: int = 2,
    use_llm: bool = True,
) -> dict[str, Any]:
    """
    Return {"queries": [...], "source": "ollama"|"heuristic", "ollama_error": optional}.
    """
    text = _normalize_query(transcript)
    if len(text) < 8:
        return {"queries": [], "source": "none"}

    if not use_llm or not voice_llm_enabled():
        return {
            "queries": _heuristic_queries(text, max_queries),
            "source": "heuristic",
        }

    payload = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "format": "json",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Transcript segment:\n{text}"},
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            last_exc: Exception | None = None
            r = None
            for base in _ollama_base_urls():
                try:
                    r = await client.post(f"{base}/api/chat", json=payload)
                    r.raise_for_status()
                    break
                except Exception as exc:
                    last_exc = exc
                    r = None
            if r is None:
                raise last_exc or RuntimeError("Ollama unreachable")
            content = (
                r.json()
                .get("message", {})
                .get("content", "")
            )
        parsed = _parse_queries_json(content)
        queries = _dedupe_queries(parsed, max_queries)
        if queries:
            return {"queries": queries, "source": "ollama"}
    except Exception as exc:
        fallback = _heuristic_queries(text, max_queries)
        return {
            "queries": fallback,
            "source": "heuristic",
            "ollama_error": str(exc),
        }

    fallback = _heuristic_queries(text, max_queries)
    return {
        "queries": fallback,
        "source": "heuristic" if fallback else "ollama",
    }
