$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$Compose = Join-Path $ProjectRoot "infra\compose.yml"
$VersionsEnv = Join-Path $ProjectRoot "infra\versions.env"
$InfraEnv = Join-Path $ProjectRoot "infra\.env"
. (Join-Path $PSScriptRoot "import-dev-secrets.ps1")

if (-not (Test-Path -LiteralPath $Python)) {
    throw "Virtual environment not found. Run scripts\bootstrap.ps1 first."
}

docker compose --env-file $VersionsEnv --env-file $InfraEnv -f $Compose ps `
    postgres redis etcd minio milvus

Push-Location $ProjectRoot
try {
    & $Python -m alembic current
    & $Python -c "import asyncio; from app.services.milvus_service import milvus_service; print('milvus:', asyncio.run(milvus_service.ping()))"
}
finally {
    Pop-Location
}
