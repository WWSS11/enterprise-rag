param(
    [switch]$SkipBeat,
    [switch]$SkipFrontend,
    [string]$AppEnvFile = ".env",
    [string]$InfraEnvFile = "infra\.env"
)

. (Join-Path $PSScriptRoot "_common.ps1")

function Start-ManagedDevelopmentProcess {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory
    )

    $stdout = Join-Path $RuntimeLogDirectory "$Name.out.log"
    $stderr = Join-Path $RuntimeLogDirectory "$Name.err.log"
    $process = Start-Process -FilePath $FilePath `
        -ArgumentList $Arguments `
        -WorkingDirectory $WorkingDirectory `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru

    Start-Sleep -Milliseconds 700
    if ($process.HasExited) {
        $details = if (Test-Path -LiteralPath $stderr) { (Get-Content -LiteralPath $stderr -Tail 20) -join "`n" } else { "" }
        throw "$Name exited during startup.`n$details"
    }

    return [pscustomobject]@{
        name = $Name
        pid = $process.Id
        stdout = $stdout
        stderr = $stderr
    }
}

function Stop-ManagedDevelopmentProcesses {
    param([object[]]$Processes)

    foreach ($entry in $Processes) {
        if (Get-Process -Id $entry.pid -ErrorAction SilentlyContinue) {
            & taskkill.exe /PID $entry.pid /T /F *> $null
        }
    }
}

function Wait-HttpReady {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Uri,
        [int]$TimeoutSeconds = 90
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Uri -TimeoutSec 5 -UseBasicParsing
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
                Write-Host "$Name is ready: $Uri"
                return
            }
        }
        catch {
            Start-Sleep -Seconds 1
        }
    }
    throw "$Name did not become ready within $TimeoutSeconds seconds."
}

Initialize-DevelopmentConfiguration
$configuration = Get-StackConfiguration $AppEnvFile $InfraEnvFile
Assert-DockerAvailable

$python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$frontendModules = Join-Path $ProjectRoot "frontend\node_modules"
if (-not (Test-Path -LiteralPath $python) -or (-not $SkipFrontend -and -not (Test-Path -LiteralPath $frontendModules))) {
    Write-Host "Missing development dependencies; running dev-setup.ps1 once."
    & (Join-Path $PSScriptRoot "dev-setup.ps1") -SkipFrontend:$SkipFrontend
}

if (Test-Path -LiteralPath $RuntimeStateFile) {
    $existingState = Get-Content -Raw -LiteralPath $RuntimeStateFile | ConvertFrom-Json
    $active = @($existingState.processes | Where-Object { Get-Process -Id $_.pid -ErrorAction SilentlyContinue })
    if ($active.Count -gt 0) {
        throw "Development services are already running. Run .\scripts\dev-down.ps1 first."
    }
    Remove-Item -LiteralPath $RuntimeStateFile -Force
}

Invoke-Compose $configuration @("config", "--quiet") "Compose configuration is invalid"
Invoke-Compose $configuration @(
    "up", "-d", "--wait", "--wait-timeout", "180", "--remove-orphans",
    "postgres", "redis", "etcd", "minio", "milvus", "keycloak"
) "Development infrastructure failed to become ready"
Assert-DockerClock $configuration

& (Join-Path $PSScriptRoot "db-migrate.ps1") -Runtime Local -AppEnvFile $AppEnvFile -InfraEnvFile $InfraEnvFile

New-Item -ItemType Directory -Path $RuntimeLogDirectory -Force | Out-Null
$processes = [System.Collections.Generic.List[object]]::new()
try {
    $processes.Add((Start-ManagedDevelopmentProcess "api" $python @(
        "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000", "--reload"
    ) $ProjectRoot))
    $processes.Add((Start-ManagedDevelopmentProcess "worker" $python @(
        "-m", "celery", "-A", "app.workers.celery_app:celery_app", "worker",
        "--loglevel=INFO", "--pool=solo", "--concurrency=1"
    ) $ProjectRoot))
    if (-not $SkipBeat) {
        $processes.Add((Start-ManagedDevelopmentProcess "beat" $python @(
            "-m", "celery", "-A", "app.workers.celery_app:celery_app", "beat", "--loglevel=INFO"
        ) $ProjectRoot))
    }
    if (-not $SkipFrontend) {
        $npm = (Get-Command "npm.cmd").Source
        $processes.Add((Start-ManagedDevelopmentProcess "frontend" $npm @("run", "dev") (Join-Path $ProjectRoot "frontend")))
    }

    [pscustomobject]@{
        startedAt = [DateTimeOffset]::Now.ToString("o")
        processes = $processes
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $RuntimeStateFile -Encoding UTF8

    Wait-HttpReady "API" "http://127.0.0.1:8000/health/ready"
    if (-not $SkipFrontend) {
        Wait-HttpReady "Frontend" "http://127.0.0.1:3000"
    }
}
catch {
    Stop-ManagedDevelopmentProcesses $processes
    Remove-Item -LiteralPath $RuntimeStateFile -Force -ErrorAction SilentlyContinue
    throw
}

Write-Host "Development stack is running. Logs: $RuntimeLogDirectory"
Write-Host "Stop everything with .\scripts\dev-down.ps1"
