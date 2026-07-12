from __future__ import annotations

import hashlib
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import IngestionJob
from app.db.session import engine

ACTIVE_JOB_STATUSES = ("queued", "running")


@dataclass(frozen=True, slots=True)
class AdvisoryLock:
    namespace: str
    resource: str
    shared: bool = False

    @property
    def key(self) -> int:
        digest = hashlib.blake2b(
            f"{self.namespace}:{self.resource}".encode(), digest_size=8
        ).digest()
        return int.from_bytes(digest, byteorder="big", signed=True)


INDEX_MAINTENANCE_LOCK = AdvisoryLock("rag-index", "global", shared=True)
INDEX_REBUILD_LOCK = AdvisoryLock("rag-index", "global")


def document_index_lock(document_id: object) -> AdvisoryLock:
    return AdvisoryLock("rag-document", str(document_id))


async def active_document_job(
    db: AsyncSession, document_id: UUID
) -> IngestionJob | None:
    return await db.scalar(
        select(IngestionJob)
        .where(
            IngestionJob.document_id == document_id,
            IngestionJob.status.in_(ACTIVE_JOB_STATUSES),
        )
        .order_by(IngestionJob.created_at.desc())
        .limit(1)
    )


async def active_rebuild_job(db: AsyncSession) -> IngestionJob | None:
    return await db.scalar(
        select(IngestionJob)
        .where(
            IngestionJob.job_type == "vector_index_rebuild",
            IngestionJob.status.in_(ACTIVE_JOB_STATUSES),
        )
        .order_by(IngestionJob.created_at.desc())
        .limit(1)
    )


@asynccontextmanager
async def advisory_locks(locks: Sequence[AdvisoryLock]) -> AsyncIterator[None]:
    """Hold ordered PostgreSQL session locks until the protected operation finishes.

    Session-level advisory locks are released automatically if a Worker process or
    database connection dies, which makes them suitable for Celery late-ack redelivery.
    """

    acquired: list[AdvisoryLock] = []
    async with engine.connect() as connection:
        try:
            for lock in locks:
                function = "pg_advisory_lock_shared" if lock.shared else "pg_advisory_lock"
                await connection.execute(
                    text(f"SELECT {function}(:lock_key)"), {"lock_key": lock.key}
                )
                acquired.append(lock)
            yield
        finally:
            for lock in reversed(acquired):
                function = (
                    "pg_advisory_unlock_shared" if lock.shared else "pg_advisory_unlock"
                )
                await connection.execute(
                    text(f"SELECT {function}(:lock_key)"), {"lock_key": lock.key}
                )
