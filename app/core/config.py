from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

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
    milvus_collection: str = "rag_chunks_v3"
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
    rerank_timeout_seconds: float = Field(default=30.0, gt=0.0, le=120.0)
    rerank_max_attempts: int = Field(default=2, ge=1, le=5)
    rerank_retry_base_seconds: float = Field(default=0.5, ge=0.0, le=10.0)

    retrieval_top_k: int = 40
    rerank_top_k: int = 8
    score_threshold: float = 0.0
    hybrid_rrf_k: int = Field(default=60, ge=1, le=1_000)
    atomic_chunk_max_tokens: int = Field(default=160, ge=32, le=512)
    retrieval_chunk_target_tokens: int = Field(default=320, ge=64, le=1_024)
    retrieval_chunk_overlap_tokens: int = Field(default=48, ge=0, le=256)
    parent_chunk_max_tokens: int = Field(default=960, ge=128, le=4_096)
    embedding_context_max_tokens: int = Field(default=400, ge=64, le=512)
    semantic_chunking_enabled: bool = True
    semantic_break_threshold: float = Field(default=0.58, ge=0.0, le=1.0)
    semantic_break_percentile: int = Field(default=15, ge=1, le=50)
    context_max_tokens: int = Field(default=4_000, ge=256, le=32_000)
    context_max_parents: int = Field(default=5, ge=1, le=20)
    context_neighbor_window: int = Field(default=1, ge=0, le=3)
    context_document_diversity_enabled: bool = True
    context_document_diversity_min_score_ratio: float = Field(default=0.1, ge=0.0, le=1.0)
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

    auth_mode: Literal["trusted_header", "oidc"] = "trusted_header"
    identity_header_secret: str = ""
    admin_user_ids: set[str] = Field(default_factory=lambda: {"admin"})
    oidc_issuer: str = ""
    oidc_audience: str = ""
    oidc_jwks_url: str = ""
    oidc_algorithms: set[str] = Field(default_factory=lambda: {"RS256"})
    oidc_token_types: set[str] = Field(
        default_factory=lambda: {"JWT", "at+jwt", "application/at+jwt"}
    )
    oidc_tenant_claim: str = "tenant_id"
    oidc_roles_claim: str = "realm_access.roles"
    oidc_groups_claim: str = "groups"
    oidc_admin_role: str = "rag-admin"
    oidc_jwks_cache_seconds: int = Field(default=300, ge=30, le=86_400)
    oidc_http_timeout_seconds: float = Field(default=10.0, gt=0.0, le=60.0)
    oidc_clock_skew_seconds: int = Field(default=30, ge=0, le=300)
    oidc_max_token_length: int = Field(default=16_384, ge=1_024, le=131_072)

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
        if self.retrieval_chunk_overlap_tokens >= self.retrieval_chunk_target_tokens:
            raise ValueError(
                "APP_RETRIEVAL_CHUNK_OVERLAP_TOKENS must be smaller than "
                "APP_RETRIEVAL_CHUNK_TARGET_TOKENS"
            )
        if self.retrieval_chunk_target_tokens > self.parent_chunk_max_tokens:
            raise ValueError(
                "APP_RETRIEVAL_CHUNK_TARGET_TOKENS must not exceed APP_PARENT_CHUNK_MAX_TOKENS"
            )
        production = self.env.lower() in {"prod", "production"}
        if self.auth_mode == "trusted_header" and production and not self.identity_header_secret:
            raise ValueError(
                "APP_IDENTITY_HEADER_SECRET is required for trusted_header mode in production"
            )
        if self.auth_mode == "oidc":
            if not self.oidc_issuer:
                raise ValueError("APP_OIDC_ISSUER is required for oidc mode")
            if not self.oidc_audience:
                raise ValueError("APP_OIDC_AUDIENCE is required for oidc mode")
            if not self.oidc_algorithms:
                raise ValueError("APP_OIDC_ALGORITHMS must not be empty")
            if "none" in {item.lower() for item in self.oidc_algorithms}:
                raise ValueError("APP_OIDC_ALGORITHMS must not allow alg=none")
            if production and not self.oidc_issuer.startswith("https://"):
                raise ValueError("APP_OIDC_ISSUER must use HTTPS in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
