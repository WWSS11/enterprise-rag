from __future__ import annotations

from math import isfinite
from typing import Any

from app.db.models import EvaluationRun

COMPARABLE_METRICS = (
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
    "refusal_accuracy",
    "rerank_fallback_rate",
    "rerank_retry_rate",
    "citation_marker_validity_rate",
    "citation_duplicate_marker_rate",
    "citation_policy_compliance_rate",
    "average_first_token_ms",
    "average_total_latency_ms",
    "succeeded_cases",
    "failed_cases",
)


def _metric_value(summary: dict[str, Any], metric: str) -> float | None:
    value = summary.get(metric)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    numeric = float(value)
    return numeric if isfinite(numeric) else None


def compare_evaluation_runs(
    baseline: EvaluationRun, candidate: EvaluationRun
) -> dict[str, Any]:
    if baseline.dataset_id != candidate.dataset_id:
        raise ValueError("evaluation runs must belong to the same dataset")
    if baseline.status != "succeeded" or candidate.status != "succeeded":
        raise ValueError("evaluation runs must be succeeded before comparison")

    metrics: list[dict[str, Any]] = []
    for metric in COMPARABLE_METRICS:
        baseline_value = _metric_value(baseline.summary, metric)
        candidate_value = _metric_value(candidate.summary, metric)
        delta = (
            candidate_value - baseline_value
            if baseline_value is not None and candidate_value is not None
            else None
        )
        relative_delta = (
            delta / abs(baseline_value)
            if delta is not None
            and baseline_value is not None
            and baseline_value != 0.0
            else None
        )
        metrics.append(
            {
                "metric": metric,
                "baseline": baseline_value,
                "candidate": candidate_value,
                "delta": delta,
                "relative_delta": relative_delta,
            }
        )

    config_differences = [
        {
            "key": key,
            "baseline": baseline.config_snapshot.get(key),
            "candidate": candidate.config_snapshot.get(key),
        }
        for key in sorted(
            set(baseline.config_snapshot).union(candidate.config_snapshot)
        )
        if baseline.config_snapshot.get(key) != candidate.config_snapshot.get(key)
    ]
    return {
        "baseline_run_id": baseline.id,
        "candidate_run_id": candidate.id,
        "dataset_id": baseline.dataset_id,
        "metrics": metrics,
        "config_differences": config_differences,
    }


def evaluate_quality_gate(
    baseline: EvaluationRun,
    candidate: EvaluationRun,
    *,
    max_metric_regressions: dict[str, float],
    minimum_candidate_metrics: dict[str, float],
    max_latency_increase_ratios: dict[str, float],
    require_zero_failed_cases: bool,
) -> dict[str, Any]:
    comparison = compare_evaluation_runs(baseline, candidate)
    metric_values = {item["metric"]: item for item in comparison["metrics"]}
    checks: list[dict[str, Any]] = []

    def values(metric: str) -> tuple[float | None, float | None]:
        item = metric_values.get(metric)
        if item is None:
            raise ValueError(f"unsupported quality gate metric: {metric}")
        return item["baseline"], item["candidate"]

    for metric, threshold in max_metric_regressions.items():
        baseline_value, candidate_value = values(metric)
        actual = (
            baseline_value - candidate_value
            if baseline_value is not None and candidate_value is not None
            else None
        )
        passed = actual is not None and actual <= threshold
        checks.append(
            {
                "metric": metric,
                "rule": "max_regression",
                "threshold": threshold,
                "baseline": baseline_value,
                "candidate": candidate_value,
                "actual": actual,
                "passed": passed,
                "reason": (
                    "metric regression is within tolerance"
                    if passed
                    else "metric is missing or regression exceeds tolerance"
                ),
            }
        )

    for metric, threshold in minimum_candidate_metrics.items():
        baseline_value, candidate_value = values(metric)
        passed = candidate_value is not None and candidate_value >= threshold
        checks.append(
            {
                "metric": metric,
                "rule": "minimum_candidate",
                "threshold": threshold,
                "baseline": baseline_value,
                "candidate": candidate_value,
                "actual": candidate_value,
                "passed": passed,
                "reason": (
                    "candidate metric meets minimum"
                    if passed
                    else "candidate metric is missing or below minimum"
                ),
            }
        )

    for metric, threshold in max_latency_increase_ratios.items():
        baseline_value, candidate_value = values(metric)
        actual = (
            (candidate_value - baseline_value) / baseline_value
            if baseline_value is not None
            and candidate_value is not None
            and baseline_value > 0
            else None
        )
        passed = actual is not None and actual <= threshold
        checks.append(
            {
                "metric": metric,
                "rule": "max_increase_ratio",
                "threshold": threshold,
                "baseline": baseline_value,
                "candidate": candidate_value,
                "actual": actual,
                "passed": passed,
                "reason": (
                    "latency increase is within tolerance"
                    if passed
                    else "latency is missing or increase exceeds tolerance"
                ),
            }
        )

    if require_zero_failed_cases:
        baseline_value, candidate_value = values("failed_cases")
        passed = candidate_value == 0.0
        checks.append(
            {
                "metric": "failed_cases",
                "rule": "maximum_candidate",
                "threshold": 0.0,
                "baseline": baseline_value,
                "candidate": candidate_value,
                "actual": candidate_value,
                "passed": passed,
                "reason": (
                    "candidate has no failed cases"
                    if passed
                    else "candidate contains failed cases"
                ),
            }
        )

    return {
        "passed": all(check["passed"] for check in checks),
        "comparison": comparison,
        "checks": checks,
    }
