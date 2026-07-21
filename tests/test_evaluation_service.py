from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.evaluations import _mutable_case
from app.db.models import EvaluationCase, EvaluationDataset
from app.main import app
from app.schemas.evaluation import EvaluationCaseCreate, EvaluationCasePage
from app.services.evaluation_service import (
    build_citation_evidence,
    calculate_case_metrics,
    ranking_metrics,
    summarize_results,
)


def test_ranking_metrics_deduplicate_chunks_by_document() -> None:
    first_document = str(uuid4())
    second_document = str(uuid4())
    items = [
        {"document_id": first_document, "chunk_id": "1"},
        {"document_id": first_document, "chunk_id": "2"},
        {"document_id": second_document, "chunk_id": "3"},
    ]

    metrics = ranking_metrics(items, [second_document])

    assert metrics == {"recall": 1.0, "mrr": 0.5}


def test_case_metrics_cover_retrieval_citations_key_points_and_refusal() -> None:
    expected_document = str(uuid4())
    metrics = calculate_case_metrics(
        answer="Milvus 支持分布式部署，并且可以水平扩展。",
        retrieved=[{"document_id": expected_document}],
        reranked=[{"document_id": expected_document}],
        citations=[{"document_id": expected_document}],
        expected_document_ids=[expected_document],
        required_key_points=["分布式部署", "水平扩展"],
        should_refuse=False,
    )

    assert metrics["retrieval_recall_at_k"] == 1.0
    assert metrics["rerank_mrr"] == 1.0
    assert metrics["citation_precision"] == 1.0
    assert metrics["citation_recall"] == 1.0
    assert metrics["key_point_coverage"] == 1.0
    assert metrics["refusal_correct"] is True


def test_refusal_case_is_measured_without_expected_documents() -> None:
    metrics = calculate_case_metrics(
        answer="未在当前有权访问的知识库中检索到足够相关的资料。",
        retrieved=[],
        reranked=[],
        citations=[],
        expected_document_ids=[],
        required_key_points=[],
        should_refuse=True,
    )

    assert metrics["retrieval_recall_at_k"] is None
    assert metrics["citation_precision"] is None
    assert metrics["actual_refusal"] is True
    assert metrics["refusal_correct"] is True


def test_refusal_can_cite_material_that_confirms_information_is_missing() -> None:
    metrics = calculate_case_metrics(
        answer="资料中没有给出管理员密码，因此我不知道具体值。",
        retrieved=[{"document_id": "context-document"}],
        reranked=[{"document_id": "context-document"}],
        citations=[{"document_id": "context-document"}],
        expected_document_ids=[],
        required_key_points=[],
        should_refuse=True,
    )

    assert metrics["actual_refusal"] is True
    assert metrics["refusal_correct"] is True


def test_later_missing_detail_caveat_is_not_a_full_refusal() -> None:
    metrics = calculate_case_metrics(
        answer=(
            "系统会先批量处理，失败后逐条重试，并保留旧索引。\n\n"
            "资料未提供部分入库时的界面展示细节。"
        ),
        retrieved=[{"document_id": "expected"}],
        reranked=[{"document_id": "expected"}],
        citations=[{"document_id": "expected"}],
        expected_document_ids=["expected"],
        required_key_points=["逐条重试", "保留旧索引"],
        should_refuse=False,
    )

    assert metrics["actual_refusal"] is False
    assert metrics["refusal_correct"] is True


def test_later_caveat_in_same_paragraph_is_not_a_full_refusal() -> None:
    metrics = calculate_case_metrics(
        answer="系统会保留旧索引并切换新版本。资料未提供界面展示细节。",
        retrieved=[{"document_id": "expected"}],
        reranked=[{"document_id": "expected"}],
        citations=[{"document_id": "expected"}],
        expected_document_ids=["expected"],
        required_key_points=["保留旧索引", "切换新版本"],
        should_refuse=False,
    )

    assert metrics["actual_refusal"] is False
    assert metrics["refusal_correct"] is True


def test_explaining_refusal_markers_is_not_itself_a_refusal() -> None:
    metrics = calculate_case_metrics(
        answer=(
            "拒答检测只检查答案开头，是为了避免把后文误判为拒答。"
            "例如系统会识别“无法回答”和`不知道`等标记。"
        ),
        retrieved=[{"document_id": "expected"}],
        reranked=[{"document_id": "expected"}],
        citations=[{"document_id": "expected"}],
        expected_document_ids=["expected"],
        required_key_points=["答案开头", "拒答"],
        should_refuse=False,
    )

    assert metrics["actual_refusal"] is False
    assert metrics["refusal_correct"] is True


def test_explicit_refusal_in_first_sentence_is_still_detected() -> None:
    metrics = calculate_case_metrics(
        answer="根据当前资料，我无法回答客户订单数量。后续可以导入订单数据。",
        retrieved=[{"document_id": "context"}],
        reranked=[{"document_id": "context"}],
        citations=[{"document_id": "context"}],
        expected_document_ids=[],
        required_key_points=[],
        should_refuse=True,
    )

    assert metrics["actual_refusal"] is True
    assert metrics["refusal_correct"] is True


