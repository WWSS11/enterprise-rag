from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator


class KnowledgeBaseCreate(BaseModel):
    slug: str = Field(min_length=1, max_length=128, pattern=r"^[a-z0-9][a-z0-9-]*$")
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4_000)
    access_mode: Literal["tenant", "restricted"] = "restricted"


class KnowledgeBaseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4_000)
    access_mode: Literal["tenant", "restricted"] | None = None

    @model_validator(mode="after")
    def require_change(self) -> "KnowledgeBaseUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one knowledge-base field is required")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("knowledge-base name cannot be null")
        if "access_mode" in self.model_fields_set and self.access_mode is None:
            raise ValueError("knowledge-base access mode cannot be null")
        return self


class KnowledgeBaseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: str
    slug: str
    name: str
    description: str | None
    access_mode: str
    status: str
    is_default: bool
    created_by: str
    created_at: datetime
    updated_at: datetime


class KnowledgeBaseMemberUpsert(BaseModel):
    principal_type: Literal["user", "group"] = "user"
    principal_id: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:@/-]*$",
        validation_alias=AliasChoices("principal_id", "user_id"),
    )
    permission: Literal["reader", "editor", "owner"] = "reader"


class KnowledgeBaseMemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    knowledge_base_id: UUID
    principal_type: str
    principal_id: str
    permission: str
    created_at: datetime
    updated_at: datetime


class KnowledgeBasePermissionRead(BaseModel):
    knowledge_base_id: UUID
    permission: Literal["reader", "editor", "owner"]
    source: Literal["admin", "tenant", "creator", "membership"]
