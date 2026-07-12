$InfraEnv = Join-Path (Split-Path -Parent $PSScriptRoot) "infra\.env"
if (-not (Test-Path -LiteralPath $InfraEnv)) {
    return
}

$AllowedKeys = @(
    "APP_CHAT_API_KEY",
    "APP_CHAT_BASE_URL",
    "APP_CHAT_MODEL",
    "APP_EMBEDDING_API_KEY",
    "APP_EMBEDDING_BASE_URL",
    "APP_EMBEDDING_MODEL",
    "APP_RERANK_API_KEY",
    "APP_RERANK_BASE_URL",
    "APP_RERANK_MODEL",
    "APP_IDENTITY_HEADER_SECRET"
)

foreach ($Line in Get-Content -LiteralPath $InfraEnv) {
    if ($Line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        continue
    }
    $Name = $Matches[1]
    if ($Name -notin $AllowedKeys) {
        continue
    }
    $Value = $Matches[2].Trim()
    if (
        $Value.Length -ge 2 -and
        (($Value.StartsWith('"') -and $Value.EndsWith('"')) -or
         ($Value.StartsWith("'") -and $Value.EndsWith("'")))
    ) {
        $Value = $Value.Substring(1, $Value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
}
