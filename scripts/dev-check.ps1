$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$Compose = Join-Path $ProjectRoot "infra\compose.yml"
$VersionsEnv = Join-Path $ProjectRoot "infra\versions.env"
$InfraEnv = Join-Path $ProjectRoot "infra\.env"
$RootEnv = Join-Path $ProjectRoot ".env"

if (-not (Test-Path -LiteralPath $Python)) {
    throw "Virtual environment not found. Run scripts\bootstrap.ps1 first."
}

docker compose --env-file $VersionsEnv --env-file $InfraEnv --env-file $RootEnv `
    -f $Compose ps `
    postgres redis etcd minio milvus keycloak

$KeycloakContainer = docker compose --env-file $VersionsEnv --env-file $InfraEnv --env-file $RootEnv `
    -f $Compose ps -q keycloak
if ($LASTEXITCODE -ne 0 -or -not $KeycloakContainer) {
    throw "Keycloak container is not running."
}
& (Join-Path $PSScriptRoot "assert-docker-clock.ps1") -ContainerId $KeycloakContainer.Trim()

$DiscoveryUrl = "http://127.0.0.1:18080/realms/enterprise-rag/.well-known/openid-configuration"
$Discovery = Invoke-RestMethod -Uri $DiscoveryUrl -TimeoutSec 10
if ($Discovery.issuer -ne "http://127.0.0.1:18080/realms/enterprise-rag") {
    throw "Unexpected Keycloak issuer: $($Discovery.issuer)"
}
Write-Host "keycloak: ready ($($Discovery.issuer))"

Push-Location $ProjectRoot
try {
    & $Python -m alembic current
    & $Python -c "import asyncio; from app.services.milvus_service import milvus_service; print('milvus:', asyncio.run(milvus_service.ping()))"
}
finally {
    Pop-Location
}
