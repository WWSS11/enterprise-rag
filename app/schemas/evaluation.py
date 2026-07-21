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
    required_key_point_groups: list[list[str]] = Field(default_factory=list, max_length=100)
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
        groups: list[list[str]] = []
        grouped_points: set[str] = set()
        for raw_group in self.required_key_point_groups:
            if len(raw_group) > 20:
                raise ValueError("key point groups cannot contain more than 20 aliases")
            group = list(
                dict.fromkeys(alias.strip() for alias in raw_group if alias.strip())
            )
            if any(len(alias) > 500 for alias in group):
                raise ValueError("key point aliases cannot exceed 500 characters")
            anchors = [point for point in self.required_key_points if point in group]
            if len(anchors) != 1:
                raise ValueError(
                    "each key point group must contain exactly one required key point"
                )
            anchor = anchors[0]
            if anchor in grouped_points:
                raise ValueError("required key points cannot appear in multiple groups")
            grouped_points.add(anchor)
            groups.append([anchor, *(alias for alias in group if alias != anchor)])
        groups.extend(
            [point]
            for point in self.required_key_points
            if point not in grouped_points
        )
        self.required_key_point_groups = groups
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


class EvaluationCaseUpdate(EvaluationCaseCreate):
    pass


class EvaluationCaseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    dataset_id: UUID
    question: str
    reference_answer: str
    expected_document_ids: list[str]
    acceptable_citation_document_ids: list[str]
    required_key_points: list[str]
    required_key_point_groups: list[list[str]]
    should_refuse: bool
    tags: list[str]
    created_at: datetime
    updated_at: datetime


class EvaluationCasePage(BaseModel):
    items: list[EvaluationCaseRead]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0)


class EvaluationRunCreate(BaseModel):
    dataset_id: UUID


class EvaluationRunComparisonRequest(BaseModel):
    baseline_run_id: UUID


class EvaluationMetricComparison(BaseModel):
    metric: str
    baseline: float | None
    candidate: float | None
    delta: float | None
    relative_delta: float | None


class EvaluationConfigDifference(BaseModel):
    key: str
    baseline: Any
    candidate: Any


class EvaluationRunComparison(BaseModel):
    baseline_run_id: UUID
    candidate_run_id: UUID
    dataset_id: UUID
    metrics: list[EvaluationMetricComparison]
    config_differences: list[EvaluationConfigDifference]


class EvaluationQualityGateThresholds(BaseModel):
    max_metric_regressions: dict[str, float] = Field(
        default_factory=lambda: {
            "retrieval_recall_at_k": 0.0,
            "rerank_recall_at_k": 0.0,
            "citation_recall": 0.0,
            "key_point_group_coverage": 0.02,
            "citation_key_point_support_rate": 0.02,
            "citation_required_point_support_precision": 0.02,
            "refusal_accuracy": 0.0,
        }
    )
    minimum_candidate_metrics: dict[str, float] = Field(
        default_factory=lambda: {
            "retrieval_recall_at_k": 0.95,
            "rerank_recall_at_k": 0.90,
            "refusal_accuracy": 0.95,
        }
    )
    max_latency_increase_ratios: dict[str, float] = Field(
        default_factory=lambda: {
            "average_first_token_ms": 0.25,
            "average_total_latency_ms": 0.20,
        }
    )
    require_zero_failed_cases: bool = True

    @model_validator(mode="after")
    def validate_thresholds(self) -> Self:
        for mapping in (
            self.max_metric_regressions,
            self.max_latency_increase_ratios,
        ):
            if any(value < 0 for value in mapping.values()):
                raise ValueError("quality gate tolerances cannot be negative")
        return self


class EvaluationQualityGateRequest(EvaluationRunComparisonRequest):
    thresholds: EvaluationQualityGateThresholds = Field(
        default_factory=EvaluationQualityGateThresholds
    )


class EvaluationQualityGateCheck(BaseModel):
    metric: str
    rule: str
    threshold: float
    baseline: float | None
    candidate: float | None
    actual: float | None
    passed: bool
    reason: str


class EvaluationQualityGateReport(BaseModel):
    passed: bool
    comparison: EvaluationRunComparison
    checks: list[EvaluationQualityGateCheck]


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


class EvaluationRunPage(BaseModel):
    items: list[EvaluationRunRead]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0)


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
    citation_evidence: list[dict[str, Any]]
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
    required_key_point_groups: list[list[str]]
    should_refuse: bool
    tags: list[str]


class EvaluationReport(BaseModel):
    run: EvaluationRunRead
    dataset: EvaluationDatasetRead
    results: list[EvaluationResultReport]
