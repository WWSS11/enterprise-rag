import hmac

from fastapi import Header, HTTPException

from app.core.config import get_settings


async def request_identity(
    x_tenant_id: str = Header(
        default="default",
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$",
    ),
    x_user_id: str = Header(
        default="anonymous",
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._@-]*$",
    ),
    x_identity_secret: str = Header(default=""),
) -> tuple[str, str]:
    configured_secret = get_settings().identity_header_secret
    if configured_secret and not hmac.compare_digest(x_identity_secret, configured_secret):
        raise HTTPException(status_code=401, detail="invalid trusted identity secret")
    return x_tenant_id, x_user_id
