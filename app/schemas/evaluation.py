from datetime import datetime
from typing import Any, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class EvaluationDatasetCreate(BaseModel):
    knowledge_base_id: UUID
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4_000)


class EvaluationDatasetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: str
    knowledge_base_id: UUID
    name: str
    description: str | None
    status: str
    created_by: str
    created_at: datetime
    updated_at: datetime


class EvaluationCaseCreate(BaseModel):
    question: str = Field(min_length=1, max_length=8_000)
    reference_answer: str = Field(min_length=1, max_length=32_000)
    expected_document_ids: list[UUID] = Field(default_factory=list, max_length=100)
    acceptable_citation_document_ids: list[UUID] = Field(
        default_factory=list, max_length=100
    )
    required_key_points: list[str] = Field(default_factory=list, max_length=100)
    should_refuse: bool = False
    tags: list[str] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def validate_ground_truth(self) -> Self:
        self.expected_document_ids = list(dict.fromkeys(self.expected_document_ids))
        self.acceptable_citation_document_ids = list(
            dict.fromkeys(
                [*self.expected_document_ids, *self.acceptable_citation_document_ids]
            )
        )
        self.required_key_points = list(
            dict.fromkeys(point.strip() for point in self.required_key_points if point.strip())
        )
        self.tags = list(dict.fromkeys(tag.strip() for tag in self.tags if tag.strip()))
        if self.should_refuse and (
            self.expected_document_ids or self.acceptable_citation_document_ids
        ):
            raise ValueError("refusal cases cannot declare expected or citation documents")
        if not self.should_refuse and not self.expected_document_ids:
            raise ValueError("answerable cases require at least one expected document")
        return self


class EvaluationCaseBulkCreate(BaseModel):
    cases: list[EvaluationCaseCreate] = Field(min_length=1, max_length=500)


class EvaluationCaseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    dataset_id: UUID
    question: str
    reference_answer: str
    expected_document_ids: list[str]
    acceptable_citation_document_ids: list[str]
    required_key_points: list[str]
    should_refuse: bool
    tags: list[str]
    created_at: datetime
    updated_at: datetime


class EvaluationRunCreate(BaseModel):
    dataset_id: UUID


class EvaluationRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: str
    knowledge_base_id: UUID
    dataset_id: UUID
    created_by: str
    task_id: str | None
    status: str
    progress: int = Field(ge=0, le=100)
    total_cases: int
    completed_cases: int
    failed_cases: int
    config_snapshot: dict[str, Any]
    summary: dict[str, Any]
    started_at: datetime | None
    completed_at: datetime | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime


class EvaluationResultRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    run_id: UUID
    case_id: UUID
    status: str
    rewritten_query: str | None
    answer: str | None
    retrieved_documents: list[dict[str, Any]]
    reranked_documents: list[dict[str, Any]]
    citations: list[dict[str, Any]]
    metrics: dict[str, Any]
    first_token_ms: float | None
    total_latency_ms: float | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime


class EvaluationResultReport(EvaluationResultRead):
    question: str
    reference_answer: str
    expected_document_ids: list[str]
    acceptable_citation_document_ids: list[str]
    required_key_points: list[str]
    should_refuse: bool
    tags: list[str]


class EvaluationReport(BaseModel):
    run: EvaluationRunRead
    dataset: EvaluationDatasetRead
    results: list[EvaluationResultReport]
