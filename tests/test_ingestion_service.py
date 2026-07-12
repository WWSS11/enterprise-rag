from app.core.config import get_settings
from app.services.chunking_service import build_atomic_drafts, build_chunk_hierarchy
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


def test_hierarchy_builds_atomic_retrieval_and_parent_layers() -> None:
    sections = [
        ParsedSection(
            text="第一条规则。第二条规则。第三条规则。",
            title="权限规则",
            heading_path=("安全", "权限规则"),
            metadata={"page": 3},
        )
    ]

    atomics = build_atomic_drafts(sections)
    hierarchy = build_chunk_hierarchy(
        "security.md", sections, atomics=atomics, semantic_breaks={2}
    )

    assert len(hierarchy.atomics) == 3
    assert len(hierarchy.parents) == 2
    assert all(
        hierarchy.parents[item.parent_section_index].atomic_start_index
        <= item.atomic_start_index
        <= item.atomic_end_index
        <= hierarchy.parents[item.parent_section_index].atomic_end_index
        for item in hierarchy.retrievals
    )
    assert "文档：security.md" in hierarchy.retrievals[0].embedding_content
    assert "章节：安全 > 权限规则" in hierarchy.retrievals[0].embedding_content
    assert "页码：3" in hierarchy.retrievals[0].embedding_content
