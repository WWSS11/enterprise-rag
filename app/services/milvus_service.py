import asyncio
from datetime import UTC, datetime
from typing import Any

from pymilvus import (
    AnnSearchRequest,
    DataType,
    Function,
    FunctionType,
    MilvusClient,
    RRFRanker,
)
from pymilvus.exceptions import MilvusException

from app.core.config import get_settings


class MilvusService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._client: MilvusClient | None = None

    @property
    def client(self) -> MilvusClient:
        if self._client is None:
            kwargs: dict[str, Any] = {
                "uri": self.settings.milvus_uri,
                "db_name": self.settings.milvus_db_name,
            }
            if self.settings.milvus_token:
                kwargs["token"] = self.settings.milvus_token
            self._client = MilvusClient(**kwargs)
        return self._client

    async def ping(self) -> bool:
        return await asyncio.to_thread(self.client.list_collections) is not None

    def _list_aliases_sync(self) -> list[str]:
        aliases = self.client.list_aliases()
        if isinstance(aliases, dict):
            return [str(item) for item in aliases.get("aliases", [])]
        return [str(item) for item in aliases]

    def _create_collection_sync(self, collection_name: str) -> None:
        schema = MilvusClient.create_schema(auto_id=False, enable_dynamic_field=False)
        schema.add_field(field_name="id", datatype=DataType.VARCHAR, is_primary=True, max_length=64)
        schema.add_field(
            field_name="dense_vector",
            datatype=DataType.FLOAT_VECTOR,
            dim=self.settings.embedding_dimension,
        )
        schema.add_field(field_name="sparse_vector", datatype=DataType.SPARSE_FLOAT_VECTOR)
        schema.add_field(field_name="tenant_id", datatype=DataType.VARCHAR, max_length=64)
        schema.add_field(field_name="knowledge_base_id", datatype=DataType.VARCHAR, max_length=64)
        schema.add_field(field_name="document_id", datatype=DataType.VARCHAR, max_length=64)
        schema.add_field(field_name="document_name", datatype=DataType.VARCHAR, max_length=512)
        schema.add_field(field_name="chunk_id", datatype=DataType.VARCHAR, max_length=64)
        schema.add_field(field_name="chunk_index", datatype=DataType.INT64)
        schema.add_field(field_name="parent_section_id", datatype=DataType.VARCHAR, max_length=64)
        schema.add_field(field_name="heading_path", datatype=DataType.VARCHAR, max_length=4096)
        schema.add_field(field_name="atomic_start_index", datatype=DataType.INT64)
        schema.add_field(field_name="atomic_end_index", datatype=DataType.INT64)
        schema.add_field(field_name="index_version", datatype=DataType.VARCHAR, max_length=64)
        schema.add_field(field_name="content", datatype=DataType.VARCHAR, max_length=65535)
        schema.add_field(
            field_name="embedding_content",
            datatype=DataType.VARCHAR,
            max_length=65535,
            enable_analyzer=True,
            enable_match=True,
            analyzer_params={"tokenizer": "jieba"},
        )
        schema.add_function(
            Function(
                name="embedding_content_bm25",
                function_type=FunctionType.BM25,
                input_field_names=["embedding_content"],
                output_field_names=["sparse_vector"],
            )
        )

        index_params = self.client.prepare_index_params()
        index_params.add_index(
            field_name="dense_vector",
            index_name="dense_vector_hnsw",
            index_type="HNSW",
            metric_type="COSINE",
            params={"M": 32, "efConstruction": 200},
        )
        index_params.add_index(
            field_name="sparse_vector",
            index_name="sparse_vector_bm25",
            index_type="SPARSE_INVERTED_INDEX",
            metric_type="BM25",
            params={"inverted_index_algo": "DAAT_MAXSCORE"},
        )
        index_params.add_index(field_name="tenant_id", index_type="INVERTED")
        index_params.add_index(field_name="knowledge_base_id", index_type="INVERTED")
        index_params.add_index(field_name="document_id", index_type="INVERTED")
        index_params.add_index(field_name="index_version", index_type="INVERTED")

        self.client.create_collection(
            collection_name=collection_name,
            schema=schema,
            index_params=index_params,
            consistency_level="Bounded",
        )

    async def create_collection(self, collection_name: str) -> None:
        if await asyncio.to_thread(self.client.has_collection, collection_name):
            return
        await asyncio.to_thread(self._create_collection_sync, collection_name)

    async def ensure_collection(self) -> str:
        alias = self.settings.milvus_collection_alias
        aliases = await asyncio.to_thread(self._list_aliases_sync)
        if alias in aliases:
            return alias

        collection = self.settings.milvus_collection
        await self.create_collection(collection)
        try:
            await asyncio.to_thread(self.client.create_alias, collection, alias)
        except MilvusException:
            aliases = await asyncio.to_thread(self._list_aliases_sync)
            if alias not in aliases:
                raise
        return alias

    async def insert(
        self, rows: list[dict[str, Any]], collection_name: str | None = None
    ) -> None:
        if not rows:
            return
        target = collection_name or await self.ensure_collection()
        await asyncio.to_thread(
            self.client.insert,
            collection_name=target,
            data=rows,
        )

    async def hybrid_search(
        self,
        vector: list[float],
        query: str,
        tenant_id: str,
        knowledge_base_id: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        collection = await self.ensure_collection()
        safe_tenant = tenant_id.replace('"', '\\"')
        safe_kb = knowledge_base_id.replace('"', '\\"')
        expression = f'tenant_id == "{safe_tenant}" and knowledge_base_id == "{safe_kb}"'
        dense_request = AnnSearchRequest(
            data=[vector],
            anns_field="dense_vector",
            param={"metric_type": "COSINE", "params": {"ef": 128}},
            limit=limit,
            expr=expression,
        )
        sparse_request = AnnSearchRequest(
            data=[query],
            anns_field="sparse_vector",
            param={"metric_type": "BM25", "params": {}},
            limit=limit,
            expr=expression,
        )
        result = await asyncio.to_thread(
            self.client.hybrid_search,
            collection_name=collection,
            reqs=[dense_request, sparse_request],
            ranker=RRFRanker(k=self.settings.hybrid_rrf_k),
            limit=limit,
            output_fields=[
                "document_id",
                "document_name",
                "chunk_id",
                "chunk_index",
                "parent_section_id",
                "heading_path",
                "atomic_start_index",
                "atomic_end_index",
                "index_version",
                "content",
                "embedding_content",
            ],
        )
        return list(result[0]) if result else []

    async def search(
        self,
        vector: list[float],
        tenant_id: str,
        knowledge_base_id: str,
        limit: int,
        query: str = "",
    ) -> list[dict[str, Any]]:
        """Compatibility entrypoint; all new searches use dense + BM25 hybrid recall."""

        return await self.hybrid_search(
            vector, query, tenant_id, knowledge_base_id, limit
        )

    async def delete_document(
        self, document_id: str, keep_index_version: str | None = None
    ) -> None:
        collection = await self.ensure_collection()
        safe_id = document_id.replace('"', '\\"')
        expression = f'document_id == "{safe_id}"'
        if keep_index_version:
            safe_version = keep_index_version.replace('"', '\\"')
            expression += f' and index_version != "{safe_version}"'
        await asyncio.to_thread(
            self.client.delete,
            collection_name=collection,
            filter=expression,
        )

    async def delete_document_version(self, document_id: str, index_version: str) -> None:
        collection = await self.ensure_collection()
        safe_id = document_id.replace('"', '\\"')
        safe_version = index_version.replace('"', '\\"')
        await asyncio.to_thread(
            self.client.delete,
            collection_name=collection,
            filter=(
                f'document_id == "{safe_id}" and index_version == "{safe_version}"'
            ),
        )

    async def drop_collection(self, collection_name: str) -> None:
        if await asyncio.to_thread(self.client.has_collection, collection_name):
            await asyncio.to_thread(self.client.drop_collection, collection_name)

    async def new_rebuild_collection(self) -> str:
        timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S%f")
        name = f"{self.settings.milvus_collection}_{timestamp}"
        await self.create_collection(name)
        return name

    async def switch_alias(self, collection_name: str) -> None:
        alias = self.settings.milvus_collection_alias
        aliases = await asyncio.to_thread(self._list_aliases_sync)
        if alias in aliases:
            await asyncio.to_thread(self.client.alter_alias, collection_name, alias)
        else:
            await asyncio.to_thread(self.client.create_alias, collection_name, alias)

    async def cleanup_old_collections(self, active_collection: str) -> list[str]:
        prefix = f"{self.settings.milvus_collection}_"
        collections = await asyncio.to_thread(self.client.list_collections)
        managed = sorted(
            (
                name
                for name in collections
                if (name == self.settings.milvus_collection or name.startswith(prefix))
                and name != active_collection
            ),
            reverse=True,
        )
        keep = self.settings.milvus_rebuild_retained_collections
        dropped: list[str] = []
        for collection in managed[keep:]:
            await asyncio.to_thread(self.client.drop_collection, collection)
            dropped.append(collection)
        return dropped


milvus_service = MilvusService()
