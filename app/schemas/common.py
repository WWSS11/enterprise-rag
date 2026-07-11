from typing import Any

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    dependencies: dict[str, Any] = Field(default_factory=dict)