def test_cannot_provide_is_detected_as_refusal() -> None:
    metrics = calculate_case_metrics(
        answer="无法提供当前账户余额，因为资料中没有用量信息。",
        retrieved=[{"document_id": "context"}],
        reranked=[{"document_id": "context"}],
        citations=[{"document_id": "context"}],
        expected_document_ids=[],
        required_key_points=[],
        should_refuse=True,
    )

    assert metrics["actual_refusal"] is True
    assert metrics["refusal_correct"] is True


def test_case_metrics_record_rerank_fallback() -> None:
    metrics = calculate_case_metrics(
        answer="答案",
        retrieved=[{"document_id": "expected"}],
        reranked=[
            {
                "document_id": "expected",
                "rerank_status": "fallback",
                "rerank_attempts": 2,
                "rerank_fallback_reason": "timeout",
            }
        ],
        citations=[{"document_id": "expected"}],
        expected_document_ids=["expected"],
        required_key_points=[],
        should_refuse=False,
    )

    assert metrics["rerank_fallback"] is True
    assert metrics["rerank_attempts"] == 2
    assert metrics["rerank_fallback_reason"] == "timeout"


def test_citation_precision_can_allow_secondary_supporting_documents() -> None:
    metrics = calculate_case_metrics(
        answer="答案",
        retrieved=[{"document_id": "primary"}],
        reranked=[{"document_id": "primary"}],
        citations=[
            {"document_id": "primary"},
            {"document_id": "supporting"},
        ],
        expected_document_ids=["primary"],
        acceptable_citation_document_ids=["primary", "supporting"],
        required_key_points=[],
        should_refuse=False,
    )

    assert metrics["retrieval_recall_at_k"] == 1.0
    assert metrics["citation_precision"] == 1.0
    assert metrics["citation_recall"] == 1.0


def test_key_point_groups_credit_synonyms_without_changing_strict_coverage() -> None:
    metrics = calculate_case_metrics(
        answer="存在对话历史时才会改写，MRR 使用 1.0 / first_rank 计算。",
        retrieved=[{"document_id": "expected"}],
        reranked=[{"document_id": "expected"}],
        citations=[{"document_id": "expected"}],
        expected_document_ids=["expected"],
        required_key_points=["历史消息", "倒数"],
        required_key_point_groups=[
            ["历史消息", "对话历史", "history"],
            ["倒数", "1.0 / first_rank", "1/first_rank"],
        ],
        should_refuse=False,
    )

    assert metrics["key_point_coverage"] == 0.0
    assert metrics["key_point_group_coverage"] == 1.0
    assert len(metrics["matched_key_point_groups"]) == 2


def test_citation_evidence_supports_answered_key_point_groups() -> None:
    metrics = calculate_case_metrics(
        answer="Worker 每次只预取一个任务，并在丢失时重新投递。",
        retrieved=[{"document_id": "expected"}],
        reranked=[{"document_id": "expected", "chunk_id": "chunk-1"}],
        citations=[
            {
                "document_id": "expected",
                "document_name": "celery.py",
                "chunk_id": "chunk-1",
            }
        ],
        citation_evidence=[
            {
                "chunk_id": "chunk-1",
                "evidence_content": (
                    "worker_prefetch_multiplier=1\n"
                    "task_reject_on_worker_lost=True  # redelivery"
                ),
            }
        ],
        expected_document_ids=["expected"],
        required_key_points=["预取一个", "重新投递"],
        required_key_point_groups=[
            ["预取一个", "worker_prefetch_multiplier=1"],
            ["重新投递", "redelivery"],
        ],
        should_refuse=False,
    )

    assert metrics["citation_grounded_key_point_coverage"] == 1.0
    assert metrics["citation_key_point_support_rate"] == 1.0
    assert metrics["citation_required_point_support_precision"] == 1.0
    assert len(metrics["citation_grounded_key_point_groups"]) == 2


def test_citation_evidence_reports_unsupported_answered_points() -> None:
    metrics = calculate_case_metrics(
        answer="任务会重新投递。",
        retrieved=[{"document_id": "expected"}],
        reranked=[{"document_id": "expected", "chunk_id": "chunk-1"}],
        citations=[
            {
                "document_id": "expected",
                "document_name": "celery.py",
                "chunk_id": "chunk-1",
            }
        ],
        citation_evidence=[
            {"chunk_id": "chunk-1", "evidence_content": "task_acks_late=True"}
        ],
        expected_document_ids=["expected"],
        required_key_points=["重新投递"],
        required_key_point_groups=[["重新投递", "redelivery"]],
        should_refuse=False,
    )

    assert metrics["citation_grounded_key_point_coverage"] == 0.0
    assert metrics["citation_key_point_support_rate"] == 0.0
    assert metrics["citation_required_point_support_precision"] == 0.0
    assert metrics["citation_unsupported_answer_key_point_groups"] == [
        ["重新投递", "redelivery"]
    ]


