from typing import Literal

from pydantic import BaseModel


class CurrentIdentityRead(BaseModel):
    user_id: str
    tenant_id: str
    roles: list[str]
    groups: list[str]
    auth_method: Literal["trusted_header", "oidc"]
    is_admin: bool
