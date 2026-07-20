param(
    [Parameter(Mandatory = $true)]
    [string]$ContainerId,
    [int]$MaximumDriftSeconds = 60
)

$ErrorActionPreference = "Stop"
$HostEpoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$ContainerEpochText = docker exec $ContainerId date +%s
if ($LASTEXITCODE -ne 0) {
    throw "Unable to read the Docker/WSL clock."
}

$ContainerEpoch = 0L
if (-not [long]::TryParse(($ContainerEpochText | Select-Object -Last 1).Trim(), [ref]$ContainerEpoch)) {
    throw "Docker/WSL returned an invalid clock value."
}

$DriftSeconds = [Math]::Abs($ContainerEpoch - $HostEpoch)
if ($DriftSeconds -gt $MaximumDriftSeconds) {
    throw "Docker/WSL clock differs from Windows UTC by $DriftSeconds seconds. OIDC tokens will be invalid. Restart Windows/WSL or repair host time sync; do not expand JWT clock skew."
}

Write-Host "docker clock: ready (drift ${DriftSeconds}s)"
