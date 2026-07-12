$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $Python)) {
    throw "Virtual environment not found. Run scripts\bootstrap.ps1 first."
}

Push-Location $ProjectRoot
try {
    # Celery prefork is not supported reliably on Windows; solo is the stable dev pool.
    & $Python -m celery -A app.workers.celery_app:celery_app worker `
        --loglevel=INFO `
        --pool=solo `
        --concurrency=1
}
finally {
    Pop-Location
}
