import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import structlog
from sqlalchemy import delete, select

from app.core.config import get_settings
from app.db.models import (
    Document,
    DocumentAtomicUnit,
    DocumentChunk,
    DocumentSection,
    IngestionJob,
)
from app.db.session import AsyncSessionFactory
from app.services.chunking_service import (
    ChunkHierarchy,
    RetrievalDraft,
    build_chunk_hierarchy,
    build_chunk_hierarchy_async,
)
from app.services.document_parser import ParsedSection, parse_document_sections
from app.services.milvus_service import milvus_service
from app.services.model_provider import get_embedding_model

logger = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class ChunkDraft:
    chunk_index: int
    content: str
    metadata: dict[str, Any]
    embedding_content: str | None = None
    parent_section_index: int | None = None
    heading_path: tuple[str, ...] = ()
    atomic_start_index: int | None = None
    atomic_end_index: int | None = None


@dataclass(frozen=True, slots=True)
class EmbeddedChunk:
    draft: ChunkDraft
    vector: list[float]


async def _set_job_state(
    job_id: UUID,
    *,
    status: str,
    progress: int,
    error_message: str | None = None,
    result: dict[str, object] | None = None,
) -> None:
    async with AsyncSessionFactory() as db:
        job = await db.get(IngestionJob, job_id)
        if job is None:
            return
        job.status = status
        job.progress = progress
        job.error_message = error_message
        if result is not None:
            job.result = result
        await db.commit()


def build_chunk_drafts(document_name: str, sections: list[ParsedSection]) -> list[ChunkDraft]:
    """Compatibility projection of the V2 retrieval layer for tests and callers."""

    hierarchy = build_chunk_hierarchy(document_name, sections)
    return [_chunk_draft(item) for item in hierarchy.retrievals]


def _chunk_draft(item: RetrievalDraft) -> ChunkDraft:
    return ChunkDraft(
        chunk_index=item.chunk_index,
        content=item.content,
        embedding_content=item.embedding_content,
        parent_section_index=item.parent_section_index,
        heading_path=item.heading_path,
        atomic_start_index=item.atomic_start_index,
        atomic_end_index=item.atomic_end_index,
        metadata=item.metadata,
    )


async def embed_chunk_drafts(drafts: list[ChunkDraft]) -> list[EmbeddedChunk]:
    settings = get_settings()
    model = get_embedding_model()
    embedded: list[EmbeddedChunk] = []
    failures: list[tuple[int, str]] = []

    for offset in range(0, len(drafts), settings.embedding_batch_size):
        batch = drafts[offset : offset + settings.embedding_batch_size]
        texts = [draft.embedding_content or draft.content for draft in batch]
        try:
            vectors = await model.aembed_documents(texts)
            if len(vectors) != len(batch):
                raise ValueError("embedding provider returned an unexpected vector count")
            embedded.extend(
                EmbeddedChunk(draft=draft, vector=vector)
                for draft, vector in zip(batch, vectors, strict=True)
            )
            continue
        except Exception as batch_error:
            await logger.awarning(
                "embedding_batch_failed_retrying_individually",
                offset=offset,
                size=len(batch),
                error=str(batch_error),
            )

        for draft in batch:
            try:
                vectors = await model.aembed_documents([draft.embedding_content or draft.content])
                if len(vectors) != 1:
                    raise ValueError("embedding provider returned an unexpected vector count")
                vector = vectors[0]
                embedded.append(EmbeddedChunk(draft=draft, vector=vector))
            except Exception as exc:
                failures.append((draft.chunk_index, str(exc)))

    if failures and not settings.allow_partial_ingestion:
        indexes = ", ".join(str(index) for index, _ in failures[:20])
        raise RuntimeError(f"embedding failed for chunks: {indexes}")
    if not embedded:
        raise RuntimeError("embedding produced no usable chunks")
    return sorted(embedded, key=lambda item: item.draft.chunk_index)


