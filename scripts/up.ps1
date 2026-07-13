$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$InfraEnv = Join-Path $ProjectRoot "infra\.env"
$RootEnv = Join-Path $ProjectRoot ".env"

if (-not (Test-Path $InfraEnv)) {
    Copy-Item (Join-Path $ProjectRoot "infra\.env.example") $InfraEnv
}

docker compose `
  --env-file (Join-Path $ProjectRoot "infra\versions.env") `
  --env-file $InfraEnv `
  --env-file $RootEnv `
  -f (Join-Path $ProjectRoot "infra\compose.yml") `
  up -d postgres redis etcd minio milvus

Write-Host "Middleware is ready. Application services run from .venv during development."
Write-Host "API:    powershell -ExecutionPolicy Bypass -File .\scripts\dev-api.ps1"
Write-Host "Worker: powershell -ExecutionPolicy Bypass -File .\scripts\dev-worker.ps1"
Write-Host "Beat:   powershell -ExecutionPolicy Bypass -File .\scripts\dev-beat.ps1"
