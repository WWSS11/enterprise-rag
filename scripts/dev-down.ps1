param(
    [switch]$KeepInfrastructure,
    [string]$AppEnvFile = ".env",
    [string]$InfraEnvFile = "infra\.env"
)

. (Join-Path $PSScriptRoot "_common.ps1")

if (Test-Path -LiteralPath $RuntimeStateFile) {
    $state = Get-Content -Raw -LiteralPath $RuntimeStateFile | ConvertFrom-Json
    foreach ($entry in @($state.processes)) {
        if (Get-Process -Id $entry.pid -ErrorAction SilentlyContinue) {
            Write-Host "Stopping $($entry.name) (PID $($entry.pid))..."
            & taskkill.exe /PID $entry.pid /T /F *> $null
        }
    }
    Remove-Item -LiteralPath $RuntimeStateFile -Force
}
else {
    Write-Host "No managed development processes were recorded."
}

if (-not $KeepInfrastructure) {
    $configuration = Get-StackConfiguration $AppEnvFile $InfraEnvFile
    Assert-DockerAvailable
    Invoke-Compose $configuration @("down", "--remove-orphans", "--timeout", "30") "Unable to stop development infrastructure"
}

Write-Host "Development stack is stopped. Persistent data was preserved."
