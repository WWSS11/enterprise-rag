from functools import lru_cache
from pathlib import Path
from typing import Self

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="APP_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "RAG Study Helper Enterprise"
    env: str = "local"
    debug: bool = False
    log_level: str = "INFO"
    timezone: str = "Asia/Shanghai"
    api_v1_prefix: str = "/api/v1"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    postgres_dsn: str = "postgresql+asyncpg://rag:rag_change_me@localhost:5432/rag_study_helper"
    postgres_sync_dsn: str = (
        "postgresql+psycopg://rag:rag_change_me@localhost:5432/rag_study_helper"
    )
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    milvus_uri: str = "http://localhost:19530"
    milvus_token: str = ""
    milvus_db_name: str = "default"
    milvus_collection: str = "rag_chunks_v2"
    milvus_collection_alias: str = "rag_chunks_current"
    milvus_rebuild_retained_collections: int = 2
    embedding_dimension: int = 1024

    chat_base_url: str = "https://api.deepseek.com/v1"
    chat_api_key: str = ""
    chat_model: str = "deepseek-chat"
    chat_temperature: float = 0.2

    embedding_base_url: str = "https://api.siliconflow.cn/v1"
    embedding_api_key: str = ""
    embedding_model: str = "BAAI/bge-large-zh-v1.5"

    rerank_base_url: str = "https://api.siliconflow.cn/v1"
    rerank_api_key: str = ""
    rerank_model: str = "BAAI/bge-reranker-v2-m3"
    rerank_enabled: bool = True

    retrieval_top_k: int = 20
    rerank_top_k: int = 5
    score_threshold: float = 0.55
    upload_dir: Path = Path("data/uploads")
    connector_dir: Path = Path("data/connectors")
    scan_roots: dict[str, Path] = Field(default_factory=lambda: {"default": Path("data/import")})
    max_upload_mb: int = 50
    supported_document_extensions: set[str] = Field(
        default_factory=lambda: {
            ".txt",
            ".md",
            ".csv",
            ".json",
            ".xml",
            ".pdf",
            ".docx",
            ".pptx",
            ".xlsx",
            ".xlsm",
            ".xls",
            ".html",
            ".htm",
        }
    )
    chunk_size: int = Field(default=480, ge=100, le=8_000)
    chunk_overlap: int = Field(default=80, ge=0, le=2_000)
    embedding_batch_size: int = Field(default=16, ge=1, le=256)
    allow_partial_ingestion: bool = False
    chat_rate_limit_per_minute: int = Field(default=30, ge=1)
    chat_rate_limit_per_tenant_per_minute: int = Field(default=300, ge=1)
    chat_daily_limit_per_user: int = Field(default=1_000, ge=1)
    chat_daily_limit_per_tenant: int = Field(default=100_000, ge=1)
    rate_limit_fail_open: bool = False
    session_ttl_seconds: int = 86_400
    conversation_history_messages: int = 20

    identity_header_secret: str = ""
    admin_user_ids: set[str] = Field(default_factory=lambda: {"admin"})

    feishu_enabled: bool = False
    feishu_app_id: str = ""
    feishu_app_secret: str = ""
    feishu_space_id: str = ""
    feishu_tenant_id: str = "default"
    feishu_run_as_user: str = "feishu-sync"
    feishu_knowledge_base_id: str = ""
    feishu_base_url: str = "https://open.feishu.cn/open-apis"
    feishu_sync_page_size: int = 50

    @model_validator(mode="after")
    def validate_runtime_invariants(self) -> Self:
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("APP_CHUNK_OVERLAP must be smaller than APP_CHUNK_SIZE")
        if self.env.lower() in {"prod", "production"} and not self.identity_header_secret:
            raise ValueError("APP_IDENTITY_HEADER_SECRET is required in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
