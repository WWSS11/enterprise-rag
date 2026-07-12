import pytest
from langgraph.graph import END, START, StateGraph

from app.rag.graph import (
    generate,
    get_rag_graph,
    needs_query_rewrite,
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

    citations = select_answer_citations(
        "[来源:a.md#chunk-2] 再次引用 [来源:a.md#chunk-2]", [candidate]
    )

    assert citations == [candidate]
