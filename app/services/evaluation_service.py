from __future__ import annotations

import re
import unicodedata
from datetime import UTC, datetime
from statistics import fmean
from time import perf_counter
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import select

from app.core.config import get_settings
from app.db.models import EvaluationCase, EvaluationResult, EvaluationRun
from app.db.session import AsyncSessionFactory
from app.rag.graph import get_rag_graph
from app.services.model_provider import validate_rag_configuration

logger = structlog.get_logger(__name__)
REFUSAL_MARKERS = (
    "未在当前有权访问的知识库中检索到",
    "没有足够相关的资料",
    "资料不足",
    "无法根据提供的资料",
    "不知道",
    "无法回答",
    "没有给出",
    "未提供",
    "没有包含",
)


def normalize_for_matching(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return re.sub(r"[^\w\u4e00-\u9fff]+", "", normalized)


def ranked_document_ids(items: list[dict[str, Any]]) -> list[str]:
    document_ids: list[str] = []
    seen: set[str] = set()
    for item in items:
        document_id = str(item.get("document_id", ""))
        if not document_id or document_id in seen:
            continue
        seen.add(document_id)
        document_ids.append(document_id)
    return document_ids


def ranking_metrics(
    items: list[dict[str, Any]], expected_document_ids: list[str]
) -> dict[str, float | None]:
    expected = set(expected_document_ids)
    if not expected:
        return {"recall": None, "mrr": None}
    ranked = ranked_document_ids(items)
    hits = expected.intersection(ranked)
    first_rank = next(
        (rank for rank, document_id in enumerate(ranked, start=1) if document_id in expected),
        None,
    )
    return {
        "recall": len(hits) / len(expected),
        "mrr": 1.0 / first_rank if first_rank is not None else 0.0,
    }


def detect_refusal(answer: str, citations: list[dict[str, Any]]) -> bool:
    normalized_answer = normalize_for_matching(answer)
    # Citations may legitimately justify why the available corpus cannot answer.
    # Only inspect the opening conclusion so a later caveat such as "未提供更多细节"
    # does not turn an otherwise complete answer into a refusal.
    opening_paragraph = answer.split("\n\n", 1)[0]
    normalized_opening = normalize_for_matching(opening_paragraph)
    refusal_scope = (normalized_opening or normalized_answer)[:180]
    return any(
        normalize_for_matching(marker) in refusal_scope for marker in REFUSAL_MARKERS
    )


def calculate_case_metrics(
    *,
    answer: str,
    retrieved: list[dict[str, Any]],
    reranked: list[dict[str, Any]],
    citations: list[dict[str, Any]],
    expected_document_ids: list[str],
    required_key_points: list[str],
    should_refuse: bool,
) -> dict[str, Any]:
    retrieval = ranking_metrics(retrieved, expected_document_ids)
    rerank = ranking_metrics(reranked, expected_document_ids)
    expected = set(expected_document_ids)
    cited = set(ranked_document_ids(citations))
    answer_normalized = normalize_for_matching(answer)
    matched_key_points = [
        point
        for point in required_key_points
        if normalize_for_matching(point) in answer_normalized
    ]
    actual_refusal = detect_refusal(answer, citations)

    return {
        "retrieval_recall_at_k": retrieval["recall"],
        "retrieval_mrr": retrieval["mrr"],
        "rerank_recall_at_k": rerank["recall"],
        "rerank_mrr": rerank["mrr"],
        "citation_precision": (
            len(cited.intersection(expected)) / len(cited) if cited and expected else None
        ),
        "citation_recall": (
            len(cited.intersection(expected)) / len(expected) if expected else None
        ),
        "key_point_coverage": (
            len(matched_key_points) / len(required_key_points)
            if required_key_points
            else None
        ),
        "matched_key_points": matched_key_points,
        "expected_refusal": should_refuse,
        "actual_refusal": actual_refusal,
        "refusal_correct": actual_refusal == should_refuse,
    }


def build_config_snapshot() -> dict[str, Any]:
    settings = get_settings()
    return {
        "chat_model": settings.chat_model,
        "chat_base_url": settings.chat_base_url,
        "chat_temperature": settings.chat_temperature,
        "embedding_model": settings.embedding_model,
        "embedding_dimension": settings.embedding_dimension,
        "rerank_enabled": settings.rerank_enabled,
        "rerank_model": settings.rerank_model if settings.rerank_enabled else None,
        "retrieval_top_k": settings.retrieval_top_k,
        "rerank_top_k": settings.rerank_top_k,
        "score_threshold": settings.score_threshold,
        "hybrid_rrf_k": settings.hybrid_rrf_k,
        "atomic_chunk_max_tokens": settings.atomic_chunk_max_tokens,
        "retrieval_chunk_target_tokens": settings.retrieval_chunk_target_tokens,
        "retrieval_chunk_overlap_tokens": settings.retrieval_chunk_overlap_tokens,
        "parent_chunk_max_tokens": settings.parent_chunk_max_tokens,
        "embedding_context_max_tokens": settings.embedding_context_max_tokens,
        "semantic_chunking_enabled": settings.semantic_chunking_enabled,
        "semantic_break_threshold": settings.semantic_break_threshold,
        "semantic_break_percentile": settings.semantic_break_percentile,
        "context_max_tokens": settings.context_max_tokens,
        "context_max_parents": settings.context_max_parents,
        "context_neighbor_window": settings.context_neighbor_window,
        "milvus_collection_alias": settings.milvus_collection_alias,
    }


async def execute_rag_case(
    case: EvaluationCase, tenant_id: str, knowledge_base_id: UUID, user_id: str
) -> dict[str, Any]:
    started = perf_counter()
    first_token_ms: float | None = None
    final_state: dict[str, Any] = {}
    async for mode, payload in get_rag_graph().astream(
        {
            "question": case.question,
            "tenant_id": tenant_id,
            "knowledge_base_id": str(knowledge_base_id),
            "user_id": user_id,
            "history": [],
        },
        stream_mode=["custom", "updates"],
    ):
        if mode == "custom" and payload.get("type") == "token":
            if first_token_ms is None and str(payload.get("token", "")):
                first_token_ms = (perf_counter() - started) * 1_000
            continue
        if mode != "updates":
            continue
        for update in payload.values():
            if isinstance(update, dict):
                final_state.update(update)

    total_latency_ms = (perf_counter() - started) * 1_000
    answer = str(final_state.get("answer", ""))
    retrieved = list(final_state.get("retrieved", []))
    reranked = list(final_state.get("reranked", []))
    citations = list(final_state.get("citations", []))
    metrics = calculate_case_metrics(
        answer=answer,
        retrieved=retrieved,
        reranked=reranked,
        citations=citations,
        expected_document_ids=case.expected_document_ids,
        required_key_points=case.required_key_points,
        should_refuse=case.should_refuse,
    )
    return {
        "rewritten_query": str(final_state.get("rewritten_query", case.question)),
        "answer": answer,
        "retrieved_documents": retrieved,
        "reranked_documents": reranked,
        "citations": citations,
        "metrics": metrics,
        "first_token_ms": first_token_ms,
        "total_latency_ms": total_latency_ms,
    }


def summarize_results(results: list[EvaluationResult]) -> dict[str, Any]:
    metric_names = (
        "retrieval_recall_at_k",
        "retrieval_mrr",
        "rerank_recall_at_k",
        "rerank_mrr",
        "citation_precision",
        "citation_recall",
        "key_point_coverage",
    )
    summary: dict[str, Any] = {}
    for metric_name in metric_names:
        values = [
            float(result.metrics[metric_name])
            for result in results
            if result.status == "succeeded"
            and result.metrics.get(metric_name) is not None
        ]
        summary[metric_name] = round(fmean(values), 6) if values else None

    refusal_values = [
        float(bool(result.metrics.get("refusal_correct")))
        for result in results
        if result.status == "succeeded" and "refusal_correct" in result.metrics
    ]
    first_token_values = [
        result.first_token_ms
        for result in results
        if result.status == "succeeded" and result.first_token_ms is not None
    ]
    total_latency_values = [
        result.total_latency_ms
        for result in results
        if result.status == "succeeded" and result.total_latency_ms is not None
    ]
    summary.update(
        {
            "refusal_accuracy": (
                round(fmean(refusal_values), 6) if refusal_values else None
            ),
            "average_first_token_ms": (
                round(fmean(first_token_values), 2) if first_token_values else None
            ),
            "average_total_latency_ms": (
                round(fmean(total_latency_values), 2) if total_latency_values else None
            ),
            "succeeded_cases": sum(result.status == "succeeded" for result in results),
            "failed_cases": sum(result.status == "failed" for result in results),
        }
    )
    return summary


async def recalculate_evaluation_run_metrics(run_id: UUID) -> EvaluationRun:
    """Recompute deterministic metrics from persisted outputs without model calls."""

    async with AsyncSessionFactory() as db:
        run = await db.get(EvaluationRun, run_id)
        if run is None:
            raise LookupError("evaluation run not found")
        rows = list(
            (
                await db.execute(
                    select(EvaluationResult, EvaluationCase)
                    .join(EvaluationCase, EvaluationCase.id == EvaluationResult.case_id)
                    .where(EvaluationResult.run_id == run.id)
                )
            ).all()
        )
        for result, case in rows:
            if result.status != "succeeded":
                continue
            result.metrics = calculate_case_metrics(
                answer=result.answer or "",
                retrieved=result.retrieved_documents,
                reranked=result.reranked_documents,
                citations=result.citations,
                expected_document_ids=case.expected_document_ids,
                required_key_points=case.required_key_points,
                should_refuse=case.should_refuse,
            )
        results = [result for result, _ in rows]
        run.summary = summarize_results(results)
        await db.commit()
        await db.refresh(run)
        return run


async def execute_evaluation_run(run_id: UUID) -> dict[str, Any]:
    async with AsyncSessionFactory() as db:
        run = await db.get(EvaluationRun, run_id)
        if run is None:
            raise LookupError("evaluation run not found")
        if run.status == "succeeded":
            return run.summary

        cases = list(
            (
                await db.execute(
                    select(EvaluationCase)
                    .where(EvaluationCase.dataset_id == run.dataset_id)
                    .order_by(EvaluationCase.created_at, EvaluationCase.id)
                )
            ).scalars()
        )
        run.status = "running"
        run.started_at = run.started_at or datetime.now(UTC)
        run.total_cases = len(cases)
        run.progress = 0
        run.error_message = None
        await db.commit()

        try:
            validate_rag_configuration()
            for position, case in enumerate(cases, start=1):
                existing = await db.scalar(
                    select(EvaluationResult).where(
                        EvaluationResult.run_id == run.id,
                        EvaluationResult.case_id == case.id,
                    )
                )
                if existing is None:
                    try:
                        result_data = await execute_rag_case(
                            case, run.tenant_id, run.knowledge_base_id, run.created_by
                        )
                        db.add(
                            EvaluationResult(
                                run_id=run.id,
                                case_id=case.id,
                                status="succeeded",
                                **result_data,
                            )
                        )
                    except Exception as exc:
                        await logger.aexception(
                            "evaluation_case_failed",
                            run_id=str(run.id),
                            case_id=str(case.id),
                        )
                        db.add(
                            EvaluationResult(
                                run_id=run.id,
                                case_id=case.id,
                                status="failed",
                                error_message=str(exc)[:4_000],
                            )
                        )
                run.completed_cases = position
                run.progress = round(position * 100 / max(1, len(cases)))
                await db.commit()

            results = list(
                (
                    await db.execute(
                        select(EvaluationResult).where(EvaluationResult.run_id == run.id)
                    )
                ).scalars()
            )
            run.summary = summarize_results(results)
            run.failed_cases = sum(result.status == "failed" for result in results)
            run.status = "succeeded"
            run.progress = 100
            run.completed_at = datetime.now(UTC)
            await db.commit()
            await logger.ainfo(
                "evaluation_run_completed",
                run_id=str(run.id),
                total_cases=run.total_cases,
                failed_cases=run.failed_cases,
            )
            return run.summary
        except Exception as exc:
            await db.rollback()
            run = await db.get(EvaluationRun, run_id)
            if run is not None:
                run.status = "failed"
                run.error_message = str(exc)[:4_000]
                run.completed_at = datetime.now(UTC)
                await db.commit()
            raise
