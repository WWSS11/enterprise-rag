param(
    [switch]$SkipPython,
    [switch]$SkipFrontend
)

. (Join-Path $PSScriptRoot "_common.ps1")

Initialize-DevelopmentConfiguration

if (-not $SkipPython) {
    Assert-CommandAvailable "py" "Install Python 3.13 and the Windows Python launcher."
    $venv = Join-Path $ProjectRoot ".venv"
    $python = Join-Path $venv "Scripts\python.exe"
    if (-not (Test-Path -LiteralPath $python)) {
        Invoke-NativeCommand "py" @("-3.13", "-m", "venv", $venv) "Unable to create the Python virtual environment"
    }
    Invoke-NativeCommand $python @("-m", "pip", "install", "--upgrade", "pip") "Unable to update pip"
    Invoke-NativeCommand $python @("-m", "pip", "install", "-e", "${ProjectRoot}[dev]") "Unable to install Python dependencies"
}

if (-not $SkipFrontend) {
    Assert-CommandAvailable "npm.cmd" "Install the current Node.js LTS release."
    Invoke-NativeCommand "npm.cmd" @("ci", "--prefix", (Join-Path $ProjectRoot "frontend")) "Unable to install frontend dependencies"
}

Write-Host "Development environment is ready. Run .\scripts\dev-up.ps1"
