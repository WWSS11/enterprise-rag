param(
    [string]$Username = "rag-admin",
    [string]$Password = "admin_change_me"
)

$ErrorActionPreference = "Stop"
$TokenUrl = "http://127.0.0.1:18080/realms/enterprise-rag/protocol/openid-connect/token"
$Response = Invoke-RestMethod `
    -Method Post `
    -Uri $TokenUrl `
    -ContentType "application/x-www-form-urlencoded" `
    -Body @{
        grant_type = "password"
        client_id = "enterprise-rag-web"
        username = $Username
        password = $Password
        scope = "openid profile"
    }

# Direct Access Grants and the bundled passwords exist only for local development.
$Response.access_token
