from functools import lru_cache
from pathlib import Path
from typing import Literal, Self
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
    YamlConfigSettingsSource,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAG_CONFIG_FILE = PROJECT_ROOT / "config" / "rag.yaml"
OIDC_ASYMMETRIC_ALGORITHMS = frozenset(
    {
        "RS256",
        "RS384",
        "RS512",
        "PS256",
        "PS384",
        "PS512",
        "ES256",
        "ES384",
        "ES512",
        "EdDSA",
    }
)


def _validate_http_url(value: str, *, setting: str, origin_only: bool = False) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError(f"{setting} must be an absolute HTTP(S) URL")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError(f"{setting} must not contain user information")
    if parsed.fragment:
        raise ValueError(f"{setting} must not contain a fragment")
    if origin_only and (parsed.path not in {"", "/"} or parsed.query):
        raise ValueError(f"{setting} must contain origins only, without paths or queries")
    return value.rstrip("/")


class StrictConfigModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ChatModelConfig(StrictConfigModel):
    name: str
    temperature: float


class EmbeddingModelConfig(StrictConfigModel):
    name: str
    dimension: int


class RerankModelConfig(StrictConfigModel):
    name: str
    enabled: bool
    top_k: int
    timeout_seconds: float
    max_attempts: int
    retry_base_seconds: float


class ModelConfig(StrictConfigModel):
    chat: ChatModelConfig
    embedding: EmbeddingModelConfig
    rerank: RerankModelConfig


class ChunkingConfig(StrictConfigModel):
    chunk_size: int
    chunk_overlap: int
    atomic_max_tokens: int
    retrieval_target_tokens: int
    retrieval_overlap_tokens: int
    parent_max_tokens: int
    embedding_context_max_tokens: int
    semantic_enabled: bool
    semantic_break_threshold: float
    semantic_break_percentile: int


class RetrievalConfig(StrictConfigModel):
    top_k: int
    score_threshold: float
    hybrid_rrf_k: int


class ContextConfig(StrictConfigModel):
    max_tokens: int
    max_parents: int
    neighbor_window: int
    document_diversity_enabled: bool
    document_diversity_min_score_ratio: float


class IngestionConfig(StrictConfigModel):
    embedding_batch_size: int
    allow_partial: bool


class RagYamlConfig(StrictConfigModel):
    models: ModelConfig
    chunking: ChunkingConfig
    retrieval: RetrievalConfig
    context: ContextConfig
    ingestion: IngestionConfig

    def as_settings(self) -> dict[str, object]:
        return {
            "chat_model": self.models.chat.name,
            "chat_temperature": self.models.chat.temperature,
            "embedding_model": self.models.embedding.name,
            "embedding_dimension": self.models.embedding.dimension,
            "rerank_model": self.models.rerank.name,
            "rerank_enabled": self.models.rerank.enabled,
            "rerank_top_k": self.models.rerank.top_k,
            "rerank_timeout_seconds": self.models.rerank.timeout_seconds,
            "rerank_max_attempts": self.models.rerank.max_attempts,
            "rerank_retry_base_seconds": self.models.rerank.retry_base_seconds,
            "chunk_size": self.chunking.chunk_size,
            "chunk_overlap": self.chunking.chunk_overlap,
            "atomic_chunk_max_tokens": self.chunking.atomic_max_tokens,
            "retrieval_chunk_target_tokens": self.chunking.retrieval_target_tokens,
            "retrieval_chunk_overlap_tokens": self.chunking.retrieval_overlap_tokens,
            "parent_chunk_max_tokens": self.chunking.parent_max_tokens,
            "embedding_context_max_tokens": self.chunking.embedding_context_max_tokens,
            "semantic_chunking_enabled": self.chunking.semantic_enabled,
            "semantic_break_threshold": self.chunking.semantic_break_threshold,
            "semantic_break_percentile": self.chunking.semantic_break_percentile,
            "retrieval_top_k": self.retrieval.top_k,
            "score_threshold": self.retrieval.score_threshold,
            "hybrid_rrf_k": self.retrieval.hybrid_rrf_k,
            "context_max_tokens": self.context.max_tokens,
            "context_max_parents": self.context.max_parents,
            "context_neighbor_window": self.context.neighbor_window,
            "context_document_diversity_enabled": self.context.document_diversity_enabled,
            "context_document_diversity_min_score_ratio": (
                self.context.document_diversity_min_score_ratio
            ),
            "embedding_batch_size": self.ingestion.embedding_batch_size,
            "allow_partial_ingestion": self.ingestion.allow_partial,
        }


