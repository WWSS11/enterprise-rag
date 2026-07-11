from app.core.config import get_settings
from app.services.model_provider import get_embedding_model


def test_openai_compatible_embedding_sends_raw_strings(monkeypatch) -> None:
    monkeypatch.setenv("APP_EMBEDDING_API_KEY", "test-key")
    get_settings.cache_clear()
    get_embedding_model.cache_clear()
    try:
        model = get_embedding_model()
        assert model.check_embedding_ctx_length is False
    finally:
        get_embedding_model.cache_clear()
        get_settings.cache_clear()
