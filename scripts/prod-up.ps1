param(
    [string]$AppEnvFile = ".env.production",
    [string]$InfraEnvFile = "infra\.env.production",
    [switch]$SkipPull,
    [switch]$SkipBuild,
    [switch]$AllowInsecureConfiguration,
    [int]$WaitTimeoutSeconds = 300
)

. (Join-Path $PSScriptRoot "_common.ps1")

if (-not (Test-Path -LiteralPath (Resolve-ProjectPath $AppEnvFile)) -or
    -not (Test-Path -LiteralPath (Resolve-ProjectPath $InfraEnvFile))) {
    throw "Production configuration is missing. Copy .env.production.example to .env.production and infra/.env.production.example to infra/.env.production, then fill every required value."
}

$configuration = Get-StackConfiguration $AppEnvFile $InfraEnvFile
Assert-ProductionConfiguration $configuration -AllowInsecureConfiguration:$AllowInsecureConfiguration
Assert-DockerAvailable

$previousContainerEnvironment = $env:APP_CONTAINER_ENV
try {
    $env:APP_CONTAINER_ENV = if ($AllowInsecureConfiguration) { "docker" } else { "production" }
    Invoke-Compose $configuration @("config", "--quiet") "Compose configuration is invalid"
    if (-not $SkipPull) {
        Invoke-Compose $configuration @("pull", "--ignore-buildable") "Unable to pull service images"
    }
    if (-not $SkipBuild) {
        Invoke-Compose $configuration @("build", "--pull", "migrate", "frontend") "Unable to build application images"
    }
    Invoke-Compose $configuration @(
        "up", "-d", "--wait", "--wait-timeout", $WaitTimeoutSeconds.ToString(), "--remove-orphans"
    ) "Production stack failed to become ready"
    Invoke-Compose $configuration @("ps") "Unable to show production service status"
}
finally {
    if ($null -eq $previousContainerEnvironment) {
        Remove-Item Env:APP_CONTAINER_ENV -ErrorAction SilentlyContinue
    }
    else {
        $env:APP_CONTAINER_ENV = $previousContainerEnvironment
    }
}

Write-Host "Production stack is running. Database migrations were applied before application services started."
