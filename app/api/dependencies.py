import hmac
import re
from functools import lru_cache
from typing import Annotated, Any

import structlog
from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import get_settings
from app.security.identity import RequestIdentity
from app.security.oidc import (
    InvalidBearerToken,
    OIDCProviderUnavailable,
    OIDCTokenVerifier,
)

TENANT_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
USER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@/-]*$")
bearer_scheme = HTTPBearer(
    auto_error=False, scheme_name="OIDC Bearer", bearerFormat="JWT"
)
logger = structlog.get_logger(__name__)


@lru_cache
def get_oidc_token_verifier() -> OIDCTokenVerifier:
    return OIDCTokenVerifier(get_settings())


def _claim_value(claims: dict[str, Any], path: str) -> Any:
    value: Any = claims
    for segment in path.split("."):
        if not isinstance(value, dict) or segment not in value:
            return None
        value = value[segment]
    return value


def _claim_set(claims: dict[str, Any], path: str) -> frozenset[str]:
    value = _claim_value(claims, path)
    if value is None:
        return frozenset()
    if not isinstance(value, list) or len(value) > 256:
        raise InvalidBearerToken(f"OIDC claim {path} must be a bounded string array")
    result: set[str] = set()
    for item in value:
        if not isinstance(item, str) or not item or len(item) > 128:
            raise InvalidBearerToken(f"OIDC claim {path} contains an invalid value")
        result.add(item)
    return frozenset(result)


def _identity_from_claims(claims: dict[str, Any]) -> RequestIdentity:
    settings = get_settings()
    user_id = claims.get("sub")
    tenant_id = _claim_value(claims, settings.oidc_tenant_claim)
    if (
        not isinstance(user_id, str)
        or len(user_id) > 128
        or USER_PATTERN.fullmatch(user_id) is None
    ):
        raise InvalidBearerToken("OIDC sub claim is invalid")
    if (
        not isinstance(tenant_id, str)
        or len(tenant_id) > 64
        or TENANT_PATTERN.fullmatch(tenant_id) is None
    ):
        raise InvalidBearerToken("OIDC tenant claim is invalid")

    roles = _claim_set(claims, settings.oidc_roles_claim)
    groups = _claim_set(claims, settings.oidc_groups_claim)
    return RequestIdentity(
        tenant_id=tenant_id,
        user_id=user_id,
        roles=roles,
        groups=groups,
        auth_method="oidc",
        is_admin=(user_id in settings.admin_user_ids or settings.oidc_admin_role in roles),
        claims=claims,
    )


async def request_identity(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    verifier: Annotated[OIDCTokenVerifier, Depends(get_oidc_token_verifier)],
    x_tenant_id: Annotated[
        str | None,
        Header(
            min_length=1,
            max_length=64,
            pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$",
        ),
    ] = None,
    x_user_id: Annotated[
        str | None,
        Header(
            min_length=1,
            max_length=128,
            pattern=r"^[A-Za-z0-9][A-Za-z0-9._@-]*$",
        ),
    ] = None,
    x_identity_secret: Annotated[str | None, Header(max_length=512)] = None,
) -> RequestIdentity:
    settings = get_settings()
    if settings.auth_mode == "oidc":
        if any(item is not None for item in (x_tenant_id, x_user_id, x_identity_secret)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="trusted identity headers are not accepted in oidc mode",
            )
        if credentials is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="bearer token is required",
                headers={"WWW-Authenticate": "Bearer"},
            )
        try:
            claims = await verifier.verify(credentials.credentials)
            identity = _identity_from_claims(claims)
        except InvalidBearerToken as exc:
            await logger.awarning("bearer_token_rejected", reason=str(exc))
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="invalid bearer token",
                headers={"WWW-Authenticate": 'Bearer error="invalid_token"'},
            ) from exc
        except OIDCProviderUnavailable as exc:
            await logger.aerror("oidc_provider_unavailable", reason=str(exc))
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="identity provider is temporarily unavailable",
            ) from exc
    else:
        if request.headers.get("authorization") is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="bearer tokens are not accepted in trusted_header mode",
            )
        tenant_id = x_tenant_id or "default"
        user_id = x_user_id or "anonymous"
        configured_secret = settings.identity_header_secret
        if configured_secret and not hmac.compare_digest(
            x_identity_secret or "", configured_secret
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="invalid trusted identity secret",
            )
        identity = RequestIdentity(
            tenant_id=tenant_id,
            user_id=user_id,
            auth_method="trusted_header",
            is_admin=user_id in settings.admin_user_ids,
        )

    request.state.identity = identity
    structlog.contextvars.bind_contextvars(
        tenant_id=identity.tenant_id,
        user_id=identity.user_id,
        auth_method=identity.auth_method,
    )
    return identity
