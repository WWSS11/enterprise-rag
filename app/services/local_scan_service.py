import asyncio
import hashlib
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy import select

from app.core.config import get_settings
from app.db.models import Document, IngestionJob
from app.db.session import AsyncSessionFactory


@dataclass(frozen=True, slots=True)
class ScanDispatch:
    document_id: UUID
    job_id: UUID
    task_id: str
    path: Path


async def discover_local_documents(
    tenant_id: str,
    knowledge_base_id: UUID,
    root_alias: str,
) -> tuple[list[ScanDispatch], dict[str, int]]:
    settings = get_settings()
    configured_root = settings.scan_roots.get(root_alias)
    if configured_root is None:
        raise ValueError(f"unknown scan root alias: {root_alias}")
    root = configured_root.resolve()
    if not root.is_dir():
        raise ValueError(f"scan root does not exist: {root_alias}")

    files = await asyncio.to_thread(
        lambda: sorted(
            path
            for path in root.rglob("*")
            if path.is_file() and path.suffix.lower() in settings.supported_document_extensions
        )
    )
    dispatches: list[ScanDispatch] = []
    stats = {"discovered": len(files), "enqueued": 0, "unchanged": 0, "too_large": 0}
    max_bytes = settings.max_upload_mb * 1024 * 1024

    async with AsyncSessionFactory() as db:
        for path in files:
            size = path.stat().st_size
            if size > max_bytes:
                stats["too_large"] += 1
                continue
            content = await asyncio.to_thread(path.read_bytes)
            checksum = hashlib.sha256(content).hexdigest()
            source_key = f"{root_alias}:{path.relative_to(root).as_posix()}"
            document = await db.scalar(
                select(Document).where(
                    Document.knowledge_base_id == knowledge_base_id,
                    Document.source_type == "local_scan",
                    Document.source_key == source_key,
                )
            )
            if document is not None and document.checksum == checksum:
                stats["unchanged"] += 1
                continue
            duplicate_query = select(Document).where(
                Document.knowledge_base_id == knowledge_base_id,
                Document.checksum == checksum,
            )
            if document is not None:
                duplicate_query = duplicate_query.where(Document.id != document.id)
            duplicate = await db.scalar(duplicate_query)
            if duplicate is not None:
                stats["unchanged"] += 1
                continue

            if document is None:
                document = Document(
                    tenant_id=tenant_id,
                    knowledge_base_id=knowledge_base_id,
                    name=path.name,
                    source_type="local_scan",
                    source_key=source_key,
                    source_uri=str(path),
                    content_type=None,
                    checksum=checksum,
                    size_bytes=size,
                    status="pending",
                )
                db.add(document)
                await db.flush()
            else:
                document.name = path.name
                document.source_uri = str(path)
                document.checksum = checksum
                document.size_bytes = size
                document.status = "pending"
                document.error_message = None

            task_id = str(uuid4())
            job = IngestionJob(
                tenant_id=tenant_id,
                document_id=document.id,
                task_id=task_id,
                job_type="document_ingestion",
                status="queued",
            )
            db.add(job)
            await db.flush()
            dispatches.append(
                ScanDispatch(
                    document_id=document.id,
                    job_id=job.id,
                    task_id=task_id,
                    path=path,
                )
            )
            stats["enqueued"] += 1
        await db.commit()
    return dispatches, stats