def _vector_rows(
    document: Document,
    hierarchy: ChunkHierarchy,
    embedded: list[EmbeddedChunk],
    index_version: str,
) -> tuple[
    list[dict[str, object]],
    list[DocumentSection],
    list[DocumentAtomicUnit],
    list[DocumentChunk],
]:
    rows: list[dict[str, object]] = []
    section_models: list[DocumentSection] = []
    atomic_models: list[DocumentAtomicUnit] = []
    models: list[DocumentChunk] = []
    section_ids: dict[int, UUID] = {}
    atomic_to_section: dict[int, int] = {}
    for parent in hierarchy.parents:
        section_id = uuid4()
        section_ids[parent.section_index] = section_id
        for atomic_index in range(parent.atomic_start_index, parent.atomic_end_index + 1):
            atomic_to_section[atomic_index] = parent.section_index
        section_models.append(
            DocumentSection(
                id=section_id,
                tenant_id=document.tenant_id,
                knowledge_base_id=document.knowledge_base_id,
                document_id=document.id,
                index_version=index_version,
                section_index=parent.section_index,
                title=parent.title,
                heading_path=list(parent.heading_path),
                content=parent.content,
                token_count=parent.token_count,
                source_metadata=parent.metadata,
            )
        )
    for atomic in hierarchy.atomics:
        parent_index = atomic_to_section[atomic.atomic_index]
        atomic_models.append(
            DocumentAtomicUnit(
                id=uuid4(),
                tenant_id=document.tenant_id,
                knowledge_base_id=document.knowledge_base_id,
                document_id=document.id,
                section_id=section_ids[parent_index],
                index_version=index_version,
                atomic_index=atomic.atomic_index,
                content=atomic.content,
                token_count=atomic.token_count,
                source_metadata=atomic.metadata,
            )
        )
    for item in embedded:
        chunk_id = uuid4()
        vector_id = str(chunk_id)
        chunk_parent_index = item.draft.parent_section_index
        parent_section_id = (
            section_ids[chunk_parent_index] if chunk_parent_index is not None else None
        )
        embedding_content = item.draft.embedding_content or item.draft.content
        metadata = {
            **item.draft.metadata,
            "document_id": str(document.id),
            "document_name": document.name,
            "chunk_index": item.draft.chunk_index,
            "index_version": index_version,
        }
        models.append(
            DocumentChunk(
                id=chunk_id,
                tenant_id=document.tenant_id,
                knowledge_base_id=document.knowledge_base_id,
                document_id=document.id,
                parent_section_id=parent_section_id,
                vector_id=vector_id,
                index_version=index_version,
                chunk_index=item.draft.chunk_index,
                content=item.draft.content,
                embedding_content=embedding_content,
                heading_path=list(item.draft.heading_path),
                atomic_start_index=item.draft.atomic_start_index,
                atomic_end_index=item.draft.atomic_end_index,
                token_count=max(1, len(item.draft.content) // 2),
                source_metadata=metadata,
            )
        )
        rows.append(
            {
                "id": vector_id,
                "dense_vector": item.vector,
                "tenant_id": document.tenant_id,
                "knowledge_base_id": str(document.knowledge_base_id),
                "document_id": str(document.id),
                "document_name": document.name,
                "chunk_id": str(chunk_id),
                "chunk_index": item.draft.chunk_index,
                "parent_section_id": str(parent_section_id or ""),
                "heading_path": " > ".join(item.draft.heading_path),
                "atomic_start_index": item.draft.atomic_start_index or 0,
                "atomic_end_index": item.draft.atomic_end_index or 0,
                "index_version": index_version,
                "content": item.draft.content,
                "embedding_content": embedding_content,
            }
        )
    return rows, section_models, atomic_models, models


async def ingest_document(document_id: UUID, job_id: UUID, path: Path) -> dict[str, object]:
    await _set_job_state(job_id, status="running", progress=5)
    old_index_version: str | None = None
    new_index_version = uuid4().hex
    inserted_new_version = False
    try:
        async with AsyncSessionFactory() as db:
            document = await db.get(Document, document_id)
            if document is None:
                raise LookupError(f"document not found: {document_id}")
            old_index_version = document.index_version
            document.status = "processing"
            await db.commit()

        sections = await asyncio.to_thread(parse_document_sections, path)
        if not sections:
            raise ValueError("document contains no extractable text")
        await _set_job_state(job_id, status="running", progress=20)

        async with AsyncSessionFactory() as db:
            document = await db.get(Document, document_id)
            if document is None:
                raise LookupError(f"document disappeared during ingestion: {document_id}")
            hierarchy = await build_chunk_hierarchy_async(document.name, sections)
            drafts = [_chunk_draft(item) for item in hierarchy.retrievals]
            if not drafts:
                raise ValueError("document contains no indexable chunks")
            embedded = await embed_chunk_drafts(drafts)
            rows, section_models, atomic_models, chunk_models = _vector_rows(
                document, hierarchy, embedded, new_index_version
            )
        await _set_job_state(job_id, status="running", progress=65)

        await milvus_service.insert(rows)
        inserted_new_version = True
        await _set_job_state(job_id, status="running", progress=82)

        async with AsyncSessionFactory() as db:
            document = await db.get(Document, document_id)
            if document is None:
                raise LookupError(f"document disappeared during ingestion: {document_id}")
            await db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document_id))
            await db.execute(
                delete(DocumentAtomicUnit).where(DocumentAtomicUnit.document_id == document_id)
            )
            await db.execute(
                delete(DocumentSection).where(DocumentSection.document_id == document_id)
            )
            db.add_all([*section_models, *atomic_models, *chunk_models])
            document.status = "ready"
            document.index_version = new_index_version
            document.indexed_at = datetime.now(UTC)
            document.chunk_count = len(chunk_models)
            document.error_message = None
            await db.commit()

        try:
            await milvus_service.delete_document(
                str(document_id), keep_index_version=new_index_version
            )
        except Exception as exc:
            await logger.awarning(
                "stale_document_vectors_cleanup_failed",
                document_id=str(document_id),
                error=str(exc),
            )

        result: dict[str, object] = {
            "document_id": str(document_id),
            "chunk_count": len(chunk_models),
            "index_version": new_index_version,
        }
        await _set_job_state(job_id, status="succeeded", progress=100, result=result)
        await logger.ainfo("document_ingested", **result)
        return result
    except Exception as exc:
        if inserted_new_version:
            try:
                await milvus_service.delete_document_version(
                    str(document_id), new_index_version
                )
            except Exception:
                await logger.aexception(
                    "failed_to_compensate_new_vectors", document_id=str(document_id)
                )
        async with AsyncSessionFactory() as db:
            document = await db.get(Document, document_id)
            if document is not None:
                document.status = "ready" if old_index_version else "failed"
                document.error_message = str(exc)[:4_000]
                await db.commit()
        await _set_job_state(
            job_id,
            status="failed",
            progress=100,
            error_message=str(exc)[:4_000],
        )
        await logger.aexception("document_ingestion_failed", document_id=str(document_id))
        raise


