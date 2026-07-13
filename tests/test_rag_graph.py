import pytest
from langgraph.graph import END, START, StateGraph

from app.rag.graph import (
    CITATION_POLICY_VERSION,
    RAG_SYSTEM_PROMPT,
    generate,
    get_rag_graph,
    needs_query_rewrite,
    order_context_candidates,
    resolve_answer_citations,
    select_answer_citations,
)
from app.rag.state import RagState


def test_graph_contains_explicit_rag_nodes() -> None:
    nodes = set(get_rag_graph().get_graph().nodes)
    assert {
        "rewrite_query",
        "retrieve",
        "rerank",
        "expand_context",
        "generate",
    }.issubset(nodes)


def test_query_rewrite_only_for_context_dependent_questions() -> None:
    history = [{"role": "user", "content": "介绍一下 Milvus"}]
    assert needs_query_rewrite("它支持集群吗？", history)
    assert needs_query_rewrite("为什么？", history)
    assert not needs_query_rewrite("Milvus 的一致性级别有哪些？", history)
    assert not needs_query_rewrite("它支持集群吗？", [])


@pytest.mark.asyncio
async def test_generate_emits_custom_stream_without_sources() -> None:
    graph = StateGraph(RagState)
    graph.add_node("generate", generate)
    graph.add_edge(START, "generate")
    graph.add_edge("generate", END)
    compiled = graph.compile()

    events = [
        item
        async for item in compiled.astream(
            {
                "question": "没有命中的问题",
                "tenant_id": "default",
                "knowledge_base_id": "00000000-0000-0000-0000-000000000000",
                "user_id": "tester",
                "reranked": [],
            },
            stream_mode=["custom", "updates"],
        )
    ]

    custom = [payload for mode, payload in events if mode == "custom"]
    assert custom
    assert custom[0]["type"] == "token"
    assert "未在当前有权访问的知识库" in custom[0]["token"]


def test_select_answer_citations_only_returns_explicit_markers() -> None:
    candidates = [
        {
            "document_id": "document-a",
            "document_name": "a.md",
            "chunk_id": "chunk-a",
            "chunk_index": 2,
        },
        {
            "document_id": "document-b",
            "document_name": "b.md",
            "chunk_id": "chunk-b",
            "chunk_index": 5,
        },
    ]

    citations = select_answer_citations(
        "结论来自第一份资料。[来源:a.md#chunk-2]", candidates
    )

    assert citations == [candidates[0]]


def test_select_answer_citations_deduplicates_repeated_markers() -> None:
    candidate = {
        "document_id": "document-a",
        "document_name": "a.md",
        "chunk_id": "chunk-a",
        "chunk_index": 2,
    }

    citations, diagnostics = resolve_answer_citations(
        "[来源:a.md#chunk-2] 再次引用 [来源:a.md#chunk-2]", [candidate]
    )

    assert citations == [candidate]
    assert diagnostics["duplicate_markers"] == 1


def test_ambiguous_citation_without_chunk_is_not_guessed() -> None:
    candidates = [
        {
            "document_id": "document-a",
            "document_name": "a.md",
            "chunk_id": "chunk-a-1",
            "chunk_index": 1,
        },
        {
            "document_id": "document-a",
            "document_name": "a.md",
            "chunk_id": "chunk-a-2",
            "chunk_index": 2,
        },
    ]

    citations, diagnostics = resolve_answer_citations("结论。[来源:a.md]", candidates)

    assert citations == []
    assert diagnostics["ambiguous_markers"] == 1
    assert diagnostics["policy_version"] == CITATION_POLICY_VERSION


def test_unique_citation_without_chunk_can_be_resolved() -> None:
    candidate = {
        "document_id": "document-a",
        "document_name": "a.md",
        "chunk_id": "chunk-a",
        "chunk_index": 2,
    }

    citations, diagnostics = resolve_answer_citations("结论。[来源:a.md]", [candidate])

    assert citations == [candidate]
    assert diagnostics["valid_markers"] == 1
    assert diagnostics["imprecise_markers"] == 1


def test_citation_policy_requires_minimal_precise_sources() -> None:
    assert "最少来源" in RAG_SYSTEM_PROMPT
    assert "精确的 chunk 编号" in RAG_SYSTEM_PROMPT
    assert "不要为背景代码" in RAG_SYSTEM_PROMPT


def test_context_candidate_diversity_preserves_first_document_rank() -> None:
    candidates = [
        {"document_id": "a", "chunk_id": "a-1"},
        {"document_id": "a", "chunk_id": "a-2"},
        {"document_id": "b", "chunk_id": "b-1"},
        {"document_id": "c", "chunk_id": "c-1"},
        {"document_id": "b", "chunk_id": "b-2"},
    ]

    ordered = order_context_candidates(candidates, diversify_documents=True)

    assert [item["chunk_id"] for item in ordered] == [
        "a-1",
        "b-1",
        "c-1",
        "a-2",
        "b-2",
    ]


def test_context_candidate_diversity_can_be_disabled() -> None:
    candidates = [
        {"document_id": "a", "chunk_id": "a-1"},
        {"document_id": "a", "chunk_id": "a-2"},
        {"document_id": "b", "chunk_id": "b-1"},
    ]

    assert order_context_candidates(
        candidates, diversify_documents=False
    ) == candidates


def test_context_candidate_diversity_does_not_promote_low_score_noise() -> None:
    candidates = [
        {"document_id": "a", "chunk_id": "a-1", "rerank_score": 0.9},
        {"document_id": "a", "chunk_id": "a-2", "rerank_score": 0.6},
        {"document_id": "b", "chunk_id": "b-1", "rerank_score": 0.01},
        {"document_id": "a", "chunk_id": "a-3", "rerank_score": 0.005},
    ]

    ordered = order_context_candidates(
        candidates,
        diversify_documents=True,
        min_score_ratio=0.1,
    )

    assert [item["chunk_id"] for item in ordered] == ["a-1", "a-2", "b-1", "a-3"]


def test_context_candidate_diversity_promotes_relevant_cross_document_evidence() -> None:
    candidates = [
        {"document_id": "api", "chunk_id": "api-1", "rerank_score": 0.137},
        {"document_id": "ingestion", "chunk_id": "ingest-1", "rerank_score": 0.058},
        {"document_id": "ingestion", "chunk_id": "ingest-2", "rerank_score": 0.057},
        {"document_id": "api", "chunk_id": "api-2", "rerank_score": 0.057},
        {"document_id": "graph", "chunk_id": "graph-1", "rerank_score": 0.037},
    ]

    ordered = order_context_candidates(
        candidates,
        diversify_documents=True,
        min_score_ratio=0.1,
    )

    assert [item["chunk_id"] for item in ordered[:3]] == [
        "api-1",
        "ingest-1",
        "graph-1",
    ]
