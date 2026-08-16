from __future__ import annotations

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictPackageModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EvaluationPackageKnowledgeBase(StrictPackageModel):
    slug: str = Field(min_length=1, max_length=128, pattern=r"^[a-z0-9][a-z0-9-]*$")
    name: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=4_000)
    access_mode: Literal["tenant", "restricted"] = "restricted"


class EvaluationPackageDocument(StrictPackageModel):
    source_path: str = Field(min_length=1, max_length=2_048)
    upload_name: str = Field(min_length=1, max_length=512)
    sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")


class EvaluationPackageSafety(StrictPackageModel):
    data_classification: Literal["public", "internal-sanitized", "synthetic"]
    approved_for_external_models: bool
    provider_training_use_reviewed: bool
    provider_retention_reviewed: bool
    provider_review_outcome: Literal["approved", "public-data-exception", "blocked"] = (
        "approved"
    )
    provider_review_notes: str = Field(default="", max_length=2_000)
    approval_reference: str = Field(min_length=1, max_length=512)


class EvaluationPackageCase(StrictPackageModel):
    question: str = Field(min_length=1, max_length=4_000)
    reference_answer: str = Field(min_length=1, max_length=12_000)
    expected_document_names: list[str] = Field(default_factory=list, max_length=100)
    acceptable_citation_document_names: list[str] | None = Field(
        default=None, max_length=100
    )
    required_key_points: list[str] = Field(default_factory=list, max_length=100)
    required_key_point_groups: list[list[str]] = Field(default_factory=list, max_length=100)
    should_refuse: bool = False
    tags: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_ground_truth(self) -> Self:
        self.expected_document_names = list(
            dict.fromkeys(item.strip() for item in self.expected_document_names if item.strip())
        )
        acceptable = self.acceptable_citation_document_names
        self.acceptable_citation_document_names = list(
            dict.fromkeys(
                item.strip()
                for item in (acceptable or self.expected_document_names)
                if item.strip()
            )
        )
        self.required_key_points = list(
            dict.fromkeys(item.strip() for item in self.required_key_points if item.strip())
        )
        if any(len(point) > 500 for point in self.required_key_points):
            raise ValueError("required key points cannot exceed 500 characters")
        self.tags = list(dict.fromkeys(item.strip() for item in self.tags if item.strip()))

        groups: list[list[str]] = []
        grouped_points: set[str] = set()
        for raw_group in self.required_key_point_groups:
            if len(raw_group) > 20:
                raise ValueError("key-point groups cannot contain more than 20 aliases")
            group = list(dict.fromkeys(item.strip() for item in raw_group if item.strip()))
            if not group:
                raise ValueError("required key-point groups cannot be empty")
            if any(len(alias) > 500 for alias in group):
                raise ValueError("key-point aliases cannot exceed 500 characters")
            anchors = [point for point in self.required_key_points if point in group]
            if len(anchors) != 1:
                raise ValueError(
                    "each key-point group must contain exactly one required key point"
                )
            anchor = anchors[0]
            if anchor in grouped_points:
                raise ValueError("required key points cannot appear in multiple groups")
            grouped_points.add(anchor)
            groups.append([anchor, *(alias for alias in group if alias != anchor)])
        groups.extend(
            [point] for point in self.required_key_points if point not in grouped_points
        )
        self.required_key_point_groups = groups

        if self.should_refuse:
            if self.expected_document_names or self.acceptable_citation_document_names:
                raise ValueError("refusal cases cannot reference documents")
            if self.required_key_points or self.required_key_point_groups:
                raise ValueError("refusal cases cannot declare required key points")
        elif not self.expected_document_names:
            raise ValueError("answerable cases must reference at least one expected document")
        elif not self.required_key_points:
            raise ValueError("answerable cases must declare required key points")
        return self


class EvaluationPackage(StrictPackageModel):
    schema_version: Literal["1.0"] = "1.0"
    profile: Literal["engineering", "business-baseline"] = "engineering"
    name: str = Field(min_length=1, max_length=255)
    description: str = Field(min_length=1, max_length=4_000)
    knowledge_base: EvaluationPackageKnowledgeBase
    safety: EvaluationPackageSafety | None = None
    documents: list[EvaluationPackageDocument] = Field(min_length=1, max_length=50)
    cases: list[EvaluationPackageCase] = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def validate_references(self) -> Self:
        upload_names = [document.upload_name for document in self.documents]
        if len(upload_names) != len(set(upload_names)):
            raise ValueError("document upload names must be unique")

        questions = [case.question for case in self.cases]
        if len(questions) != len(set(questions)):
            raise ValueError("evaluation questions must be unique")

        known_documents = set(upload_names)
        for case in self.cases:
            referenced = set(case.expected_document_names).union(
                case.acceptable_citation_document_names or []
            )
            unknown = sorted(referenced - known_documents)
            if unknown:
                raise ValueError(
                    "evaluation cases reference unknown documents: " + ", ".join(unknown)
                )
        return self
