param(
    [switch]$InstallOnly
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Venv = Join-Path $ProjectRoot ".venv"
$Python = Join-Path $Venv "Scripts\python.exe"

if (-not (Test-Path $Python)) {
    py -3.13 -m venv $Venv
}
& $Python -m pip install --upgrade pip
& $Python -m pip install -e "$ProjectRoot[dev]"

if (-not (Test-Path (Join-Path $ProjectRoot ".env"))) {
    Copy-Item (Join-Path $ProjectRoot ".env.example") (Join-Path $ProjectRoot ".env")
}

if (-not $InstallOnly) {
    Write-Host "Virtual environment ready: $Venv"
    Write-Host "Start middleware: docker compose --env-file infra/versions.env --env-file infra/.env -f infra/compose.yml up -d postgres redis etcd minio milvus"
    Write-Host "Run API locally: .\.venv\Scripts\python -m uvicorn app.main:app --reload"
}
