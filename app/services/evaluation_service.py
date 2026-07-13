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
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.models import DocumentSection, EvaluationCase, EvaluationResult, EvaluationRun
from app.db.session import AsyncSessionFactory
from app.rag.graph import CITATION_POLICY_VERSION, get_rag_graph
from app.services.chunking_service import truncate_to_tokens
from app.services.model_provider import validate_rag_configuration

logger = structlog.get_logger(__name__)
REFUSAL_MARKERS = (
    "未在当前有权访问的知识库中检索到",
    "没有足够相关的资料",
    "资料不足",
    "无法根据提供的资料",
    "不知道",
    "无法回答",
    "无法提供",
    "没有给出",
    "未提供",
    "没有包含",
)
SENTENCE_BOUNDARY = re.compile(r"(?<=[。！？!?])")
QUOTED_OR_CODE = re.compile(r"`[^`]*`|“[^”]*”|\"[^\"]*\"|'[^']*'")


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
    # Only inspect the first conclusion sentence so a later caveat or an explanation
    # about phrases such as “无法回答” does not become a full-answer refusal.
    opening_sentence = SENTENCE_BOUNDARY.split(answer.strip(), maxsplit=1)[0]
    opening_without_quotes = QUOTED_OR_CODE.sub("", opening_sentence)
    normalized_opening = normalize_for_matching(opening_without_quotes)
    refusal_scope = (normalized_opening or normalized_answer)[:120]
    return any(
        normalize_for_matching(marker) in refusal_scope for marker in REFUSAL_MARKERS
    )


