from pathlib import Path

import pytest
from pydantic import ValidationError

import app.core.config as config_module
from app.core.config import Settings


def test_rag_yaml_supplies_versioned_defaults() -> None:
    settings = Settings(_env_file=None)

    assert settings.chat_model == "gpt-5.5"
    assert settings.retrieval_top_k == 40
    assert settings.rerank_top_k == 8
    assert settings.context_max_tokens == 4_000


def test_environment_overrides_rag_yaml(monkeypatch) -> None:
    monkeypatch.setenv("APP_RETRIEVAL_TOP_K", "24")

    assert Settings(_env_file=None).retrieval_top_k == 24


def test_rag_yaml_rejects_unknown_keys(monkeypatch, tmp_path: Path) -> None:
    yaml_file = tmp_path / "rag.yaml"
    source = config_module.RAG_CONFIG_FILE.read_text(encoding="utf-8")
    yaml_file.write_text(
        source.replace("rag:\n", "rag:\n  unknown_option: true\n", 1), encoding="utf-8"
    )
    monkeypatch.setattr(config_module, "RAG_CONFIG_FILE", yaml_file)

    with pytest.raises(ValidationError, match="unknown_option"):
        Settings(_env_file=None)


def test_cors_origins_are_exact_normalized_origins() -> None:
    settings = Settings(
        _env_file=None,
        cors_origins=["http://localhost:3000/", "http://localhost:3000"],
    )
    assert settings.cors_origins == ["http://localhost:3000"]

    for origins in [
        ["*"],
        ["https://rag.example.com/path"],
        ["https://user:secret@rag.example.com"],
    ]:
        with pytest.raises(ValidationError, match="APP_CORS_ORIGINS"):
            Settings(_env_file=None, cors_origins=origins)


def test_production_requires_https_cors_and_oidc_endpoints() -> None:
    with pytest.raises(ValidationError, match="APP_CORS_ORIGINS"):
        Settings(
            _env_file=None,
            env="production",
            auth_mode="oidc",
            cors_origins=["http://rag.example.com"],
            oidc_issuer="https://id.example.com/realm",
            oidc_audience="rag-api",
        )
    with pytest.raises(ValidationError, match="APP_OIDC_JWKS_URL"):
        Settings(
            _env_file=None,
            env="production",
            auth_mode="oidc",
            cors_origins=["https://rag.example.com"],
            oidc_issuer="https://id.example.com/realm",
            oidc_audience="rag-api",
            oidc_jwks_url="http://id.example.com/jwks",
        )


def test_keycloak_directory_requires_service_account_credentials() -> None:
    with pytest.raises(ValidationError, match="APP_ENTERPRISE_DIRECTORY_CLIENT_ID"):
        Settings(
            _env_file=None,
            enterprise_directory_provider="keycloak",
            oidc_issuer="https://id.example.com/realms/company",
        )
    with pytest.raises(ValidationError, match="APP_ENTERPRISE_DIRECTORY_CLIENT_SECRET"):
        Settings(
            _env_file=None,
            enterprise_directory_provider="keycloak",
            enterprise_directory_client_id="directory-reader",
            oidc_issuer="https://id.example.com/realms/company",
        )

    settings = Settings(
        _env_file=None,
        enterprise_directory_provider="keycloak",
        enterprise_directory_client_id="directory-reader",
        enterprise_directory_client_secret="not-logged",
        oidc_issuer="https://id.example.com/realms/company/",
    )
    assert settings.oidc_issuer == "https://id.example.com/realms/company"
    assert "not-logged" not in repr(settings.enterprise_directory_client_secret)


def test_feishu_configuration_masks_secret_and_bounds_wiki_page_size() -> None:
    settings = Settings(
        _env_file=None,
        feishu_app_secret="not-logged",
        feishu_sync_page_size=50,
    )
    assert "not-logged" not in repr(settings.feishu_app_secret)

    with pytest.raises(ValidationError, match="feishu_sync_page_size"):
        Settings(_env_file=None, feishu_sync_page_size=51)
