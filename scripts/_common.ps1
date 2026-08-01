Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ComposeFile = Join-Path $ProjectRoot "infra\compose.yml"
$VersionsEnvFile = Join-Path $ProjectRoot "infra\versions.env"
$RuntimeDirectory = Join-Path $ProjectRoot ".runtime"
$RuntimeStateFile = Join-Path $RuntimeDirectory "dev-processes.json"
$RuntimeLogDirectory = Join-Path $RuntimeDirectory "logs"

function Resolve-ProjectPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $Path))
}

function Assert-CommandAvailable {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$InstallHint
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found. $InstallHint"
    }
}

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$FailureMessage = "Command failed."
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (exit code $LASTEXITCODE)"
    }
}

function Get-StackConfiguration {
    param(
        [string]$AppEnvFile = ".env",
        [string]$InfraEnvFile = "infra\.env"
    )

    $appEnv = Resolve-ProjectPath $AppEnvFile
    $infraEnv = Resolve-ProjectPath $InfraEnvFile
    foreach ($requiredFile in @($VersionsEnvFile, $infraEnv, $appEnv, $ComposeFile)) {
        if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
            throw "Required configuration file not found: $requiredFile"
        }
    }

    [pscustomobject]@{
        AppEnvFile = $appEnv
        InfraEnvFile = $infraEnv
    }
}

function Initialize-DevelopmentConfiguration {
    $files = @(
        @{ Target = (Join-Path $ProjectRoot ".env"); Source = (Join-Path $ProjectRoot ".env.example") },
        @{ Target = (Join-Path $ProjectRoot "infra\.env"); Source = (Join-Path $ProjectRoot "infra\.env.example") },
        @{ Target = (Join-Path $ProjectRoot "frontend\.env"); Source = (Join-Path $ProjectRoot "frontend\.env.example") }
    )

    foreach ($file in $files) {
        if (-not (Test-Path -LiteralPath $file.Target)) {
            Copy-Item -LiteralPath $file.Source -Destination $file.Target
            Write-Host "Created $($file.Target)"
        }
    }
}

function Assert-DockerAvailable {
    Assert-CommandAvailable "docker" "Install and start Docker Desktop."
    & docker info --format "{{.ServerVersion}}" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker engine is unavailable."
    }
    & docker compose version --short | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose v2 is unavailable."
    }
}

function Get-ComposeBaseArguments {
    param([Parameter(Mandatory = $true)]$Configuration)

    return @(
        "compose",
        "--env-file", $VersionsEnvFile,
        "--env-file", $Configuration.InfraEnvFile,
        "--env-file", $Configuration.AppEnvFile,
        "-f", $ComposeFile
    )
}

function Invoke-Compose {
    param(
        [Parameter(Mandatory = $true)]$Configuration,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$FailureMessage = "Docker Compose command failed."
    )

    $previousAppEnvFile = $env:COMPOSE_APP_ENV_FILE
    try {
        $env:COMPOSE_APP_ENV_FILE = $Configuration.AppEnvFile
        $composeArguments = @(Get-ComposeBaseArguments $Configuration) + $Arguments
        Invoke-NativeCommand "docker" $composeArguments $FailureMessage
    }
    finally {
        if ($null -eq $previousAppEnvFile) {
            Remove-Item Env:COMPOSE_APP_ENV_FILE -ErrorAction SilentlyContinue
        }
        else {
            $env:COMPOSE_APP_ENV_FILE = $previousAppEnvFile
        }
    }
}

function Get-ComposeServiceContainerId {
    param(
        [Parameter(Mandatory = $true)]$Configuration,
        [Parameter(Mandatory = $true)][string]$Service
    )

    $previousAppEnvFile = $env:COMPOSE_APP_ENV_FILE
    try {
        $env:COMPOSE_APP_ENV_FILE = $Configuration.AppEnvFile
        $composeArguments = @(Get-ComposeBaseArguments $Configuration) + @("ps", "-q", $Service)
        $output = & docker @composeArguments
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to find the '$Service' container."
        }
        $containerId = ($output | Select-Object -Last 1) -as [string]
        return $(if ($containerId) { $containerId.Trim() } else { "" })
    }
    finally {
        if ($null -eq $previousAppEnvFile) {
            Remove-Item Env:COMPOSE_APP_ENV_FILE -ErrorAction SilentlyContinue
        }
        else {
            $env:COMPOSE_APP_ENV_FILE = $previousAppEnvFile
        }
    }
}

