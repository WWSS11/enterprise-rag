param(
    [string]$AppEnvFile = ".env.production",
    [string]$InfraEnvFile = "infra\.env.production",
    [switch]$RemoveVolumes
)

. (Join-Path $PSScriptRoot "_common.ps1")

$configuration = Get-StackConfiguration $AppEnvFile $InfraEnvFile
Assert-DockerAvailable
$arguments = @("down", "--remove-orphans", "--timeout", "30")
if ($RemoveVolumes) {
    Write-Warning "Named volumes will be removed. Bind-mounted data under infra/volumes is not deleted by this script."
    $arguments += "--volumes"
}
Invoke-Compose $configuration $arguments "Unable to stop the production stack"

Write-Host "Production stack is stopped. Persistent data was preserved unless -RemoveVolumes was supplied."
