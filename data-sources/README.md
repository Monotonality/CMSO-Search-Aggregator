# Data sources (M500 troubleshooting demo)

Offline content only — no external APIs.

```
data-sources/
├── m500-kb/articles/     # Troubleshooting articles as JSON
└── msi-library/          # Public MSI PDF manuals + manifest.json
```

## M500 KB articles

| Folder | Contents | Used for |
|--------|----------|----------|
| **m500-kb/articles/** | One `.json` per article | KB-style troubleshooting search |

See `m500-kb/README.md`.

## MSI library manuals

| Folder | Contents | Used for |
|--------|----------|----------|
| **msi-library/** | PDF files you download from [MSI Library](https://www.motorolasolutions.com) | Manual search + in-app PDF open |
| **msi-library/manifest.json** | Title, tags, filename per manual | Metadata search (works even before PDFs are copied) |

1. Run `python scripts/download_msi_pdfs.py` to fetch M500 and SVX PDFs from the MSI docs API (or copy PDFs manually using `filename` in `manifest.json`).
2. Drop new PDFs in the project **`New PDF/`** folder, then run `python scripts/ingest_new_pdfs.py` to copy them into `msi-library/` and update `manifest.json`. PDFs already in `msi-library/` without a manifest row are still indexed automatically.
3. Run `python scripts/rebuild_index.py` — each PDF is split into **overlapping word chunks** (~350 words) with page numbers so search can surface relevant passages inside the manual.
4. Search results for manuals may show multiple **chunks** (e.g. `SVX User Guide — p. 12`) with snippets from inside the PDF. **Open PDF** opens the file locally when it is on disk.
