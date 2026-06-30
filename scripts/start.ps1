<#
.SYNOPSIS
  One-command startup for CMSO Signal (venv, index, Ollama check, API, browser).

.DESCRIPTION
  From project root:
    .\scripts\start.ps1
    .\scripts\start.ps1 -NoOllama
    .\scripts\start.ps1 -RebuildIndex
    .\scripts\start.ps1 -KillPort

  Or double-click run.cmd in the project folder.
#>
[CmdletBinding()]
param(
    [switch]$NoOllama,
    [switch]$RebuildIndex,
    [switch]$KillPort,
    [switch]$NoBrowser,
    [int]$Port = 8001
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$Backend = Join-Path $Root "backend"
$VenvPython = Join-Path $Backend ".venv\Scripts\python.exe"
$VenvPip = Join-Path $Backend ".venv\Scripts\pip.exe"
$Requirements = Join-Path $Backend "requirements.txt"
$IndexDb = Join-Path $Root "data-sources\search_index.db"
$RebuildScript = Join-Path $Root "scripts\rebuild_index.py"
$AppUrl = "http://127.0.0.1:$Port/"

function Write-Step([string]$n, [string]$msg) {
    Write-Host "`n=== $n - $msg ===" -ForegroundColor Cyan
}

function Ensure-Venv {
    if (Test-Path $VenvPython) { return }
    Write-Step "Setup" "Creating Python virtual environment"
    $py = Get-Command python -ErrorAction SilentlyContinue
    if (-not $py) {
        $py = Get-Command py -ErrorAction SilentlyContinue
        if ($py) {
            & py -3 -m venv (Join-Path $Backend ".venv")
        } else {
            throw "Python not found. Install Python 3.11+ and re-run."
        }
    } else {
        & python -m venv (Join-Path $Backend ".venv")
    }
    if (-not (Test-Path $VenvPython)) {
        throw "Failed to create venv at $Backend\.venv"
    }
}

function Ensure-Dependencies {
    Ensure-Venv
    Write-Step "Setup" "Installing dependencies (pip)"
    & $VenvPip install -q -r $Requirements
}

function Try-StartOllama {
    try {
        $null = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3
        return $true
    } catch {
        $candidates = @(
            "$env:LOCALAPPDATA\Programs\Ollama\Ollama.exe",
            "${env:ProgramFiles}\Ollama\Ollama.exe"
        )
        foreach ($exe in $candidates) {
            if (Test-Path $exe) {
                Write-Host "Starting Ollama app..."
                Start-Process -FilePath $exe | Out-Null
                foreach ($i in 1..12) {
                    Start-Sleep -Seconds 2
                    try {
                        $null = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3
                        return $true
                    } catch {
                        Write-Host "  Waiting for Ollama ($i/12)..."
                    }
                }
                break
            }
        }
        return $false
    }
}

function Test-OllamaModels {
    param([string]$Preferred = "gemma3:4b")
    try {
        $tags = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5
        $names = @($tags.models | ForEach-Object { $_.name })
        if ($names.Count -eq 0) {
            Write-Host "Ollama is running but no models are installed." -ForegroundColor Yellow
            Write-Host "  Run: ollama pull $Preferred"
            return $false
        }
        Write-Host "Ollama OK. Models: $($names -join ', ')"
        $hasPreferred = $names | Where-Object { $_ -like "$Preferred*" }
        if (-not $hasPreferred) {
            Write-Host "  Voice default is $Preferred - pull if you want LLM query extraction." -ForegroundColor Yellow
        }
        return $true
    } catch {
        return $false
    }
}

function Ensure-Index {
    if ($RebuildIndex -or -not (Test-Path $IndexDb)) {
        if ($RebuildIndex) {
            Write-Host "Rebuilding search index..."
        } else {
            Write-Host "First run - building search index (may take a few minutes)..."
        }
        & $VenvPython $RebuildScript
    } else {
        Write-Host "Search index found at data-sources\search_index.db"
        Write-Host "  Force rebuild: .\scripts\start.ps1 -RebuildIndex"
    }
}

function Get-ListenerPid([int]$listenPort) {
    $conn = Get-NetTCPConnection -LocalPort $listenPort -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($conn) { return $conn.OwningProcess }
    return $null
}

function Stop-PortListener([int]$listenPort) {
    $procId = Get-ListenerPid $listenPort
    if (-not $procId) { return $false }
    Write-Host "Stopping process on port $listenPort (PID $procId)..."
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    return -not (Get-ListenerPid $listenPort)
}

# --- main ---
Write-Host ""
Write-Host "CMSO Signal - startup" -ForegroundColor Green
Write-Host "Project: $Root"

Write-Step "1/5" "Python environment"
Ensure-Dependencies

Write-Step "2/5" "Search index"
Ensure-Index

Write-Step "3/5" "Ollama (optional voice LLM)"
if ($NoOllama) {
    Write-Host "Skipping Ollama (-NoOllama). Voice uses rule-based extraction only."
    $env:VOICE_USE_LLM = "0"
} else {
    $env:VOICE_USE_LLM = "1"
    if (Try-StartOllama) {
        Test-OllamaModels -Preferred "gemma3:4b" | Out-Null
    } else {
        Write-Host "Ollama not reachable - voice still works via rule-based extraction." -ForegroundColor Yellow
        Write-Host "  Install/start Ollama, or re-run with -NoOllama to hide LLM warnings."
    }
}

Write-Step "4/5" "Port $Port"
$existingPid = Get-ListenerPid $Port
if ($existingPid) {
    if ($KillPort) {
        if (-not (Stop-PortListener $Port)) {
            Write-Host "Could not free port $Port. Open $AppUrl if the app is already running." -ForegroundColor Yellow
            if (-not $NoBrowser) { Start-Process $AppUrl }
            exit 0
        }
    } else {
        Write-Host "Port $Port already in use (PID $existingPid)." -ForegroundColor Yellow
        Write-Host "  App may already be running: $AppUrl"
        Write-Host "  To restart: .\scripts\start.ps1 -KillPort"
        if (-not $NoBrowser) { Start-Process $AppUrl }
        exit 0
    }
}

Write-Step "5/5" "Backend API"
$env:HACKATHON_STRICT = "1"
$env:OLLAMA_VOICE_MODEL = "gemma3:4b"
$env:OLLAMA_TIMEOUT_SEC = "60"

Write-Host ""
Write-Host "Starting server at $AppUrl" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop."
Write-Host ""

if (-not $NoBrowser) {
    Start-Process $AppUrl
}

Set-Location $Backend
& $VenvPython -m uvicorn main:app --host 127.0.0.1 --port $Port
