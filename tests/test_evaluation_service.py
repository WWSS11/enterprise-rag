from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.main import app
from app.schemas.evaluation import EvaluationCaseCreate
from app.services.evaluation_service import (
    calculate_case_metrics,
    ranking_metrics,
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


def test_evaluation_routes_are_exposed() -> None:
    paths = app.openapi()["paths"]
    assert "/api/v1/evaluations/datasets" in paths
    assert "/api/v1/evaluations/datasets/{dataset_id}/cases/bulk" in paths
    assert "/api/v1/evaluations/runs" in paths
    assert "/api/v1/evaluations/runs/{run_id}/report" in paths
    assert "/api/v1/evaluations/runs/{run_id}/recalculate" in paths
