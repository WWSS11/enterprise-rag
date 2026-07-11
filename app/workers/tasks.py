from pathlib import Path
from uuid import UUID

from redis.exceptions import LockError

from app.core.config import get_settings
from app.services.evaluation_service import execute_evaluation_run
from app.services.feishu_service import prepare_feishu_sync
from app.services.ingestion_service import delete_document, ingest_document, rebuild_vector_index
from app.services.local_scan_service import discover_local_documents
from app.services.redis_service import redis_service
from app.workers.async_runtime import run_async
from app.workers.celery_app import celery_app


@celery_app.task(name="app.tasks.ingest_document")
def ingest_document_task(document_id: str, job_id: str, path: str) -> dict[str, object]:
    return run_async(ingest_document(UUID(document_id), UUID(job_id), Path(path)))


@celery_app.task(name="app.tasks.delete_document")
def delete_document_task(document_id: str, job_id: str) -> dict[str, object]:
    return run_async(delete_document(UUID(document_id), UUID(job_id)))


@celery_app.task(name="app.tasks.rebuild_index")
def rebuild_index_task(job_id: str | None = None) -> dict[str, object]:
    from app.services.ingestion_service import _set_job_state

    parsed_job_id = UUID(job_id) if job_id else None
    if parsed_job_id:
        run_async(_set_job_state(parsed_job_id, status="running", progress=5))
    try:
        result = run_async(rebuild_vector_index())
        if parsed_job_id:
            run_async(
                _set_job_state(
                    parsed_job_id, status="succeeded", progress=100, result=result
                )
            )
        return result
    except Exception as exc:
        if parsed_job_id:
            run_async(
                _set_job_state(
                    parsed_job_id,
                    status="failed",
                    progress=100,
                    error_message=str(exc)[:4_000],
                )
            )
        raise


@celery_app.task(name="app.tasks.scan_local_documents")
def scan_local_documents_task(
    tenant_id: str,
    knowledge_base_id: str,
    root_alias: str,
    parent_job_id: str,
) -> dict[str, object]:
    from app.services.ingestion_service import _set_job_state

    parent_id = UUID(parent_job_id)
    run_async(_set_job_state(parent_id, status="running", progress=10))
    try:
        dispatches, stats = run_async(
            discover_local_documents(tenant_id, UUID(knowledge_base_id), root_alias)
        )
        for dispatch in dispatches:
            ingest_document_task.apply_async(
                args=[str(dispatch.document_id), str(dispatch.job_id), str(dispatch.path)],
                task_id=dispatch.task_id,
            )
        result: dict[str, object] = {**stats, "root_alias": root_alias}
        run_async(
            _set_job_state(
                parent_id,
                status="succeeded",
                progress=100,
                result=result,
            )
        )
        return result
    except Exception as exc:
        run_async(
            _set_job_state(
                parent_id,
                status="failed",
                progress=100,
                error_message=str(exc)[:4_000],
            )
        )
        raise


@celery_app.task(name="app.tasks.sync_feishu")
def sync_feishu_task() -> dict[str, object]:
    settings = get_settings()
    if not settings.feishu_enabled:
        return {"status": "skipped", "reason": "APP_FEISHU_ENABLED=false"}

    async def prepare_with_lock():
        lock = redis_service.client.lock(
            f"connector:feishu:sync-lock:{settings.feishu_space_id}",
            timeout=3_600,
            blocking_timeout=1,
        )
        async with lock:
            return await prepare_feishu_sync()

    try:
        ingestion_dispatches, deletion_dispatches, stats = run_async(prepare_with_lock())
    except LockError:
        return {"status": "skipped", "reason": "another Feishu sync is running"}

    for dispatch in ingestion_dispatches:
        ingest_document_task.apply_async(
            args=[str(dispatch.document_id), str(dispatch.job_id), str(dispatch.path)],
            task_id=dispatch.task_id,
        )
    for dispatch in deletion_dispatches:
        delete_document_task.apply_async(
            args=[str(dispatch.document_id), str(dispatch.job_id)],
            task_id=dispatch.task_id,
        )
    return {"status": "queued", **stats}


@celery_app.task(name="app.tasks.run_evaluation")
def run_evaluation_task(run_id: str) -> dict[str, object]:
    return run_async(execute_evaluation_run(UUID(run_id)))
