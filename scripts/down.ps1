$ProjectRoot = Split-Path -Parent $PSScriptRoot
docker compose `
  --env-file (Join-Path $ProjectRoot "infra\versions.env") `
  --env-file (Join-Path $ProjectRoot "infra\.env") `
  -f (Join-Path $ProjectRoot "infra\compose.yml") `
  down
