from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.main import app
from app.schemas.evaluation import EvaluationQualityGateThresholds
from app.services.evaluation_gate_service import (
    compare_evaluation_runs,
    evaluate_quality_gate,
)


def make_run(
    *,
    dataset_id=None,
    summary: dict[str, float] | None = None,
    config: dict[str, object] | None = None,
    status: str = "succeeded",
):
    return SimpleNamespace(
        id=uuid4(),
        dataset_id=dataset_id or uuid4(),
        status=status,
        summary=summary or {},
        config_snapshot=config or {},
    )


def control_summary() -> dict[str, float]:
    return {
        "retrieval_recall_at_k": 1.0,
        "retrieval_mrr": 0.76,
        "rerank_recall_at_k": 0.975,
        "rerank_mrr": 0.916667,
        "citation_precision": 0.825,
        "citation_recall": 0.975,
        "key_point_group_coverage": 0.915833,
        "citation_key_point_support_rate": 0.810833,
        "citation_required_point_support_precision": 0.9,
        "refusal_accuracy": 1.0,
        "average_first_token_ms": 18_843.13,
        "average_total_latency_ms": 24_746.02,
        "failed_cases": 0.0,
    }


def evaluate_default_gate(baseline, candidate) -> dict[str, object]:
    thresholds = EvaluationQualityGateThresholds()
    return evaluate_quality_gate(
        baseline,
        candidate,
        max_metric_regressions=thresholds.max_metric_regressions,
        minimum_candidate_metrics=thresholds.minimum_candidate_metrics,
        max_latency_increase_ratios=thresholds.max_latency_increase_ratios,
        require_zero_failed_cases=thresholds.require_zero_failed_cases,
    )


def test_compare_runs_reports_metric_and_config_differences() -> None:
    dataset_id = uuid4()
    baseline = make_run(
        dataset_id=dataset_id,
        summary={"citation_recall": 0.9},
        config={"citation_policy_version": None, "chat_model": "model-a"},
    )
    candidate = make_run(
        dataset_id=dataset_id,
        summary={"citation_recall": 0.95},
        config={"citation_policy_version": "v1", "chat_model": "model-a"},
    )

    comparison = compare_evaluation_runs(baseline, candidate)

    citation = next(
        item for item in comparison["metrics"] if item["metric"] == "citation_recall"
    )
    assert citation["delta"] == pytest.approx(0.05)
    assert comparison["config_differences"] == [
        {
            "key": "citation_policy_version",
            "baseline": None,
            "candidate": "v1",
        }
    ]


def test_default_quality_gate_passes_equal_or_improved_candidate() -> None:
    dataset_id = uuid4()
    baseline_summary = control_summary()
    candidate_summary = {**baseline_summary, "citation_precision": 0.85}
    baseline = make_run(dataset_id=dataset_id, summary=baseline_summary)
    candidate = make_run(dataset_id=dataset_id, summary=candidate_summary)

    report = evaluate_default_gate(baseline, candidate)

    assert report["passed"] is True
    assert all(check["passed"] for check in report["checks"])


@pytest.mark.parametrize(
    "candidate_summary,failed_metrics",
    [
        (
            {
                **control_summary(),
                "citation_recall": 0.925,
                "key_point_group_coverage": 0.841667,
                "average_first_token_ms": 23_749.4,
                "average_total_latency_ms": 27_440.59,
            },
            {"citation_recall", "key_point_group_coverage", "average_first_token_ms"},
        ),
        (
            {
                **control_summary(),
                "key_point_group_coverage": 0.861667,
            },
            {"key_point_group_coverage"},
        ),
    ],
)
def test_default_quality_gate_rejects_real_prompt_regressions(
    candidate_summary: dict[str, float], failed_metrics: set[str]
) -> None:
    dataset_id = uuid4()
    baseline = make_run(dataset_id=dataset_id, summary=control_summary())
    candidate = make_run(dataset_id=dataset_id, summary=candidate_summary)

    report = evaluate_default_gate(baseline, candidate)
    actual_failed = {
        check["metric"] for check in report["checks"] if not check["passed"]
    }

    assert report["passed"] is False
    assert failed_metrics.issubset(actual_failed)


def test_comparison_requires_same_dataset_and_succeeded_runs() -> None:
    with pytest.raises(ValueError, match="same dataset"):
        compare_evaluation_runs(make_run(), make_run())

    dataset_id = uuid4()
    with pytest.raises(ValueError, match="succeeded"):
        compare_evaluation_runs(
            make_run(dataset_id=dataset_id),
            make_run(dataset_id=dataset_id, status="running"),
        )


def test_quality_gate_routes_are_exposed() -> None:
    paths = app.openapi()["paths"]
    assert "/api/v1/evaluations/runs/{candidate_run_id}/compare" in paths
    assert "/api/v1/evaluations/runs/{candidate_run_id}/gate" in paths
