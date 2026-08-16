from pathlib import Path
from uuid import UUID

from redis.exceptions import LockError

from app.core.config import get_settings
from app.services.evaluation_service import execute_evaluation_run
from app.services.feishu_service import FeishuAPIError, prepare_feishu_sync
from app.services.ingestion_service import delete_document, ingest_document, rebuild_vector_index
from app.services.job_control_service import claim_job_execution
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
    parsed_job_id = UUID(job_id) if job_id else None
    return run_async(rebuild_vector_index(parsed_job_id))


@celery_app.task(name="app.tasks.scan_local_documents")
def scan_local_documents_task(
    tenant_id: str,
    knowledge_base_id: str,
    root_alias: str,
    parent_job_id: str,
) -> dict[str, object]:
    from app.services.ingestion_service import _set_job_state

    parent_id = UUID(parent_job_id)
    should_run = run_async(
        claim_job_execution(
            parent_id,
            expected_type="local_document_scan",
            progress=10,
        )
    )
    if not should_run:
        return {"status": "skipped", "reason": "job is already terminal"}
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
def sync_feishu_task(parent_job_id: str | None = None) -> dict[str, object]:
    from app.services.ingestion_service import _set_job_state

    settings = get_settings()
    parent_id = UUID(parent_job_id) if parent_job_id else None
    if parent_id is not None:
        should_run = run_async(
            claim_job_execution(
                parent_id,
                expected_type="feishu_sync",
                progress=5,
            )
        )
        if not should_run:
            return {"status": "skipped", "reason": "job is already terminal"}
    if not settings.feishu_enabled:
        result: dict[str, object] = {
            "status": "skipped",
            "reason": "APP_FEISHU_ENABLED=false",
        }
        if parent_id is not None:
            run_async(
                _set_job_state(
                    parent_id,
                    status="failed",
                    progress=100,
                    error_message="Feishu connector is disabled",
                    result={
                        **result,
                        "failure": {
                            "category": "configuration",
                            "message": "Feishu connector is disabled",
                        },
                    },
                )
            )
        return result

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
        result = {
            "status": "queued",
            **stats,
            "ingestion_jobs": len(ingestion_dispatches),
            "deletion_jobs": len(deletion_dispatches),
        }
        if parent_id is not None:
            run_async(
                _set_job_state(
                    parent_id,
                    status="succeeded",
                    progress=100,
                    result=result,
                )
            )
        return result
    except LockError:
        failure = {
            "category": "conflict",
            "message": "Another Feishu sync holds the connector lock",
            "retryable": True,
        }
        if parent_id is not None:
            run_async(
                _set_job_state(
                    parent_id,
                    status="failed",
                    progress=100,
                    error_message="another Feishu sync is running",
                    result={"failure": failure},
                )
            )
        return {"status": "skipped", "reason": "another Feishu sync is running"}
    except Exception as exc:
        failure = (
            exc.failure_details()
            if isinstance(exc, FeishuAPIError)
            else {
                "category": "configuration"
                if isinstance(exc, (LookupError, PermissionError, RuntimeError, ValueError))
                else "internal",
                "message": (
                    "Feishu connector configuration or target permission is invalid"
                    if isinstance(exc, (LookupError, PermissionError, RuntimeError, ValueError))
                    else "Feishu synchronization failed"
                ),
                "error_type": type(exc).__name__,
            }
        )
        if parent_id is not None:
            run_async(
                _set_job_state(
                    parent_id,
                    status="failed",
                    progress=100,
                    error_message=str(failure["message"])[:4_000],
                    result={"failure": failure},
                )
            )
        raise


@celery_app.task(name="app.tasks.run_evaluation")
def run_evaluation_task(run_id: str) -> dict[str, object]:
    return run_async(execute_evaluation_run(UUID(run_id)))
