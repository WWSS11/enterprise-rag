import asyncio
import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote
from uuid import UUID, uuid4

import httpx
import orjson
import structlog
from sqlalchemy import select

from app.core.config import get_settings
from app.db.models import Document, IngestionJob
from app.db.session import AsyncSessionFactory
from app.services.knowledge_base_service import knowledge_base_service
from app.services.redis_service import redis_service

logger = structlog.get_logger(__name__)


class FeishuAPIError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class FeishuNode:
    node_token: str
    obj_token: str
    obj_type: str
    title: str
    parent_node_token: str | None
    has_child: bool
    updated_at: datetime | None


@dataclass(frozen=True, slots=True)
class RemoteDocument:
    source_key: str
    title: str
    content: str
    updated_at: datetime | None
    metadata: dict[str, Any]


@dataclass(frozen=True, slots=True)
class ConnectorDispatch:
    document_id: UUID
    job_id: UUID
    task_id: str
    path: Path


@dataclass(frozen=True, slots=True)
class DeleteDispatch:
    document_id: UUID
    job_id: UUID
    task_id: str


def _parse_timestamp(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    try:
        number = int(value)
        if number > 10_000_000_000:
            number //= 1_000
        return datetime.fromtimestamp(number, tz=UTC)
    except (TypeError, ValueError, OSError):
        return None


class FeishuClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    async def _tenant_access_token(self) -> str:
        cache_key = f"connector:feishu:token:{self.settings.feishu_app_id}"
        cached = await redis_service.client.get(cache_key)
        if cached:
            return str(cached)

        lock = redis_service.client.lock(
            f"{cache_key}:lock", timeout=30, blocking_timeout=10
        )
        async with lock:
            cached = await redis_service.client.get(cache_key)
            if cached:
                return str(cached)
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(
                    f"{self.settings.feishu_base_url.rstrip('/')}/auth/v3/tenant_access_token/internal",
                    json={
                        "app_id": self.settings.feishu_app_id,
                        "app_secret": self.settings.feishu_app_secret,
                    },
                )
                response.raise_for_status()
                payload = response.json()
            if int(payload.get("code", 0)) != 0:
                raise FeishuAPIError(
                    f"Feishu token request failed: {payload.get('msg', 'unknown error')}"
                )
            token = str(payload.get("tenant_access_token", ""))
            if not token:
                raise FeishuAPIError("Feishu token response did not contain a token")
            expires_in = max(60, int(payload.get("expire", 7_200)) - 60)
            await redis_service.client.set(cache_key, token, ex=expires_in)
            return token

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        token = await self._tenant_access_token()
        url = f"{self.settings.feishu_base_url.rstrip('/')}/{path.lstrip('/')}"
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=60) as client:
                    response = await client.request(
                        method,
                        url,
                        params=params,
                        headers={"Authorization": f"Bearer {token}"},
                    )
                if response.status_code == 429 or response.status_code >= 500:
                    response.raise_for_status()
                response.raise_for_status()
                payload = response.json()
                if int(payload.get("code", 0)) != 0:
                    raise FeishuAPIError(
                        f"Feishu API {path} failed: {payload.get('msg', 'unknown error')}"
                    )
                return dict(payload.get("data") or {})
            except (httpx.HTTPError, ValueError, FeishuAPIError) as exc:
                last_error = exc
                if attempt == 2:
                    break
                await asyncio.sleep(2**attempt)
        raise FeishuAPIError(f"Feishu API request failed: {last_error}")

    async def list_wiki_nodes(self, space_id: str) -> list[FeishuNode]:
        nodes: list[FeishuNode] = []
        parents: list[str | None] = [None]
        visited: set[str] = set()
        while parents:
            parent = parents.pop()
            page_token: str | None = None
            while True:
                params: dict[str, Any] = {"page_size": self.settings.feishu_sync_page_size}
                if parent:
                    params["parent_node_token"] = parent
                if page_token:
                    params["page_token"] = page_token
                data = await self._request(
                    "GET", f"wiki/v2/spaces/{space_id}/nodes", params=params
                )
                for raw in data.get("items", []):
                    node_token = str(raw.get("node_token", ""))
                    if not node_token or node_token in visited:
                        continue
                    visited.add(node_token)
                    node = FeishuNode(
                        node_token=node_token,
                        obj_token=str(raw.get("obj_token", "")),
                        obj_type=str(raw.get("obj_type", "")),
                        title=str(raw.get("title") or node_token),
                        parent_node_token=raw.get("parent_node_token"),
                        has_child=bool(raw.get("has_child", False)),
                        updated_at=_parse_timestamp(raw.get("obj_edit_time")),
                    )
                    nodes.append(node)
                    if node.has_child:
                        parents.append(node.node_token)
                if not data.get("has_more"):
                    break
                page_token = str(data.get("page_token", "")) or None
        return nodes

    async def _docx_content(self, document_id: str) -> str:
        data = await self._request(
            "GET", f"docx/v1/documents/{document_id}/raw_content"
        )
        return str(data.get("content", "")).strip()

    async def _sheet_content(self, spreadsheet_token: str) -> str:
        data = await self._request(
            "GET", f"sheets/v3/spreadsheets/{spreadsheet_token}/sheets/query"
        )
        sections: list[str] = []
        for sheet in data.get("sheets", []):
            sheet_id = str(sheet.get("sheet_id", ""))
            if not sheet_id:
                continue
            title = str(sheet.get("title") or sheet_id)
            values = await self._request(
                "GET",
                f"sheets/v2/spreadsheets/{spreadsheet_token}/values/{quote(sheet_id, safe='')}",
            )
            matrix = values.get("valueRange", {}).get("values", [])
            lines = [
                "\t".join("" if cell is None else str(cell) for cell in row)
                for row in matrix
            ]
            sections.append(f"# Sheet: {title}\n" + "\n".join(lines))
        return "\n\n".join(sections).strip()

    async def _bitable_content(self, app_token: str) -> str:
        tables: list[dict[str, Any]] = []
        page_token: str | None = None
        while True:
            params: dict[str, Any] = {"page_size": 100}
            if page_token:
                params["page_token"] = page_token
            data = await self._request(
                "GET", f"bitable/v1/apps/{app_token}/tables", params=params
            )
            tables.extend(data.get("items", []))
            if not data.get("has_more"):
                break
            page_token = str(data.get("page_token", "")) or None

        sections: list[str] = []
        for table in tables:
            table_id = str(table.get("table_id", ""))
            if not table_id:
                continue
            records: list[dict[str, Any]] = []
            page_token = None
            while True:
                params = {"page_size": 500}
                if page_token:
                    params["page_token"] = page_token
                data = await self._request(
                    "GET",
                    f"bitable/v1/apps/{app_token}/tables/{table_id}/records",
                    params=params,
                )
                records.extend(data.get("items", []))
                if not data.get("has_more"):
                    break
                page_token = str(data.get("page_token", "")) or None
            title = str(table.get("name") or table_id)
            sections.append(
                f"# Bitable: {title}\n"
                + orjson.dumps(records, option=orjson.OPT_INDENT_2).decode()
            )
        return "\n\n".join(sections).strip()

    async def remote_documents(self, space_id: str) -> tuple[list[RemoteDocument], int]:
        remote: list[RemoteDocument] = []
        unsupported = 0
        for node in await self.list_wiki_nodes(space_id):
            if node.obj_type == "docx":
                content = await self._docx_content(node.obj_token)
            elif node.obj_type == "sheet":
                content = await self._sheet_content(node.obj_token)
            elif node.obj_type == "bitable":
                content = await self._bitable_content(node.obj_token)
            else:
                unsupported += 1
                continue
            if not content:
                continue
            remote.append(
                RemoteDocument(
                    source_key=f"{space_id}:{node.node_token}",
                    title=node.title,
                    content=content,
                    updated_at=node.updated_at,
                    metadata={
                        "space_id": space_id,
                        "node_token": node.node_token,
                        "obj_token": node.obj_token,
                        "obj_type": node.obj_type,
                        "parent_node_token": node.parent_node_token,
                    },
                )
            )
        return remote, unsupported


