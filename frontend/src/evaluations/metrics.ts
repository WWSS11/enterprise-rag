import type { AppLocale } from "@/i18n";
import { formatLatencyMs, formatNumber, formatPercent } from "@/i18n/format";

export type MetricFormat = "percent" | "latency" | "count" | "number";

export type MetricDefinition = {
  key: string;
  labelKey: string;
  format: MetricFormat;
};

export const SUMMARY_METRICS: readonly MetricDefinition[] = [
  { key: "retrieval_recall_at_k", labelKey: "evaluationRuns:metricRetrievalRecallAtK", format: "percent" },
  { key: "retrieval_mrr", labelKey: "evaluationRuns:metricRetrievalMrr", format: "number" },
  { key: "rerank_recall_at_k", labelKey: "evaluationRuns:metricRerankRecallAtK", format: "percent" },
  { key: "rerank_mrr", labelKey: "evaluationRuns:metricRerankMrr", format: "number" },
  { key: "citation_precision", labelKey: "evaluationRuns:metricCitationPrecision", format: "percent" },
  { key: "citation_recall", labelKey: "evaluationRuns:metricCitationRecall", format: "percent" },
  { key: "key_point_coverage", labelKey: "evaluationRuns:metricKeyPointCoverage", format: "percent" },
  { key: "key_point_group_coverage", labelKey: "evaluationRuns:metricKeyPointGroupCoverage", format: "percent" },
  { key: "citation_grounded_key_point_coverage", labelKey: "evaluationRuns:metricCitationGroundedKeyPointCoverage", format: "percent" },
  { key: "citation_key_point_support_rate", labelKey: "evaluationRuns:metricCitationKeyPointSupportRate", format: "percent" },
  { key: "citation_required_point_support_precision", labelKey: "evaluationRuns:metricCitationRequiredPointSupportPrecision", format: "percent" },
  { key: "refusal_accuracy", labelKey: "evaluationRuns:metricRefusalAccuracy", format: "percent" },
  { key: "rerank_fallback_rate", labelKey: "evaluationRuns:metricRerankFallbackRate", format: "percent" },
  { key: "rerank_retry_rate", labelKey: "evaluationRuns:metricRerankRetryRate", format: "percent" },
  { key: "citation_marker_validity_rate", labelKey: "evaluationRuns:metricCitationMarkerValidityRate", format: "percent" },
  { key: "citation_duplicate_marker_rate", labelKey: "evaluationRuns:metricCitationDuplicateMarkerRate", format: "percent" },
  { key: "citation_policy_compliance_rate", labelKey: "evaluationRuns:metricCitationPolicyComplianceRate", format: "percent" },
  { key: "citation_invalid_markers", labelKey: "evaluationRuns:metricCitationInvalidMarkers", format: "count" },
  { key: "citation_ambiguous_markers", labelKey: "evaluationRuns:metricCitationAmbiguousMarkers", format: "count" },
  { key: "citation_imprecise_markers", labelKey: "evaluationRuns:metricCitationImpreciseMarkers", format: "count" },
  { key: "citation_repeated_markers", labelKey: "evaluationRuns:metricCitationRepeatedMarkers", format: "count" },
  { key: "average_first_token_ms", labelKey: "evaluationRuns:metricAverageFirstTokenMs", format: "latency" },
  { key: "average_total_latency_ms", labelKey: "evaluationRuns:metricAverageTotalLatencyMs", format: "latency" },
  { key: "succeeded_cases", labelKey: "evaluationRuns:metricSucceededCases", format: "count" },
  { key: "failed_cases", labelKey: "evaluationRuns:metricFailedCases", format: "count" },
] as const;

export const COMPARABLE_METRIC_KEYS = new Set([
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
]);

export const LOWER_IS_BETTER_METRICS = new Set([
  "average_first_token_ms",
  "average_total_latency_ms",
  "failed_cases",
  "rerank_fallback_rate",
  "rerank_retry_rate",
  "citation_duplicate_marker_rate",
]);

const METRICS_BY_KEY = new Map(SUMMARY_METRICS.map((metric) => [metric.key, metric]));

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function metricLabel(t: Translate, key: string): string {
  const definition = METRICS_BY_KEY.get(key);
  return definition ? t(definition.labelKey) : t("evaluationRuns:metricUnknown");
}

export function numericMetric(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

export function formatMetricValue(
  locale: AppLocale,
  key: string,
  value: unknown,
  unavailable: string,
): string {
  const numeric = numericMetric(value);
  if (numeric === null) return unavailable;
  const definition = METRICS_BY_KEY.get(key);
  if (definition?.format === "percent") return formatPercent(locale, numeric, 2);
  if (definition?.format === "latency") return formatLatencyMs(locale, numeric);
  if (definition?.format === "count") {
    return formatNumber(locale, numeric, { maximumFractionDigits: 0 });
  }
  return formatNumber(locale, numeric, { maximumFractionDigits: 6 });
}

export function formatRelativeDelta(
  locale: AppLocale,
  value: number | null | undefined,
  unavailable: string,
): string {
  return typeof value === "number" && Number.isFinite(value)
    ? formatPercent(locale, value, 2)
    : unavailable;
}

export type ChangeClassification = "improved" | "regressed" | "unchanged" | "not-comparable";

export function classifyMetricChange(
  metric: string,
  baseline: number | null | undefined,
  candidate: number | null | undefined,
  delta: number | null | undefined,
): ChangeClassification {
  if (
    typeof baseline !== "number" ||
    !Number.isFinite(baseline) ||
    typeof candidate !== "number" ||
    !Number.isFinite(candidate) ||
    typeof delta !== "number" ||
    !Number.isFinite(delta)
  ) {
    return "not-comparable";
  }
  if (Math.abs(delta) <= Number.EPSILON) return "unchanged";
  const improved = LOWER_IS_BETTER_METRICS.has(metric) ? delta < 0 : delta > 0;
  return improved ? "improved" : "regressed";
}
