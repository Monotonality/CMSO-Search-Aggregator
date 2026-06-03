"""Download MSI Library preprocessed PDFs listed in manifest.json (or via API)."""
from __future__ import annotations

import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIBRARY = ROOT / "data-sources" / "msi-library"
MANIFEST = LIBRARY / "manifest.json"
API = "https://docs-be.motorolasolutions.com"


def _slug(title: str, bundle_id: str) -> str:
    base = re.sub(r"[^\w\s-]", "", title)
    base = re.sub(r"\s+", "_", base.strip())[:72] or f"bundle_{bundle_id}"
    return f"{base}.pdf"


def fetch_svx_bundles() -> list[dict]:
    import urllib.parse

    params = urllib.parse.urlencode({"labelkey": "product_az_svx", "pageSize": 100})
    url = f"{API}/api/bundlelist?{params}"
    req = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
    )
    data = json.loads(urllib.request.urlopen(req, timeout=120).read())
    out: list[dict] = []
    for b in data.get("bundle_list") or []:
        pdf_url = (b.get("preprocessed_PDF") or "").strip()
        if not pdf_url:
            continue
        bid = str(b.get("name") or "")
        title = (b.get("title") or bid).strip()
        desc = (b.get("shortDescription") or title).strip()
        out.append(
            {
                "id": f"svx-{bid}",
                "title": title,
                "filename": _slug(title, bid),
                "summary": desc,
                "tags": ["SVX", "MSI Library", "body camera", "VRSM"],
                "source_url": pdf_url,
            }
        )
    return out


def download_pdf(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = resp.read()
    if not data.startswith(b"%PDF"):
        raise ValueError(f"{dest.name}: not a PDF ({len(data)} bytes)")
    dest.write_bytes(data)


def main() -> int:
    LIBRARY.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    m500 = [m for m in manifest.get("manuals") or [] if "M500" in str(m.get("tags") or [])]
    svx = fetch_svx_bundles()
    manifest["product"] = "M500, SVX"
    manifest["manuals"] = m500 + svx
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    ok, fail = 0, 0
    for manual in manifest["manuals"]:
        url = (manual.get("source_url") or "").strip()
        name = (manual.get("filename") or "").strip()
        if not url or not name:
            continue
        dest = LIBRARY / name
        print(f"Downloading {name} ...", flush=True)
        try:
            download_pdf(url, dest)
            print(f"  OK {dest.stat().st_size:,} bytes", flush=True)
            ok += 1
        except Exception as exc:
            print(f"  FAIL {exc}", flush=True)
            fail += 1

    print(f"Done: {ok} downloaded, {fail} failed, {len(manifest['manuals'])} in manifest")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