async def delete_document(document_id: UUID, job_id: UUID) -> dict[str, object]:
    await _set_job_state(job_id, status="running", progress=20)
    await milvus_service.delete_document(str(document_id))
    await _set_job_state(job_id, status="running", progress=70)
    async with AsyncSessionFactory() as db:
        document = await db.get(Document, document_id)
        if document is not None:
            await db.delete(document)
        await db.commit()
    result: dict[str, object] = {"document_id": str(document_id), "deleted": True}
    await _set_job_state(job_id, status="succeeded", progress=100, result=result)
    return result


async def rebuild_vector_index() -> dict[str, object]:
    collection = await milvus_service.new_rebuild_collection()
    inserted = 0
    try:
        async with AsyncSessionFactory() as db:
            result = await db.stream(
                select(DocumentChunk, Document.name)
                .join(Document, Document.id == DocumentChunk.document_id)
                .where(
                    Document.status == "ready",
                    Document.index_version == DocumentChunk.index_version,
                )
                .order_by(DocumentChunk.document_id, DocumentChunk.chunk_index)
                .execution_options(yield_per=500)
            )
            batch: list[tuple[DocumentChunk, str]] = []
            async for chunk, document_name in result:
                batch.append((chunk, document_name))
                if len(batch) < get_settings().embedding_batch_size:
                    continue
                inserted += await _insert_rebuild_batch(collection, batch)
                batch.clear()
            if batch:
                inserted += await _insert_rebuild_batch(collection, batch)

        await milvus_service.switch_alias(collection)
        dropped = await milvus_service.cleanup_old_collections(collection)
        return {
            "collection": collection,
            "status": "ready",
            "vector_count": inserted,
            "dropped_collections": dropped,
        }
    except Exception:
        await milvus_service.drop_collection(collection)
        raise


async def _insert_rebuild_batch(
    collection: str, batch: list[tuple[DocumentChunk, str]]
) -> int:
    drafts = [
        ChunkDraft(
            chunk_index=position,
            content=chunk.content,
            embedding_content=chunk.embedding_content,
            parent_section_index=None,
            heading_path=tuple(chunk.heading_path),
            atomic_start_index=chunk.atomic_start_index,
            atomic_end_index=chunk.atomic_end_index,
            metadata=chunk.source_metadata,
        )
        for position, (chunk, _) in enumerate(batch)
    ]
    embedded = await embed_chunk_drafts(drafts)
    vector_by_position = {item.draft.chunk_index: item.vector for item in embedded}
    rows: list[dict[str, object]] = []
    for position, (chunk, document_name) in enumerate(batch):
        vector = vector_by_position.get(position)
        if vector is None:
            continue
        rows.append(
            {
                "id": chunk.vector_id,
                "dense_vector": vector,
                "tenant_id": chunk.tenant_id,
                "knowledge_base_id": str(chunk.knowledge_base_id),
                "document_id": str(chunk.document_id),
                "document_name": document_name,
                "chunk_id": str(chunk.id),
                "chunk_index": chunk.chunk_index,
                "parent_section_id": str(chunk.parent_section_id or ""),
                "heading_path": " > ".join(chunk.heading_path),
                "atomic_start_index": chunk.atomic_start_index or 0,
                "atomic_end_index": chunk.atomic_end_index or 0,
                "index_version": chunk.index_version,
                "content": chunk.content,
                "embedding_content": chunk.embedding_content,
            }
        )
    await milvus_service.insert(rows, collection_name=collection)
    return len(rows)
