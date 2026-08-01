param(
    [ValidateSet("Local", "Container")]
    [string]$Runtime = "Container",
    [string]$AppEnvFile = "",
    [string]$InfraEnvFile = "",
    [ValidateSet("docker", "production")]
    [string]$ContainerEnvironment = "production"
)

. (Join-Path $PSScriptRoot "_common.ps1")

if (-not $AppEnvFile) {
    $AppEnvFile = if ($Runtime -eq "Local") { ".env" } else { ".env.production" }
}
if (-not $InfraEnvFile) {
    $InfraEnvFile = if ($Runtime -eq "Local") { "infra\.env" } else { "infra\.env.production" }
}

$configuration = Get-StackConfiguration $AppEnvFile $InfraEnvFile

if ($Runtime -eq "Local") {
    $python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
    if (-not (Test-Path -LiteralPath $python)) {
        throw "Python virtual environment not found. Run .\scripts\dev-setup.ps1 first."
    }

    Push-Location $ProjectRoot
    try {
        Invoke-NativeCommand $python @("-m", "alembic", "upgrade", "head") "Database migration failed"
        Invoke-NativeCommand $python @("-m", "alembic", "current", "--check-heads") "Database is not at the latest migration"
    }
    finally {
        Pop-Location
    }
}
else {
    Assert-DockerAvailable
    if ($ContainerEnvironment -eq "production") {
        Assert-ProductionConfiguration $configuration
    }
    $previousContainerEnvironment = $env:APP_CONTAINER_ENV
    try {
        $env:APP_CONTAINER_ENV = $ContainerEnvironment
        Invoke-Compose $configuration @("config", "--quiet") "Compose configuration is invalid"
        Invoke-Compose $configuration @("up", "-d", "--wait", "--wait-timeout", "120", "postgres") "PostgreSQL failed to become ready"
        Invoke-Compose $configuration @("build", "migrate") "Unable to build the migration image"
        Invoke-Compose $configuration @("run", "--rm", "--no-deps", "migrate") "Database migration failed"
        Invoke-Compose $configuration @("run", "--rm", "--no-deps", "migrate", "alembic", "current", "--check-heads") "Database is not at the latest migration"
    }
    finally {
        if ($null -eq $previousContainerEnvironment) {
            Remove-Item Env:APP_CONTAINER_ENV -ErrorAction SilentlyContinue
        }
        else {
            $env:APP_CONTAINER_ENV = $previousContainerEnvironment
        }
    }
}

Write-Host "Database schema is at the latest Alembic head."
