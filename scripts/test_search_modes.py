"""Smoke-test search modes and source filters against local API or in-process."""
from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:8001"


def api_search(q: str, mode: str = "hybrid", sources: str = "", limit: int = 5) -> dict:
    params = urllib.parse.urlencode({"q": q, "mode": mode, "limit": limit, "sources": sources})
    url = f"{BASE}/api/search?{params}"
    with urllib.request.urlopen(url, timeout=60) as resp:
        return json.loads(resp.read())


def inprocess_search(q: str, mode: str, sources: str = "", limit: int = 5) -> dict:
    sys.path.insert(0, str(__file__).replace("scripts\\test_search_modes.py", "backend").replace(
        "scripts/test_search_modes.py", "backend"
    ))
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(root / "backend"))
    from information_sources import filter_hits_by_source, parse_sources_param
    from main import normalize_search_mode  # noqa: F401
    from search_index import hybrid_search, search_mode_info

    mode_key = mode
    source_types = parse_sources_param(sources or None)
    all_types = parse_sources_param(None)
    cap = limit
    fetch_limit = cap if source_types >= all_types else min(cap * 4, 80)
    hits = hybrid_search(q, limit=fetch_limit, search_mode=mode_key)
    hits = filter_hits_by_source(hits, source_types)[:cap]
    meta = search_mode_info(mode_key)
    results = [{k: v for k, v in h.items() if k != "doc_type"} for h in hits]
    return {
        "count": len(results),
        "search_mode": mode_key,
        "search_mode_label": meta["label"],
        "results": results,
    }


def run(use_api: bool = True) -> int:
    search_fn = api_search if use_api else inprocess_search
    failures: list[str] = []

    try:
        cfg_url = f"{BASE}/api/config"
        with urllib.request.urlopen(cfg_url, timeout=10) as resp:
            cfg = json.loads(resp.read())
        modes = [m["id"] for m in cfg.get("search_modes", [])]
        sources = cfg.get("information_sources", [])
    except Exception as exc:
        print(f"API unavailable ({exc}); using in-process search")
        search_fn = inprocess_search
        modes = ["hybrid", "keyword", "semantic", "generic"]
        sources = []

    expected_modes = {"hybrid", "keyword", "semantic", "generic"}
    if not expected_modes.issubset(set(modes)):
        failures.append(f"config missing modes: {expected_modes - set(modes)}")

    print("=== Search modes ===")
    for mode in ["hybrid", "keyword", "semantic", "generic"]:
        data = search_fn("power", mode=mode)
        n = data["count"]
        top = data["results"][0] if data["results"] else {}
        sim = top.get("similarity", 0)
        fts = top.get("fts_score", 0)
        print(
            f"  {mode:8} count={n} label={data.get('search_mode_label', mode)} "
            f"top_sim={sim:.3f} top_fts={fts:.3f}"
        )
        if n == 0:
            failures.append(f"{mode}: no results for 'power'")
        if mode == "keyword" and n > 0 and fts <= 0:
            failures.append(f"{mode}: expected fts_score > 0 on top hit")
        if mode == "semantic" and n > 0 and sim < 0.05:
            failures.append(f"{mode}: expected meaningful similarity on top hit")

    print("=== Source filters ===")
    data_all = search_fn("installation", mode="hybrid", sources="kb,msi_library")
    data_msi = search_fn("installation", mode="hybrid", sources="msi_library")
    if data_msi["count"] and not all(
        r.get("source_type") == "msi_library" for r in data_msi["results"]
    ):
        failures.append("msi_library filter returned non-manual rows")
    print(f"  both sources: {data_all['count']} hits")
    print(f"  msi only:     {data_msi['count']} hits")

    if failures:
        print("\nFAILED:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