def build_citation_evidence(
    citations: list[dict[str, Any]], expanded: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Snapshot only the generation context explicitly cited by the answer."""

    expanded_by_chunk = {
        str(item.get("chunk_id", "")): item
        for item in expanded
        if item.get("chunk_id")
    }
    evidence: list[dict[str, Any]] = []
    for citation in citations:
        item = expanded_by_chunk.get(str(citation.get("chunk_id", "")))
        if item is None:
            continue
        evidence.append(
            {
                "document_id": str(citation.get("document_id", "")),
                "document_name": str(citation.get("document_name", "")),
                "chunk_id": str(citation.get("chunk_id", "")),
                "chunk_index": int(citation.get("chunk_index", 0)),
                "parent_section_id": str(item.get("parent_section_id", "")),
                "index_version": str(item.get("index_version", "")),
                "evidence_content": str(
                    item.get("context_content", item.get("content", ""))
                ),
                "reconstructed": False,
            }
        )
    return evidence


async def reconstruct_citation_evidence(
    db: AsyncSession,
    citations: list[dict[str, Any]],
    reranked: list[dict[str, Any]],
    *,
    neighbor_window: int,
    max_tokens: int,
) -> list[dict[str, Any]]:
    """Best-effort reconstruction for runs created before evidence snapshots existed."""

    reranked_by_chunk = {
        str(item.get("chunk_id", "")): item
        for item in reranked
        if item.get("chunk_id")
    }
    cited_items = [
        (citation, reranked_by_chunk.get(str(citation.get("chunk_id", ""))))
        for citation in citations
    ]
    parent_ids: list[UUID] = []
    for _, item in cited_items:
        if item is None:
            continue
        try:
            parent_ids.append(UUID(str(item.get("parent_section_id", ""))))
        except ValueError:
            continue

    parents: dict[str, DocumentSection] = {}
    sections_by_document: dict[tuple[UUID, str], dict[int, DocumentSection]] = {}
    if parent_ids:
        parents = {
            str(section.id): section
            for section in (
                await db.scalars(select(DocumentSection).where(DocumentSection.id.in_(parent_ids)))
            ).all()
        }
        document_ids = {parent.document_id for parent in parents.values()}
        if document_ids:
            sections = (
                await db.scalars(
                    select(DocumentSection).where(
                        DocumentSection.document_id.in_(document_ids)
                    )
                )
            ).all()
            for section in sections:
                sections_by_document.setdefault(
                    (section.document_id, section.index_version), {}
                )[section.section_index] = section

    evidence: list[dict[str, Any]] = []
    for citation, item in cited_items:
        if item is None:
            continue
        parent = parents.get(str(item.get("parent_section_id", "")))
        content = str(item.get("content", ""))
        if parent is not None:
            siblings = sections_by_document.get(
                (parent.document_id, parent.index_version), {}
            )
            content = "\n\n".join(
                siblings[index].content
                for index in range(
                    max(0, parent.section_index - neighbor_window),
                    parent.section_index + neighbor_window + 1,
                )
                if index in siblings
            ) or content
        evidence.append(
            {
                "document_id": str(citation.get("document_id", "")),
                "document_name": str(citation.get("document_name", "")),
                "chunk_id": str(citation.get("chunk_id", "")),
                "chunk_index": int(citation.get("chunk_index", 0)),
                "parent_section_id": str(item.get("parent_section_id", "")),
                "index_version": str(item.get("index_version", "")),
                "evidence_content": truncate_to_tokens(content, max_tokens),
                "reconstructed": True,
            }
        )
    return evidence


def calculate_citation_key_point_support(
    *,
    answer: str,
    citations: list[dict[str, Any]],
    citation_evidence: list[dict[str, Any]],
    key_point_groups: list[list[str]],
) -> dict[str, Any]:
    answer_normalized = normalize_for_matching(answer)
    evidence_by_chunk = {
        str(item.get("chunk_id", "")): normalize_for_matching(
            str(
                item.get(
                    "evidence_content",
                    item.get("context_content", item.get("content", "")),
                )
            )
        )
        for item in citation_evidence
        if item.get("chunk_id")
    }
    matched_groups: list[list[str]] = []
    grounded_groups: list[list[str]] = []
    supported_chunk_ids: set[str] = set()
    support_details: list[dict[str, Any]] = []
    for group in key_point_groups:
        answer_aliases = [
            alias
            for alias in group
            if alias.strip() and normalize_for_matching(alias) in answer_normalized
        ]
        if not answer_aliases:
            continue
        matched_groups.append(group)
        supporting_citations: list[dict[str, str]] = []
        for citation in citations:
            chunk_id = str(citation.get("chunk_id", ""))
            evidence = evidence_by_chunk.get(chunk_id, "")
            evidence_aliases = [
                alias
                for alias in group
                if alias.strip() and normalize_for_matching(alias) in evidence
            ]
            if evidence_aliases:
                supported_chunk_ids.add(chunk_id)
                supporting_citations.append(
                    {
                        "chunk_id": chunk_id,
                        "document_name": str(citation.get("document_name", "")),
                        "matched_alias": evidence_aliases[0],
                    }
                )
        if supporting_citations:
            grounded_groups.append(group)
        support_details.append(
            {
                "key_point_group": group,
                "answer_matched_alias": answer_aliases[0],
                "supporting_citations": supporting_citations,
            }
        )

    cited_chunk_ids = {
        str(citation.get("chunk_id", ""))
        for citation in citations
        if citation.get("chunk_id")
    }
    return {
        "citation_grounded_key_point_coverage": (
            len(grounded_groups) / len(key_point_groups) if key_point_groups else None
        ),
        "citation_key_point_support_rate": (
            len(grounded_groups) / len(matched_groups) if matched_groups else None
        ),
        "citation_required_point_support_precision": (
            len(supported_chunk_ids.intersection(cited_chunk_ids)) / len(cited_chunk_ids)
            if cited_chunk_ids and matched_groups
            else None
        ),
        "citation_grounded_key_point_groups": grounded_groups,
        "citation_unsupported_answer_key_point_groups": [
            group for group in matched_groups if group not in grounded_groups
        ],
        "citation_supported_chunk_ids": sorted(supported_chunk_ids),
        "citation_unsupported_chunk_ids": sorted(cited_chunk_ids - supported_chunk_ids),
        "citation_key_point_support": support_details,
    }


def calculate_case_metrics(
    *,
    answer: str,
    retrieved: list[dict[str, Any]],
    reranked: list[dict[str, Any]],
    citations: list[dict[str, Any]],
    expected_document_ids: list[str],
    acceptable_citation_document_ids: list[str] | None = None,
    required_key_points: list[str],
    required_key_point_groups: list[list[str]] | None = None,
    citation_evidence: list[dict[str, Any]] | None = None,
    should_refuse: bool,
) -> dict[str, Any]:
    retrieval = ranking_metrics(retrieved, expected_document_ids)
    rerank = ranking_metrics(reranked, expected_document_ids)
    expected = set(expected_document_ids)
    acceptable_citations = set(
        acceptable_citation_document_ids or expected_document_ids
    )
    cited = set(ranked_document_ids(citations))
    answer_normalized = normalize_for_matching(answer)
    matched_key_points = [
        point
        for point in required_key_points
        if normalize_for_matching(point) in answer_normalized
    ]
    key_point_groups = required_key_point_groups or [
        [point] for point in required_key_points
    ]
    matched_key_point_groups = [
        group
        for group in key_point_groups
        if any(
            normalize_for_matching(alias) in answer_normalized
            for alias in group
            if alias.strip()
        )
    ]
    grounding = calculate_citation_key_point_support(
        answer=answer,
        citations=citations,
        citation_evidence=citation_evidence or reranked,
        key_point_groups=key_point_groups,
    )
    actual_refusal = detect_refusal(answer, citations)

    return {
        "retrieval_recall_at_k": retrieval["recall"],
        "retrieval_mrr": retrieval["mrr"],
        "rerank_recall_at_k": rerank["recall"],
        "rerank_mrr": rerank["mrr"],
        "citation_precision": (
            len(cited.intersection(acceptable_citations)) / len(cited)
            if cited and acceptable_citations
            else None
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
        "key_point_group_coverage": (
            len(matched_key_point_groups) / len(key_point_groups)
            if key_point_groups
            else None
        ),
        "matched_key_point_groups": matched_key_point_groups,
        **grounding,
        "expected_refusal": should_refuse,
        "actual_refusal": actual_refusal,
        "refusal_correct": actual_refusal == should_refuse,
        "rerank_fallback": any(
            item.get("rerank_status") == "fallback" for item in reranked
        ),
        "rerank_attempts": max(
            (int(item.get("rerank_attempts", 0)) for item in reranked), default=0
        ),
        "rerank_fallback_reason": next(
            (
                item.get("rerank_fallback_reason")
                for item in reranked
                if item.get("rerank_fallback_reason")
            ),
            None,
        ),
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
        "rerank_timeout_seconds": settings.rerank_timeout_seconds,
        "rerank_max_attempts": settings.rerank_max_attempts,
        "rerank_retry_base_seconds": settings.rerank_retry_base_seconds,
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
        "context_document_diversity_enabled": (
            settings.context_document_diversity_enabled
        ),
        "context_document_diversity_min_score_ratio": (
            settings.context_document_diversity_min_score_ratio
        ),
        "milvus_collection_alias": settings.milvus_collection_alias,
        "citation_policy_version": CITATION_POLICY_VERSION,
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
    citation_evidence = build_citation_evidence(
        citations, list(final_state.get("expanded", reranked))
    )
    metrics = calculate_case_metrics(
        answer=answer,
        retrieved=retrieved,
        reranked=reranked,
        citations=citations,
        expected_document_ids=case.expected_document_ids,
        acceptable_citation_document_ids=case.acceptable_citation_document_ids,
        required_key_points=case.required_key_points,
        required_key_point_groups=case.required_key_point_groups,
        citation_evidence=citation_evidence,
        should_refuse=case.should_refuse,
    )
    metrics["citation_diagnostics"] = dict(
        final_state.get("citation_diagnostics", {})
    )
    return {
        "rewritten_query": str(final_state.get("rewritten_query", case.question)),
        "answer": answer,
        "retrieved_documents": retrieved,
        "reranked_documents": reranked,
        "citations": citations,
        "citation_evidence": citation_evidence,
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
        "key_point_group_coverage",
        "citation_grounded_key_point_coverage",
        "citation_key_point_support_rate",
        "citation_required_point_support_precision",
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
    fallback_values = [
        float(bool(result.metrics.get("rerank_fallback")))
        for result in results
        if result.status == "succeeded"
    ]
    retry_values = [
        float(int(result.metrics.get("rerank_attempts", 0)) > 1)
        for result in results
        if result.status == "succeeded"
    ]
    citation_diagnostics = [
        result.metrics.get("citation_diagnostics", {})
        for result in results
        if result.status == "succeeded"
        and isinstance(result.metrics.get("citation_diagnostics"), dict)
    ]
    markers_seen = sum(int(item.get("markers_seen", 0)) for item in citation_diagnostics)
    compliant_markers = sum(
        int(item.get("compliant_markers", 0)) for item in citation_diagnostics
    )
    invalid_markers = sum(
        int(item.get("invalid_markers", 0)) for item in citation_diagnostics
    )
    ambiguous_markers = sum(
        int(item.get("ambiguous_markers", 0)) for item in citation_diagnostics
    )
    imprecise_markers = sum(
        int(item.get("imprecise_markers", 0)) for item in citation_diagnostics
    )
    duplicate_markers = sum(
        int(item.get("duplicate_markers", 0)) for item in citation_diagnostics
    )
    repeated_markers = sum(
        int(item.get("repeated_markers", 0)) for item in citation_diagnostics
    )
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
            "rerank_fallback_rate": (
                round(fmean(fallback_values), 6) if fallback_values else None
            ),
            "rerank_retry_rate": (
                round(fmean(retry_values), 6) if retry_values else None
            ),
            "citation_marker_validity_rate": (
                round(
                    (markers_seen - invalid_markers - ambiguous_markers)
                    / markers_seen,
                    6,
                )
                if markers_seen
                else None
            ),
            "citation_duplicate_marker_rate": (
                round(duplicate_markers / markers_seen, 6) if markers_seen else None
            ),
            "citation_policy_compliance_rate": (
                round(compliant_markers / markers_seen, 6)
                if markers_seen
                else None
            ),
            "citation_invalid_markers": invalid_markers,
            "citation_ambiguous_markers": ambiguous_markers,
            "citation_imprecise_markers": imprecise_markers,
            "citation_repeated_markers": repeated_markers,
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
            if not result.citation_evidence and result.citations:
                result.citation_evidence = await reconstruct_citation_evidence(
                    db,
                    result.citations,
                    result.reranked_documents,
                    neighbor_window=int(
                        run.config_snapshot.get("context_neighbor_window", 1)
                    ),
                    max_tokens=int(run.config_snapshot.get("context_max_tokens", 4_000)),
                )
            existing_diagnostics = result.metrics.get("citation_diagnostics")
            result.metrics = calculate_case_metrics(
                answer=result.answer or "",
                retrieved=result.retrieved_documents,
                reranked=result.reranked_documents,
                citations=result.citations,
                expected_document_ids=case.expected_document_ids,
                acceptable_citation_document_ids=(
                    case.acceptable_citation_document_ids
                ),
                required_key_points=case.required_key_points,
                required_key_point_groups=case.required_key_point_groups,
                citation_evidence=result.citation_evidence,
                should_refuse=case.should_refuse,
            )
            if isinstance(existing_diagnostics, dict):
                result.metrics["citation_diagnostics"] = existing_diagnostics
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
