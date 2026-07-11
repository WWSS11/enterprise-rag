$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$InfraEnv = Join-Path $ProjectRoot "infra\.env"

if (-not (Test-Path $InfraEnv)) {
    Copy-Item (Join-Path $ProjectRoot "infra\.env.example") $InfraEnv
}

docker compose `
  --env-file (Join-Path $ProjectRoot "infra\versions.env") `
  --env-file $InfraEnv `
  -f (Join-Path $ProjectRoot "infra\compose.yml") `
  up -d --build
