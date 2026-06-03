# Run API with voice assist in heuristic-only mode (no Ollama downloads required).
$env:VOICE_USE_LLM = "0"
Set-Location (Join-Path $PSScriptRoot "..\backend")
& ".\.venv\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8001
