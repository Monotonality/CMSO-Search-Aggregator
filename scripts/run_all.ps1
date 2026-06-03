# Run CMSO Signal in order (from project root).
# Prerequisite: Ollama running in another terminal (ollama serve / Ollama app).
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$Backend = Join-Path $Root "backend"
$IndexDb = Join-Path $Root "data-sources\search_index.db"
$Python = Join-Path $Backend ".venv\Scripts\python.exe"

Write-Host "=== 1/4 Ollama ===" -ForegroundColor Cyan
try {
    $tags = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5
    $names = @($tags.models | ForEach-Object { $_.name })
    if ($names.Count) {
        Write-Host "Ollama OK. Models: $($names -join ', ')"
    } else {
        Write-Host "Ollama is up but no models listed. Pull yours, e.g.: ollama pull gemma4:31b-cloud"
    }
} catch {
    Write-Host "Ollama not reachable at http://127.0.0.1:11434 — start Ollama first, then re-run." -ForegroundColor Yellow
}

Write-Host "`n=== 2/4 Search index ===" -ForegroundColor Cyan
if (-not (Test-Path $IndexDb)) {
    Write-Host "Building index (first run)..."
    & $Python (Join-Path $Root "scripts\rebuild_index.py")
} else {
    Write-Host "Index DB found — skipping rebuild. To force: python scripts\rebuild_index.py"
}

Write-Host "`n=== 3/4 Port 8001 ===" -ForegroundColor Cyan
$listener = Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    Write-Host "Port 8001 already in use (PID $($listener.OwningProcess)). Open http://127.0.0.1:8001/ or stop that process first."
    exit 0
}

Write-Host "`n=== 4/4 Backend ===" -ForegroundColor Cyan
$env:OLLAMA_VOICE_MODEL = "gemma4:31b-cloud"
$env:VOICE_USE_LLM = "1"
$env:OLLAMA_TIMEOUT_SEC = "120"
Set-Location $Backend
Write-Host "Voice LLM: $env:OLLAMA_VOICE_MODEL"
Write-Host "Starting http://127.0.0.1:8001/ (Ctrl+C to stop)"
& $Python -m uvicorn main:app --host 127.0.0.1 --port 8001
