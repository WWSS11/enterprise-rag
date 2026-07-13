from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

AuthMethod = Literal["trusted_header", "oidc"]


@dataclass(frozen=True, slots=True)
class RequestIdentity:
    tenant_id: str
    user_id: str
    roles: frozenset[str] = field(default_factory=frozenset)
    groups: frozenset[str] = field(default_factory=frozenset)
    auth_method: AuthMethod = "trusted_header"
    is_admin: bool = False
    claims: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)
