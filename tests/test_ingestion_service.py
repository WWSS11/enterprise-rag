from app.core.config import get_settings
from app.services.document_parser import ParsedSection
from app.services.ingestion_service import build_chunk_drafts


def test_default_chunks_leave_embedding_context_margin() -> None:
    settings = get_settings()
    drafts = build_chunk_drafts(
        "architecture.md",
        [ParsedSection(text="企业知识库架构设计。" * 200)],
    )

    assert settings.chunk_size == 480
    assert settings.chunk_overlap == 80
    assert drafts
    assert all(len(draft.content) <= settings.chunk_size + 40 for draft in drafts)
