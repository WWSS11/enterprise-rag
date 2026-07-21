from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import request_identity
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
    EvaluationCasePage,
    EvaluationCaseRead,
    EvaluationCaseUpdate,
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
    EvaluationRunPage,
    EvaluationRunRead,
)
from app.security.identity import RequestIdentity
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
    identity: RequestIdentity,
    required_permission: str = "reader",
) -> EvaluationDataset:
    dataset = await db.get(EvaluationDataset, dataset_id)
    if dataset is None or dataset.tenant_id != identity.tenant_id or dataset.status != "active":
        raise HTTPException(status_code=404, detail="evaluation dataset not found")
    try:
        await knowledge_base_service.authorize_identity(
            db,
            identity,
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


def _apply_case_payload(case: EvaluationCase, payload: EvaluationCaseCreate) -> None:
    case.question = payload.question
    case.reference_answer = payload.reference_answer
    case.expected_document_ids = [str(item) for item in payload.expected_document_ids]
    case.acceptable_citation_document_ids = [
        str(item) for item in payload.acceptable_citation_document_ids
    ]
    case.required_key_points = payload.required_key_points
    case.required_key_point_groups = payload.required_key_point_groups
    case.should_refuse = payload.should_refuse
    case.tags = payload.tags


async def _mutable_case(
    db: AsyncSession,
    dataset: EvaluationDataset,
    case_id: UUID,
) -> EvaluationCase:
    case = await db.get(EvaluationCase, case_id)
    if case is None or case.dataset_id != dataset.id:
        raise HTTPException(status_code=404, detail="evaluation case not found")
    active_runs = int(
        await db.scalar(
            select(func.count())
            .select_from(EvaluationRun)
            .where(
                EvaluationRun.dataset_id == dataset.id,
                EvaluationRun.status.in_(["queued", "running"]),
            )
        )
        or 0
    )
    if active_runs:
        raise HTTPException(
            status_code=409,
            detail="evaluation cases cannot change while a run is queued or running",
        )
    result_count = int(
        await db.scalar(
            select(func.count())
            .select_from(EvaluationResult)
            .where(EvaluationResult.case_id == case.id)
        )
        or 0
    )
    if result_count:
        raise HTTPException(
            status_code=409,
            detail="evaluated cases are immutable to preserve historical reports",
        )
    return case


@router.post(
    "/datasets",
    response_model=EvaluationDatasetRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_dataset(
    payload: EvaluationDatasetCreate,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> EvaluationDataset:
    tenant_id = identity.tenant_id
    user_id = identity.user_id
    try:
        await knowledge_base_service.authorize_identity(
            db,
            identity,
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
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> list[EvaluationDataset]:
    tenant_id = identity.tenant_id
    query = select(EvaluationDataset).where(
        EvaluationDataset.tenant_id == tenant_id,
        EvaluationDataset.status == "active",
    )
    if not identity.is_admin:
        accessible = await knowledge_base_service.list_accessible_identity(db, identity)
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
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> EvaluationDataset:
    return await _authorize_dataset(db, dataset_id, identity)


@router.post(
    "/datasets/{dataset_id}/cases",
    response_model=EvaluationCaseRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_case(
    dataset_id: UUID,
    payload: EvaluationCaseCreate,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> EvaluationCase:
    tenant_id = identity.tenant_id
    user_id = identity.user_id
    dataset = await _authorize_dataset(db, dataset_id, identity, "editor")
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
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> list[EvaluationCase]:
    tenant_id = identity.tenant_id
    user_id = identity.user_id
    dataset = await _authorize_dataset(db, dataset_id, identity, "editor")
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


@router.get("/datasets/{dataset_id}/cases", response_model=EvaluationCasePage)
async def list_cases(
    dataset_id: UUID,
    query: str | None = Query(default=None, alias="q", max_length=200),
    should_refuse: bool | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> EvaluationCasePage:
    await _authorize_dataset(db, dataset_id, identity)
    conditions = [EvaluationCase.dataset_id == dataset_id]
    if query:
        search = f"%{query.strip()}%"
        conditions.append(
            or_(
                EvaluationCase.question.ilike(search),
                EvaluationCase.reference_answer.ilike(search),
            )
        )
    if should_refuse is not None:
        conditions.append(EvaluationCase.should_refuse == should_refuse)
    total = int(
        await db.scalar(
            select(func.count()).select_from(EvaluationCase).where(*conditions)
        )
        or 0
    )
    items = list(
        (
            await db.execute(
                select(EvaluationCase)
                .where(*conditions)
                .order_by(EvaluationCase.created_at.desc(), EvaluationCase.id.desc())
                .limit(limit)
                .offset(offset)
            )
        ).scalars()
    )
    return EvaluationCasePage(items=items, total=total, limit=limit, offset=offset)


@router.put(
    "/datasets/{dataset_id}/cases/{case_id}",
    response_model=EvaluationCaseRead,
)
async def update_case(
    dataset_id: UUID,
    case_id: UUID,
    payload: EvaluationCaseUpdate,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> EvaluationCase:
    dataset = await _authorize_dataset(db, dataset_id, identity, "editor")
    case = await _mutable_case(db, dataset, case_id)
    await _validate_expected_documents(db, dataset, [payload])
    _apply_case_payload(case, payload)
    record_audit(
        db,
        tenant_id=identity.tenant_id,
        user_id=identity.user_id,
        action="evaluations.case_updated",
        resource_type="evaluation_case",
        resource_id=str(case.id),
        details={"dataset_id": str(dataset.id), "should_refuse": case.should_refuse},
    )
    await db.commit()
    await db.refresh(case)
    return case


@router.delete(
    "/datasets/{dataset_id}/cases/{case_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_case(
    dataset_id: UUID,
    case_id: UUID,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> Response:
    dataset = await _authorize_dataset(db, dataset_id, identity, "editor")
    case = await _mutable_case(db, dataset, case_id)
    details = {"dataset_id": str(dataset.id), "should_refuse": case.should_refuse}
    await db.delete(case)
    record_audit(
        db,
        tenant_id=identity.tenant_id,
        user_id=identity.user_id,
        action="evaluations.case_deleted",
        resource_type="evaluation_case",
        resource_id=str(case.id),
        details=details,
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/runs", response_model=EvaluationRunRead, status_code=status.HTTP_202_ACCEPTED)
async def create_run(
    payload: EvaluationRunCreate,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> EvaluationRun:
    tenant_id = identity.tenant_id
    user_id = identity.user_id
    dataset = await _authorize_dataset(db, payload.dataset_id, identity, "editor")
    case_count = await db.scalar(
        select(func.count())
        .select_from(EvaluationCase)
        .where(EvaluationCase.dataset_id == dataset.id)
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


@router.get("/runs", response_model=EvaluationRunPage)
async def list_runs(
    dataset_id: UUID | None = None,
    run_status: str | None = Query(default=None, alias="status", max_length=32),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> EvaluationRunPage:
    conditions = [EvaluationRun.tenant_id == identity.tenant_id]
    if dataset_id is not None:
        dataset = await _authorize_dataset(db, dataset_id, identity)
        conditions.append(EvaluationRun.dataset_id == dataset.id)
    elif not identity.is_admin:
        accessible = await knowledge_base_service.list_accessible_identity(db, identity)
        conditions.append(
            EvaluationRun.knowledge_base_id.in_([item.id for item in accessible])
        )
    if run_status:
        conditions.append(EvaluationRun.status == run_status)

    total = int(
        await db.scalar(select(func.count()).select_from(EvaluationRun).where(*conditions)) or 0
    )
    items = list(
        (
            await db.execute(
                select(EvaluationRun)
                .where(*conditions)
                .order_by(EvaluationRun.created_at.desc(), EvaluationRun.id.desc())
                .limit(limit)
                .offset(offset)
            )
        ).scalars()
    )
    await db.commit()
    return EvaluationRunPage(items=items, total=total, limit=limit, offset=offset)


async def _authorize_run(
    db: AsyncSession, run_id: UUID, identity: RequestIdentity
) -> tuple[EvaluationRun, EvaluationDataset]:
    run = await db.get(EvaluationRun, run_id)
    if run is None or run.tenant_id != identity.tenant_id:
        raise HTTPException(status_code=404, detail="evaluation run not found")
    dataset = await _authorize_dataset(db, run.dataset_id, identity)
    return run, dataset


@router.get("/runs/{run_id}", response_model=EvaluationRunRead)
async def get_run(
    run_id: UUID,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> EvaluationRun:
    run, _ = await _authorize_run(db, run_id, identity)
    return run


async def _comparison_runs(
    db: AsyncSession,
    candidate_run_id: UUID,
    baseline_run_id: UUID,
    identity: RequestIdentity,
) -> tuple[EvaluationRun, EvaluationRun]:
    candidate, _ = await _authorize_run(db, candidate_run_id, identity)
    baseline, _ = await _authorize_run(db, baseline_run_id, identity)
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
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> EvaluationRunComparison:
    baseline, candidate = await _comparison_runs(
        db, candidate_run_id, payload.baseline_run_id, identity
    )
    return EvaluationRunComparison.model_validate(compare_evaluation_runs(baseline, candidate))


@router.post(
    "/runs/{candidate_run_id}/gate",
    response_model=EvaluationQualityGateReport,
)
async def gate_run(
    candidate_run_id: UUID,
    payload: EvaluationQualityGateRequest,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> EvaluationQualityGateReport:
    tenant_id = identity.tenant_id
    user_id = identity.user_id
    baseline, candidate = await _comparison_runs(
        db, candidate_run_id, payload.baseline_run_id, identity
    )
    try:
        raw_report = evaluate_quality_gate(
            baseline,
            candidate,
            max_metric_regressions=payload.thresholds.max_metric_regressions,
            minimum_candidate_metrics=payload.thresholds.minimum_candidate_metrics,
            max_latency_increase_ratios=(payload.thresholds.max_latency_increase_ratios),
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
            "failed_metrics": [check.metric for check in report.checks if not check.passed],
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
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> EvaluationRun:
    tenant_id = identity.tenant_id
    user_id = identity.user_id
    run = await db.get(EvaluationRun, run_id)
    if run is None or run.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="evaluation run not found")
    await _authorize_dataset(db, run.dataset_id, identity, "editor")
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
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> EvaluationReport:
    run, dataset = await _authorize_run(db, run_id, identity)
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
                "acceptable_citation_document_ids": (case.acceptable_citation_document_ids),
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
