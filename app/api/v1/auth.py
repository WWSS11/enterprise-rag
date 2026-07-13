from fastapi import APIRouter, Depends

from app.api.dependencies import request_identity
from app.schemas.auth import CurrentIdentityRead
from app.security.identity import RequestIdentity

router = APIRouter()


@router.get("/me", response_model=CurrentIdentityRead)
async def current_identity(
    identity: RequestIdentity = Depends(request_identity),
) -> CurrentIdentityRead:
    return CurrentIdentityRead(
        user_id=identity.user_id,
        tenant_id=identity.tenant_id,
        roles=sorted(identity.roles),
        groups=sorted(identity.groups),
        auth_method=identity.auth_method,
        is_admin=identity.is_admin,
    )
