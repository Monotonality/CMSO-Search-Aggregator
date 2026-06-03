# Start CMSO Aggregated Troubleshooter (FastAPI on port 8001)
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$Backend = Join-Path $Root "backend"
$IndexDb = Join-Path $Root "data-sources\search_index.db"

if (-not (Test-Path $IndexDb)) {
    Write-Host "Building search index (first run, may take a few minutes)..."
    & (Join-Path $Backend ".venv\Scripts\python.exe") (Join-Path $Root "scripts\rebuild_index.py")
}

Set-Location $Backend
Write-Host "Starting server at http://127.0.0.1:8001/"
Write-Host "Press Ctrl+C to stop."
& ".\.venv\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8001
