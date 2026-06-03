# Create a stub JSON article for the local M500 KB.
# Usage: .\new-kb-article.ps1 KB0037462

param(
    [Parameter(Mandatory = $true)]
    [string]$KbNumber
)

if ($KbNumber -notmatch "^(KB\d{7})$") {
    Write-Error "KbNumber must look like KB0037462"
    exit 1
}

$kb = $Matches[1].ToUpper()
$projectRoot = Split-Path $PSScriptRoot -Parent
$articles = Join-Path $projectRoot "data-sources\m500-kb\articles"
$out = Join-Path $articles "$kb.json"

if (Test-Path $out) {
    Write-Host "Already exists: $out"
    exit 0
}

$obj = @{
    kb_number = $kb
    title     = "M500 troubleshooting article title"
    product   = "M500"
    tags      = @("M500")
    summary   = ""
    body      = "Paste full article text here."
} | ConvertTo-Json -Depth 4

$obj | Set-Content -Path $out -Encoding utf8
Write-Host "Created $out"
