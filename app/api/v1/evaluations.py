from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import request_identity
from app.core.config import get_settings
from app.db.models import (
    Document,
    EvaluationCase,
    EvaluationDataset,
    EvaluationResult,
    EvaluationRun,
)
from app.db.session import get_db
from app.schemas.evaluation import (
    EvaluationCaseBulkCreate,
    EvaluationCaseCreate,
    EvaluationCaseRead,
    EvaluationDatasetCreate,
    EvaluationDatasetRead,
    EvaluationQualityGateReport,
    EvaluationQualityGateRequest,
    EvaluationReport,
    EvaluationResultRead,
    EvaluationResultReport,
    EvaluationRunComparison,
    EvaluationRunComparisonRequest,
    EvaluationRunCreate,
    EvaluationRunRead,
)
from app.services.audit_service import record_audit
from app.services.evaluation_gate_service import (
    compare_evaluation_runs,
    evaluate_quality_gate,
)
from app.services.evaluation_service import (
    build_config_snapshot,
    recalculate_evaluation_run_metrics,
)
from app.services.knowledge_base_service import knowledge_base_service
from app.workers.tasks import run_evaluation_task

router = APIRouter()


async def _authorize_dataset(
    db: AsyncSession,
    dataset_id: UUID,
    tenant_id: str,
    user_id: str,
    required_permission: str = "reader",
) -> EvaluationDataset:
    dataset = await db.get(EvaluationDataset, dataset_id)
    if dataset is None or dataset.tenant_id != tenant_id or dataset.status != "active":
        raise HTTPException(status_code=404, detail="evaluation dataset not found")
    try:
        await knowledge_base_service.authorize(
            db,
            tenant_id,
            user_id,
            dataset.knowledge_base_id,
            required_permission=required_permission,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return dataset


async def _validate_expected_documents(
    db: AsyncSession, dataset: EvaluationDataset, payloads: list[EvaluationCaseCreate]
) -> None:
    expected_ids = {
        document_id
        for payload in payloads
        for document_id in (
            payload.expected_document_ids + payload.acceptable_citation_document_ids
        )
    }
    if not expected_ids:
        return
    found_ids = set(
        (
            await db.execute(
                select(Document.id).where(
                    Document.id.in_(expected_ids),
                    Document.tenant_id == dataset.tenant_id,
                    Document.knowledge_base_id == dataset.knowledge_base_id,
                    Document.status == "ready",
                )
            )
        ).scalars()
    )
    missing = expected_ids.difference(found_ids)
    if missing:
        raise HTTPException(
            status_code=422,
            detail={
                "message": (
                    "expected documents must be ready and belong to the dataset knowledge base"
                ),
                "document_ids": sorted(str(item) for item in missing),
            },
        )


def _case_from_payload(dataset_id: UUID, payload: EvaluationCaseCreate) -> EvaluationCase:
    return EvaluationCase(
        dataset_id=dataset_id,
        question=payload.question,
        reference_answer=payload.reference_answer,
        expected_document_ids=[str(item) for item in payload.expected_document_ids],
        acceptable_citation_document_ids=[
            str(item) for item in payload.acceptable_citation_document_ids
        ],
        required_key_points=payload.required_key_points,
        required_key_point_groups=payload.required_key_point_groups,
        should_refuse=payload.should_refuse,
        tags=payload.tags,
    )


@router.post(
    "/datasets",
    response_model=EvaluationDatasetRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_dataset(
    payload: EvaluationDatasetCreate,
    identity: tuple[str, str] = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> EvaluationDataset:
    tenant_id, user_id = identity
    try:
        await knowledge_base_service.authorize(
            db,
            tenant_id,
            user_id,
            payload.knowledge_base_id,
            required_permission="editor",
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    dataset = EvaluationDataset(
        tenant_id=tenant_id,
        knowledge_base_id=payload.knowledge_base_id,
        name=payload.name,
        description=payload.description,
        status="active",
        created_by=user_id,
    )
    db.add(dataset)
    await db.flush()
    record_audit(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="evaluations.dataset_created",
        resource_type="evaluation_dataset",
        resource_id=str(dataset.id),
        details={"knowledge_base_id": str(dataset.knowledge_base_id)},
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="evaluation dataset name already exists"
        ) from exc
    await db.refresh(dataset)
    return dataset


@router.get("/datasets", response_model=list[EvaluationDatasetRead])
async def list_datasets(
    identity: tuple[str, str] = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> list[EvaluationDataset]:
    tenant_id, user_id = identity
    query = select(EvaluationDataset).where(
        EvaluationDataset.tenant_id == tenant_id,
        EvaluationDataset.status == "active",
    )
    if user_id not in get_settings().admin_user_ids:
        accessible = await knowledge_base_service.list_accessible(db, tenant_id, user_id)
        query = query.where(
            EvaluationDataset.knowledge_base_id.in_([item.id for item in accessible])
        )
    datasets = list(
        (await db.execute(query.order_by(EvaluationDataset.created_at.desc()))).scalars()
    )
    await db.commit()
    return datasets


@router.get("/datasets/{dataset_id}", response_model=EvaluationDatasetRead)
async def get_dataset(
    dataset_id: UUID,
    identity: tuple[str, str] = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> EvaluationDataset:
    return await _authorize_dataset(db, dataset_id, *identity)


@router.post(
    "/datasets/{dataset_id}/cases",
    response_model=EvaluationCaseRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_case(
    dataset_id: UUID,
    payload: EvaluationCaseCreate,
    identity: tuple[str, str] = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> EvaluationCase:
    tenant_id, user_id = identity
    dataset = await _authorize_dataset(db, dataset_id, tenant_id, user_id, "editor")
    await _validate_expected_documents(db, dataset, [payload])
    case = _case_from_payload(dataset.id, payload)
    db.add(case)
    await db.flush()
    record_audit(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="evaluations.case_created",
        resource_type="evaluation_case",
        resource_id=str(case.id),
        details={"dataset_id": str(dataset.id), "should_refuse": case.should_refuse},
    )
    await db.commit()
    await db.refresh(case)
    return case


@router.post(
    "/datasets/{dataset_id}/cases/bulk",
    response_model=list[EvaluationCaseRead],
    status_code=status.HTTP_201_CREATED,
)
async def create_cases_bulk(
    dataset_id: UUID,
    payload: EvaluationCaseBulkCreate,
    identity: tuple[str, str] = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> list[EvaluationCase]:
    tenant_id, user_id = identity
    dataset = await _authorize_dataset(db, dataset_id, tenant_id, user_id, "editor")
    await _validate_expected_documents(db, dataset, payload.cases)
    cases = [_case_from_payload(dataset.id, item) for item in payload.cases]
    db.add_all(cases)
    await db.flush()
    record_audit(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="evaluations.cases_bulk_created",
        resource_type="evaluation_dataset",
        resource_id=str(dataset.id),
        details={"case_count": len(cases)},
    )
    await db.commit()
    return cases


@router.get("/datasets/{dataset_id}/cases", response_model=list[EvaluationCaseRead])
async def list_cases(
    dataset_id: UUID,
    identity: tuple[str, str] = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> list[EvaluationCase]:
    await _authorize_dataset(db, dataset_id, *identity)
    return list(
        (
            await db.execute(
                select(EvaluationCase)
                .where(EvaluationCase.dataset_id == dataset_id)
                .order_by(EvaluationCase.created_at, EvaluationCase.id)
            )
        ).scalars()
    )


@router.post("/runs", response_model=EvaluationRunRead, status_code=status.HTTP_202_ACCEPTED)
async def create_run(
    payload: EvaluationRunCreate,
    identity: tuple[str, str] = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> EvaluationRun:
    tenant_id, user_id = identity
    dataset = await _authorize_dataset(db, payload.dataset_id, tenant_id, user_id, "editor")
    case_count = await db.scalar(
        select(func.count()).select_from(EvaluationCase).where(
            EvaluationCase.dataset_id == dataset.id
        )
    )
    if not case_count:
        raise HTTPException(status_code=409, detail="evaluation dataset has no cases")

    task_id = str(uuid4())
    run = EvaluationRun(
        tenant_id=tenant_id,
        knowledge_base_id=dataset.knowledge_base_id,
        dataset_id=dataset.id,
        created_by=user_id,
        task_id=task_id,
        status="queued",
        total_cases=case_count,
        config_snapshot=build_config_snapshot(),
    )
    db.add(run)
    await db.flush()
    record_audit(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="evaluations.run_requested",
        resource_type="evaluation_run",
        resource_id=str(run.id),
        details={"dataset_id": str(dataset.id), "case_count": case_count},
    )
    await db.commit()
    await db.refresh(run)
    try:
        run_evaluation_task.apply_async(args=[str(run.id)], task_id=task_id)
    except Exception as exc:
        run.status = "failed"
        run.error_message = f"failed to dispatch evaluation task: {exc}"[:4_000]
        await db.commit()
        raise HTTPException(status_code=503, detail="failed to dispatch evaluation task") from exc
    return run


async def _authorize_run(
    db: AsyncSession, run_id: UUID, tenant_id: str, user_id: str
) -> tuple[EvaluationRun, EvaluationDataset]:
    run = await db.get(EvaluationRun, run_id)
    if run is None or run.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="evaluation run not found")
    dataset = await _authorize_dataset(db, run.dataset_id, tenant_id, user_id)
    return run, dataset


@router.get("/runs/{run_id}", response_model=EvaluationRunRead)
async def get_run(
    run_id: UUID,
    identity: tuple[str, str] = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> EvaluationRun:
    run, _ = await _authorize_run(db, run_id, *identity)
    return run


async def _comparison_runs(
    db: AsyncSession,
    candidate_run_id: UUID,
    baseline_run_id: UUID,
    tenant_id: str,
    user_id: str,
) -> tuple[EvaluationRun, EvaluationRun]:
    candidate, _ = await _authorize_run(db, candidate_run_id, tenant_id, user_id)
    baseline, _ = await _authorize_run(db, baseline_run_id, tenant_id, user_id)
    if candidate.dataset_id != baseline.dataset_id:
        raise HTTPException(
            status_code=422, detail="evaluation runs must belong to the same dataset"
        )
    if candidate.status != "succeeded" or baseline.status != "succeeded":
        raise HTTPException(
            status_code=409,
            detail="evaluation runs must be succeeded before comparison",
        )
    return baseline, candidate


@router.post(
    "/runs/{candidate_run_id}/compare",
    response_model=EvaluationRunComparison,
)
async def compare_runs(
    candidate_run_id: UUID,
    payload: EvaluationRunComparisonRequest,
    identity: tuple[str, str] = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> EvaluationRunComparison:
    baseline, candidate = await _comparison_runs(
        db, candidate_run_id, payload.baseline_run_id, *identity
    )
    return EvaluationRunComparison.model_validate(
        compare_evaluation_runs(baseline, candidate)
    )


@router.post(
    "/runs/{candidate_run_id}/gate",
    response_model=EvaluationQualityGateReport,
)
async def gate_run(
    candidate_run_id: UUID,
    payload: EvaluationQualityGateRequest,
    identity: tuple[str, str] = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> EvaluationQualityGateReport:
    tenant_id, user_id = identity
    baseline, candidate = await _comparison_runs(
        db, candidate_run_id, payload.baseline_run_id, tenant_id, user_id
    )
    try:
        raw_report = evaluate_quality_gate(
            baseline,
            candidate,
            max_metric_regressions=payload.thresholds.max_metric_regressions,
            minimum_candidate_metrics=payload.thresholds.minimum_candidate_metrics,
            max_latency_increase_ratios=(
                payload.thresholds.max_latency_increase_ratios
            ),
            require_zero_failed_cases=payload.thresholds.require_zero_failed_cases,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    report = EvaluationQualityGateReport.model_validate(raw_report)
    record_audit(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="evaluations.quality_gate_checked",
        resource_type="evaluation_run",
        resource_id=str(candidate.id),
        details={
            "baseline_run_id": str(baseline.id),
            "passed": report.passed,
            "failed_metrics": [
                check.metric for check in report.checks if not check.passed
            ],
        },
    )
    await db.commit()
    if not report.passed:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=report.model_dump(mode="json"),
        )
    return report


@router.post("/runs/{run_id}/recalculate", response_model=EvaluationRunRead)
async def recalculate_run_metrics(
    run_id: UUID,
    identity: tuple[str, str] = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> EvaluationRun:
    tenant_id, user_id = identity
    run = await db.get(EvaluationRun, run_id)
    if run is None or run.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="evaluation run not found")
    await _authorize_dataset(db, run.dataset_id, tenant_id, user_id, "editor")
    recalculated = await recalculate_evaluation_run_metrics(run.id)
    record_audit(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="evaluations.metrics_recalculated",
        resource_type="evaluation_run",
        resource_id=str(run.id),
        details={"dataset_id": str(run.dataset_id)},
    )
    await db.commit()
    return recalculated


@router.get("/runs/{run_id}/report", response_model=EvaluationReport)
async def get_report(
    run_id: UUID,
    identity: tuple[str, str] = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> EvaluationReport:
    run, dataset = await _authorize_run(db, run_id, *identity)
    rows = (
        await db.execute(
            select(EvaluationResult, EvaluationCase)
            .join(EvaluationCase, EvaluationCase.id == EvaluationResult.case_id)
            .where(EvaluationResult.run_id == run.id)
            .order_by(EvaluationCase.created_at, EvaluationCase.id)
        )
    ).all()
    results = [
        EvaluationResultReport.model_validate(
            {
                **EvaluationResultRead.model_validate(result).model_dump(),
                "question": case.question,
                "reference_answer": case.reference_answer,
                "expected_document_ids": case.expected_document_ids,
                "acceptable_citation_document_ids": (
                    case.acceptable_citation_document_ids
                ),
                "required_key_points": case.required_key_points,
                "required_key_point_groups": case.required_key_point_groups,
                "should_refuse": case.should_refuse,
                "tags": case.tags,
            }
        )
        for result, case in rows
    ]
    return EvaluationReport(
        run=EvaluationRunRead.model_validate(run),
        dataset=EvaluationDatasetRead.model_validate(dataset),
        results=results,
    )