def test_citation_evidence_snapshots_expanded_generation_context() -> None:
    citations = [
        {
            "document_id": "document-1",
            "document_name": "guide.md",
            "chunk_id": "chunk-1",
            "chunk_index": 3,
        }
    ]
    evidence = build_citation_evidence(
        citations,
        [
            {
                **citations[0],
                "parent_section_id": "parent-1",
                "index_version": "version-1",
                "content": "retrieval chunk",
                "context_content": "parent and neighboring section evidence",
            }
        ],
    )

    assert evidence[0]["evidence_content"] == "parent and neighboring section evidence"
    assert evidence[0]["reconstructed"] is False


def test_evaluation_summary_aggregates_citation_marker_diagnostics() -> None:
    result = SimpleNamespace(
        status="succeeded",
        metrics={
            "citation_diagnostics": {
                "markers_seen": 4,
                "compliant_markers": 1,
                "invalid_markers": 1,
                "ambiguous_markers": 1,
                "imprecise_markers": 0,
                "duplicate_markers": 1,
                "repeated_markers": 2,
            }
        },
        first_token_ms=None,
        total_latency_ms=None,
    )

    summary = summarize_results([result])

    assert summary["citation_marker_validity_rate"] == 0.5
    assert summary["citation_duplicate_marker_rate"] == 0.25
    assert summary["citation_policy_compliance_rate"] == 0.25
    assert summary["citation_invalid_markers"] == 1
    assert summary["citation_ambiguous_markers"] == 1
    assert summary["citation_imprecise_markers"] == 0
    assert summary["citation_repeated_markers"] == 2


def test_evaluation_case_ground_truth_validation() -> None:
    with pytest.raises(ValidationError):
        EvaluationCaseCreate(
            question="可回答问题",
            reference_answer="答案",
            should_refuse=False,
        )
    with pytest.raises(ValidationError):
        EvaluationCaseCreate(
            question="拒答问题",
            reference_answer="应该拒答",
            should_refuse=True,
            expected_document_ids=[uuid4()],
        )


def test_expected_documents_are_always_acceptable_citations() -> None:
    primary = uuid4()
    supporting = uuid4()

    case = EvaluationCaseCreate(
        question="问题",
        reference_answer="答案",
        expected_document_ids=[primary],
        acceptable_citation_document_ids=[supporting],
    )

    assert case.acceptable_citation_document_ids == [primary, supporting]
    assert case.required_key_point_groups == []


def test_missing_key_point_groups_are_backfilled_as_singletons() -> None:
    case = EvaluationCaseCreate(
        question="问题",
        reference_answer="答案",
        expected_document_ids=[uuid4()],
        required_key_points=["第一点", "第二点"],
        required_key_point_groups=[["第一点", "要点一"]],
    )

    assert case.required_key_point_groups == [
        ["第一点", "要点一"],
        ["第二点"],
    ]


def test_key_point_groups_must_be_anchored_to_strict_points() -> None:
    with pytest.raises(ValidationError):
        EvaluationCaseCreate(
            question="问题",
            reference_answer="答案",
            expected_document_ids=[uuid4()],
            required_key_points=["严格关键点"],
            required_key_point_groups=[["只有别名"]],
        )


def test_evaluation_routes_are_exposed() -> None:
    paths = app.openapi()["paths"]
    assert "/api/v1/evaluations/datasets" in paths
    assert "/api/v1/evaluations/datasets/{dataset_id}/cases/bulk" in paths
    case_path = "/api/v1/evaluations/datasets/{dataset_id}/cases/{case_id}"
    assert case_path in paths
    assert "put" in paths[case_path]
    assert "delete" in paths[case_path]
    assert "/api/v1/evaluations/runs" in paths
    assert "/api/v1/evaluations/runs/{run_id}/report" in paths
    assert "/api/v1/evaluations/runs/{run_id}/recalculate" in paths


def test_evaluation_case_page_has_bounded_limit() -> None:
    with pytest.raises(ValidationError):
        EvaluationCasePage(items=[], total=0, limit=101, offset=0)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("counts", "message"),
    [
        ([1], "queued or running"),
        ([0, 1], "historical reports"),
    ],
)
async def test_evaluation_case_mutation_preserves_active_and_historical_runs(
    counts: list[int], message: str
) -> None:
    dataset = EvaluationDataset(
        id=uuid4(),
        tenant_id="tenant-a",
        knowledge_base_id=uuid4(),
        name="Release gate",
        status="active",
        created_by="editor-a",
    )
    case = EvaluationCase(
        id=uuid4(),
        dataset_id=dataset.id,
        question="Question",
        reference_answer="Answer",
        expected_document_ids=[],
        acceptable_citation_document_ids=[],
        required_key_points=[],
        required_key_point_groups=[],
        should_refuse=True,
        tags=[],
    )
    db = AsyncMock()
    db.get.return_value = case
    db.scalar.side_effect = counts

    with pytest.raises(HTTPException, match=message) as exc_info:
        await _mutable_case(db, dataset, case.id)
    assert exc_info.value.status_code == 409
