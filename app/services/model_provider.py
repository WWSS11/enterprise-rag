from functools import lru_cache

from langchain_openai import ChatOpenAI, OpenAIEmbeddings

from app.core.config import get_settings


def validate_rag_configuration() -> None:
    settings = get_settings()
    missing: list[str] = []
    if not settings.chat_api_key:
        missing.append("APP_CHAT_API_KEY")
    if not settings.embedding_api_key:
        missing.append("APP_EMBEDDING_API_KEY")
    if missing:
        raise RuntimeError(f"missing RAG configuration: {', '.join(missing)}")


@lru_cache
def get_chat_model() -> ChatOpenAI:
    settings = get_settings()
    if not settings.chat_api_key:
        raise RuntimeError("APP_CHAT_API_KEY is required before invoking the RAG graph")
    return ChatOpenAI(
        api_key=settings.chat_api_key,
        base_url=settings.chat_base_url,
        model=settings.chat_model,
        temperature=settings.chat_temperature,
        streaming=True,
        timeout=120,
        max_retries=2,
    )


@lru_cache
def get_embedding_model() -> OpenAIEmbeddings:
    settings = get_settings()
    if not settings.embedding_api_key:
        raise RuntimeError("APP_EMBEDDING_API_KEY is required before indexing or retrieving")
    return OpenAIEmbeddings(
        openai_api_key=settings.embedding_api_key,
        openai_api_base=settings.embedding_base_url,
        model=settings.embedding_model,
        check_embedding_ctx_length=False,
        max_retries=2,
        request_timeout=120,
    )