class RagYamlSettingsSource(YamlConfigSettingsSource):
    def __call__(self) -> dict[str, object]:
        values = super().__call__()
        if not values:
            return {}
        return RagYamlConfig.model_validate(values).as_settings()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="APP_",
        env_file=".env",
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        case_sensitive=False,
        extra="ignore",
    )

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        del cls, file_secret_settings
        return (
            init_settings,
            env_settings,
            dotenv_settings,
            RagYamlSettingsSource(
                settings_cls,
                yaml_file=RAG_CONFIG_FILE,
                yaml_file_encoding="utf-8",
                yaml_config_section="rag",
            ),
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

    enterprise_directory_provider: Literal["disabled", "keycloak"] = "disabled"
    enterprise_directory_tenant_id: str = Field(
        default="default",
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$",
    )
    enterprise_directory_client_id: str = Field(default="", max_length=255)
    enterprise_directory_client_secret: SecretStr = Field(
        default_factory=lambda: SecretStr("")
    )
    enterprise_directory_group_principal: Literal["name", "path"] = "name"
    enterprise_directory_http_timeout_seconds: float = Field(
        default=5.0, gt=0.0, le=30.0
    )

    feishu_enabled: bool = False
    feishu_app_id: str = Field(default="", max_length=255)
    feishu_app_secret: SecretStr = Field(default_factory=lambda: SecretStr(""))
    feishu_space_id: str = Field(default="", max_length=255)
    feishu_tenant_id: str = Field(
        default="default",
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$",
    )
    feishu_run_as_user: str = Field(
        default="feishu-sync",
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._@-]*$",
    )
    feishu_knowledge_base_id: str = ""
    feishu_base_url: str = "https://open.feishu.cn/open-apis"
    feishu_sync_page_size: int = Field(default=50, ge=1, le=50)

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
        normalized_origins: list[str] = []
        for origin in self.cors_origins:
            if origin == "*":
                raise ValueError("APP_CORS_ORIGINS must not contain wildcard origins")
            normalized = _validate_http_url(
                origin,
                setting="APP_CORS_ORIGINS",
                origin_only=True,
            )
            if production and not normalized.startswith("https://"):
                raise ValueError("APP_CORS_ORIGINS must use HTTPS in production")
            if normalized not in normalized_origins:
                normalized_origins.append(normalized)
        if not normalized_origins:
            raise ValueError("APP_CORS_ORIGINS must contain at least one origin")
        self.cors_origins = normalized_origins
        if self.auth_mode == "trusted_header" and production and not self.identity_header_secret:
            raise ValueError(
                "APP_IDENTITY_HEADER_SECRET is required for trusted_header mode in production"
            )
        oidc_required = (
            self.auth_mode == "oidc"
            or self.enterprise_directory_provider == "keycloak"
        )
        if oidc_required:
            if not self.oidc_issuer:
                raise ValueError(
                    "APP_OIDC_ISSUER is required for oidc mode or Keycloak directory search"
                )
            if self.auth_mode == "oidc" and not self.oidc_audience:
                raise ValueError("APP_OIDC_AUDIENCE is required for oidc mode")
            if self.auth_mode == "oidc" and not self.oidc_algorithms:
                raise ValueError("APP_OIDC_ALGORITHMS must not be empty")
            unsupported = (
                self.oidc_algorithms - OIDC_ASYMMETRIC_ALGORITHMS
                if self.auth_mode == "oidc"
                else set()
            )
            if unsupported:
                raise ValueError(
                    "APP_OIDC_ALGORITHMS must contain only asymmetric signing algorithms"
                )
            self.oidc_issuer = _validate_http_url(
                self.oidc_issuer,
                setting="APP_OIDC_ISSUER",
            )
            if self.oidc_jwks_url:
                self.oidc_jwks_url = _validate_http_url(
                    self.oidc_jwks_url,
                    setting="APP_OIDC_JWKS_URL",
                )
            if production and not self.oidc_issuer.startswith("https://"):
                raise ValueError("APP_OIDC_ISSUER must use HTTPS in production")
            if production and self.oidc_jwks_url and not self.oidc_jwks_url.startswith(
                "https://"
            ):
                raise ValueError("APP_OIDC_JWKS_URL must use HTTPS in production")
        if self.enterprise_directory_provider == "keycloak":
            if not self.enterprise_directory_client_id:
                raise ValueError(
                    "APP_ENTERPRISE_DIRECTORY_CLIENT_ID is required for Keycloak directory search"
                )
            if not self.enterprise_directory_client_secret.get_secret_value():
                raise ValueError(
                    "APP_ENTERPRISE_DIRECTORY_CLIENT_SECRET is required for "
                    "Keycloak directory search"
                )
        self.feishu_base_url = _validate_http_url(
            self.feishu_base_url,
            setting="APP_FEISHU_BASE_URL",
        )
        if production and self.feishu_enabled and not self.feishu_base_url.startswith(
            "https://"
        ):
            raise ValueError("APP_FEISHU_BASE_URL must use HTTPS in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
