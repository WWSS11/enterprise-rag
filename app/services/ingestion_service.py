import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import structlog
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sqlalchemy import delete, select

from app.core.config import get_settings
from app.db.models import Document, DocumentChunk, IngestionJob
from app.db.session import AsyncSessionFactory
from app.services.document_parser import ParsedSection, parse_document_sections
from app.services.milvus_service import milvus_service
from app.services.model_provider import get_embedding_model

logger = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class ChunkDraft:
    chunk_index: int
    content: str
    metadata: dict[str, Any]


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


def _section_label(metadata: dict[str, Any]) -> str:
    if "page" in metadata:
        return f"页码:{metadata['page']}"
    if "slide" in metadata:
        return f"幻灯片:{metadata['slide']}"
    if "sheet" in metadata:
        return f"工作表:{metadata['sheet']}"
    return ""


def build_chunk_drafts(document_name: str, sections: list[ParsedSection]) -> list[ChunkDraft]:
    settings = get_settings()
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
        separators=["\n\n", "\n", "。", "！", "？", ". ", " ", ""],
    )
    drafts: list[ChunkDraft] = []
    for section in sections:
        label = _section_label(section.metadata)
        prefix = f"[来源:{document_name}]" + (f" [{label}]" if label else "")
        for content in splitter.split_text(section.text):
            content = content.strip()
            if not content:
                continue
            drafts.append(
                ChunkDraft(
                    chunk_index=len(drafts),
                    content=f"{prefix}\n{content}",
                    metadata=dict(section.metadata),
                )
            )
    return drafts


async def embed_chunk_drafts(drafts: list[ChunkDraft]) -> list[EmbeddedChunk]:
    settings = get_settings()
    model = get_embedding_model()
    embedded: list[EmbeddedChunk] = []
    failures: list[tuple[int, str]] = []

    for offset in range(0, len(drafts), settings.embedding_batch_size):
        batch = drafts[offset : offset + settings.embedding_batch_size]
        texts = [draft.content for draft in batch]
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
                vectors = await model.aembed_documents([draft.content])
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
    embedded: list[EmbeddedChunk],
    index_version: str,
) -> tuple[list[dict[str, object]], list[DocumentChunk]]:
    rows: list[dict[str, object]] = []
    models: list[DocumentChunk] = []
    for item in embedded:
        chunk_id = uuid4()
        vector_id = str(chunk_id)
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
                vector_id=vector_id,
                index_version=index_version,
                chunk_index=item.draft.chunk_index,
                content=item.draft.content,
                token_count=max(1, len(item.draft.content) // 2),
                source_metadata=metadata,
            )
        )
        rows.append(
            {
                "id": vector_id,
                "vector": item.vector,
                "tenant_id": document.tenant_id,
                "knowledge_base_id": str(document.knowledge_base_id),
                "document_id": str(document.id),
                "document_name": document.name,
                "chunk_id": str(chunk_id),
                "chunk_index": item.draft.chunk_index,
                "index_version": index_version,
                "content": item.draft.content,
            }
        )
    return rows, models


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
            drafts = build_chunk_drafts(document.name, sections)
            if not drafts:
                raise ValueError("document contains no indexable chunks")
            embedded = await embed_chunk_drafts(drafts)
            rows, chunk_models = _vector_rows(document, embedded, new_index_version)
        await _set_job_state(job_id, status="running", progress=65)

        await milvus_service.insert(rows)
        inserted_new_version = True
        await _set_job_state(job_id, status="running", progress=82)

        async with AsyncSessionFactory() as db:
            document = await db.get(Document, document_id)
            if document is None:
                raise LookupError(f"document disappeared during ingestion: {document_id}")
            await db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document_id))
            db.add_all(chunk_models)
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
                "vector": vector,
                "tenant_id": chunk.tenant_id,
                "knowledge_base_id": str(chunk.knowledge_base_id),
                "document_id": str(chunk.document_id),
                "document_name": document_name,
                "chunk_id": str(chunk.id),
                "chunk_index": chunk.chunk_index,
                "index_version": chunk.index_version,
                "content": chunk.content,
            }
        )
    await milvus_service.insert(rows, collection_name=collection)
    return len(rows)
