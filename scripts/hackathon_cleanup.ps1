# Post-hackathon cleanup: remove local Ollama models used for CMSO Signal demos.
# Run from project root after the event. Review models before confirming.
$ErrorActionPreference = "Stop"

Write-Host "CMSO Signal — hackathon AI cleanup" -ForegroundColor Cyan
Write-Host "This script helps remove LOCAL Ollama models pulled for the demo."
Write-Host "Search index DB and KB/PDF data are not deleted."
Write-Host ""

$exe = $null
foreach ($p in @(
        (Get-Command ollama -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
        "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
        "${env:ProgramFiles}\Ollama\ollama.exe"
    )) {
    if ($p -and (Test-Path $p)) { $exe = $p; break }
}

if (-not $exe) {
    Write-Host "Ollama CLI not found — nothing to remove via ollama rm." -ForegroundColor Yellow
    exit 0
}

$list = & $exe list 2>$null
if (-not $list) {
    Write-Host "No models listed."
    exit 0
}

$names = @()
foreach ($line in ($list -split "`n" | Select-Object -Skip 1)) {
    $t = $line.Trim()
    if ($t) { $names += ($t -split '\s+')[0] }
}

if (-not $names.Count) {
    Write-Host "No models to remove."
    exit 0
}

Write-Host "Installed models:"
$names | ForEach-Object { Write-Host "  - $_" }
$confirm = Read-Host "Remove ALL listed models? (y/N)"
if ($confirm -ne 'y' -and $confirm -ne 'Y') {
    Write-Host "Cancelled."
    exit 0
}

foreach ($n in $names) {
    Write-Host "Removing $n ..."
    & $exe rm $n
}

Write-Host "Done. If the project continues, use AI Hub and AI Eval per hackathon guidance." -ForegroundColor Green