async def prepare_feishu_sync() -> tuple[
    list[ConnectorDispatch], list[DeleteDispatch], dict[str, int | str]
]:
    settings = get_settings()
    if not settings.feishu_app_id or not settings.feishu_app_secret or not settings.feishu_space_id:
        raise RuntimeError("Feishu sync requires app id, app secret and space id")

    async with AsyncSessionFactory() as db:
        configured_id = (
            UUID(settings.feishu_knowledge_base_id)
            if settings.feishu_knowledge_base_id
            else None
        )
        knowledge_base = await knowledge_base_service.authorize(
            db,
            settings.feishu_tenant_id,
            settings.feishu_run_as_user,
            configured_id,
            required_permission="editor",
        )
        await db.commit()

    remote_documents, unsupported = await FeishuClient().remote_documents(
        settings.feishu_space_id
    )
    remote_keys = {item.source_key for item in remote_documents}
    connector_dir = (
        settings.connector_dir
        / "feishu"
        / settings.feishu_tenant_id
        / settings.feishu_space_id
    ).resolve()
    await asyncio.to_thread(connector_dir.mkdir, parents=True, exist_ok=True)

    ingestion_dispatches: list[ConnectorDispatch] = []
    deletion_dispatches: list[DeleteDispatch] = []
    stats: dict[str, int | str] = {
        "space_id": settings.feishu_space_id,
        "remote": len(remote_documents),
        "enqueued": 0,
        "unchanged": 0,
        "deleted": 0,
        "unsupported": unsupported,
    }
    async with AsyncSessionFactory() as db:
        for item in remote_documents:
            checksum = hashlib.sha256(item.content.encode()).hexdigest()
            document = await db.scalar(
                select(Document).where(
                    Document.knowledge_base_id == knowledge_base.id,
                    Document.source_type == "feishu",
                    Document.source_key == item.source_key,
                )
            )
            if document is not None and document.checksum == checksum:
                document.name = item.title
                document.source_updated_at = item.updated_at
                document.extra_metadata = item.metadata
                stats["unchanged"] = int(stats["unchanged"]) + 1
                continue

            filename = f"{item.metadata['node_token']}.txt"
            path = connector_dir / filename
            await asyncio.to_thread(path.write_text, item.content, encoding="utf-8")
            if document is None:
                duplicate = await db.scalar(
                    select(Document).where(
                        Document.knowledge_base_id == knowledge_base.id,
                        Document.checksum == checksum,
                    )
                )
                if duplicate is not None:
                    stats["unchanged"] = int(stats["unchanged"]) + 1
                    continue
                document = Document(
                    tenant_id=settings.feishu_tenant_id,
                    knowledge_base_id=knowledge_base.id,
                    name=item.title,
                    source_type="feishu",
                    source_key=item.source_key,
                    source_uri=str(path),
                    source_updated_at=item.updated_at,
                    content_type="text/plain",
                    checksum=checksum,
                    size_bytes=len(item.content.encode()),
                    status="pending",
                    extra_metadata=item.metadata,
                )
                db.add(document)
                await db.flush()
            else:
                document.name = item.title
                document.source_uri = str(path)
                document.source_updated_at = item.updated_at
                document.checksum = checksum
                document.size_bytes = len(item.content.encode())
                document.status = "pending"
                document.error_message = None
                document.extra_metadata = item.metadata

            task_id = str(uuid4())
            job = IngestionJob(
                tenant_id=settings.feishu_tenant_id,
                document_id=document.id,
                task_id=task_id,
                job_type="document_ingestion",
                status="queued",
            )
            db.add(job)
            await db.flush()
            ingestion_dispatches.append(
                ConnectorDispatch(document.id, job.id, task_id, path)
            )
            stats["enqueued"] = int(stats["enqueued"]) + 1

        existing_result = await db.execute(
            select(Document).where(
                Document.knowledge_base_id == knowledge_base.id,
                Document.source_type == "feishu",
                Document.source_key.like(f"{settings.feishu_space_id}:%"),
            )
        )
        for document in existing_result.scalars():
            if document.source_key in remote_keys or document.status == "deleting":
                continue
            document.status = "deleting"
            task_id = str(uuid4())
            job = IngestionJob(
                tenant_id=settings.feishu_tenant_id,
                document_id=document.id,
                task_id=task_id,
                job_type="document_deletion",
                status="queued",
            )
            db.add(job)
            await db.flush()
            deletion_dispatches.append(DeleteDispatch(document.id, job.id, task_id))
            stats["deleted"] = int(stats["deleted"]) + 1
        await db.commit()
    return ingestion_dispatches, deletion_dispatches, stats