function Assert-DockerClock {
    param(
        [Parameter(Mandatory = $true)]$Configuration,
        [int]$MaximumDriftSeconds = 60
    )

    $containerId = Get-ComposeServiceContainerId $Configuration "keycloak"
    if (-not $containerId) {
        throw "Keycloak container is not running."
    }

    $hostEpoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $containerEpochText = & docker exec $containerId date +%s
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to read the Docker/WSL clock."
    }

    $containerEpoch = 0L
    if (-not [long]::TryParse(($containerEpochText | Select-Object -Last 1).Trim(), [ref]$containerEpoch)) {
        throw "Docker/WSL returned an invalid clock value."
    }

    $driftSeconds = [Math]::Abs($containerEpoch - $hostEpoch)
    if ($driftSeconds -gt $MaximumDriftSeconds) {
        throw "Docker/WSL clock differs from Windows UTC by $driftSeconds seconds; OIDC tokens will be invalid. Restart Docker Desktop or WSL."
    }
    Write-Host "Docker clock is synchronized (drift ${driftSeconds}s)."
}

function Read-DotEnvFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) {
            continue
        }
        $parts = $trimmed.Split("=", 2)
        $values[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
    }
    return $values
}

function Assert-ProductionConfiguration {
    param(
        [Parameter(Mandatory = $true)]$Configuration,
        [switch]$AllowInsecureConfiguration
    )

    if ($AllowInsecureConfiguration) {
        Write-Warning "Production safety checks were explicitly bypassed."
        return
    }

    $app = Read-DotEnvFile $Configuration.AppEnvFile
    $infra = Read-DotEnvFile $Configuration.InfraEnvFile
    $errors = [System.Collections.Generic.List[string]]::new()

    if ($app["APP_ENV"] -notin @("prod", "production")) {
        $errors.Add("APP_ENV must be production.")
    }
    if ($app["APP_DEBUG"] -ne "false") {
        $errors.Add("APP_DEBUG must be false.")
    }
    if ($app["APP_CORS_ORIGINS"] -in @($null, "", "[]")) {
        $errors.Add("APP_CORS_ORIGINS must contain the production frontend origin.")
    }
    if ($app["APP_AUTH_MODE"] -eq "oidc") {
        $issuer = $app["APP_OIDC_ISSUER"]
        if (-not $issuer -or -not $issuer.StartsWith("https://")) {
            $errors.Add("APP_OIDC_ISSUER must use HTTPS in production.")
        }
    }
    if ($app["APP_AUTH_MODE"] -eq "trusted_header" -and -not $app["APP_IDENTITY_HEADER_SECRET"]) {
        $errors.Add("APP_IDENTITY_HEADER_SECRET is required for trusted_header mode.")
    }
    foreach ($publicUrlName in @("VITE_APP_ORIGIN", "VITE_API_BASE_URL", "VITE_OIDC_AUTHORITY")) {
        $publicUrl = $app[$publicUrlName]
        if (-not $publicUrl -or -not $publicUrl.StartsWith("https://")) {
            $errors.Add("$publicUrlName must use HTTPS in production.")
        }
    }
    foreach ($requiredSecret in @("APP_CHAT_API_KEY", "APP_EMBEDDING_API_KEY")) {
        $secretValue = $app[$requiredSecret]
        if (-not $secretValue -or $secretValue -match "CHANGE_ME") {
            $errors.Add("$requiredSecret must be configured.")
        }
    }
    if ($app["APP_RERANK_ENABLED"] -eq "true") {
        $rerankKey = $app["APP_RERANK_API_KEY"]
        if (-not $rerankKey -or $rerankKey -match "CHANGE_ME") {
            $errors.Add("APP_RERANK_API_KEY must be configured when reranking is enabled.")
        }
    }

    $unsafeValues = @(
        @{ Name = "POSTGRES_PASSWORD"; Value = $infra["POSTGRES_PASSWORD"]; Default = "rag_change_me" },
        @{ Name = "REDIS_PASSWORD"; Value = $infra["REDIS_PASSWORD"]; Default = "redis_change_me" },
        @{ Name = "MINIO_ROOT_PASSWORD"; Value = $infra["MINIO_ROOT_PASSWORD"]; Default = "minioadmin_change_me" },
        @{ Name = "KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD"; Value = $infra["KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD"]; Default = "keycloak_admin_change_me" }
    )
    foreach ($item in $unsafeValues) {
        if (-not $item.Value -or $item.Value -eq $item.Default -or $item.Value -match "CHANGE_ME") {
            $errors.Add("$($item.Name) must be changed from its development default.")
        }
    }

    if ($errors.Count -gt 0) {
        throw "Unsafe production configuration:`n - $($errors -join "`n - ")"
    }
}
