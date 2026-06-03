# Run API with voice assist in heuristic-only mode (no Ollama; hackathon-safe).
$env:HACKATHON_STRICT = "1"
$env:VOICE_USE_LLM = "0"
Set-Location (Join-Path $PSScriptRoot "..\backend")
& ".\.venv\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8001
