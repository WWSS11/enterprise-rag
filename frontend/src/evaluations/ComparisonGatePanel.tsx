import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type {
  EvaluationQualityGateCheck,
  EvaluationQualityGateReport,
  EvaluationQualityGateThresholds,
  EvaluationRun,
  EvaluationRunComparison,
} from "@/api/types";
import {
  DEFAULT_EVALUATION_QUALITY_GATE_THRESHOLDS,
  evaluationQualityGateThresholdsSchema,
} from "@/api/types";
import type { AppLocale } from "@/i18n";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/Button";
import { OperationError } from "@/components/OperationError";
import { RequestId } from "@/components/RequestId";
import { StatusPill } from "@/components/StatusPill";
import {
  COMPARABLE_METRIC_KEYS,
  classifyMetricChange,
  formatMetricValue,
  formatRelativeDelta,
  metricLabel,
} from "./metrics";
import styles from "@/pages/EvaluationConsole.module.css";

const runIdSchema = z.string().uuid();
const ALLOWED_THRESHOLD_KEYS = new Set([
  "max_metric_regressions",
  "minimum_candidate_metrics",
  "max_latency_increase_ratios",
  "require_zero_failed_cases",
]);

type GateResult = {
  report: EvaluationQualityGateReport;
  requestId: string | null;
  conflict: boolean;
};

type Versioned<T> = {
  candidateVersion: string;
  value: T;
};

type GateFailure = Versioned<unknown> & {
  thresholds?: EvaluationQualityGateThresholds;
};

function formatGateCheckValue(
  locale: AppLocale,
  check: EvaluationQualityGateCheck,
  field: "threshold" | "baseline" | "candidate" | "actual",
  unavailable: string,
): string {
  const value = check[field];
  if (check.rule === "max_increase_ratio" && (field === "threshold" || field === "actual")) {
    return formatRelativeDelta(locale, value, unavailable);
  }
  return formatMetricValue(locale, check.metric, value, unavailable);
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "—";
  } catch {
    return "—";
  }
}

function validateThresholdJson(
  value: string,
  invalidMessage: string,
  toleranceMessage: string,
  unsupportedMessage: (metric: string) => string,
): { thresholds?: EvaluationQualityGateThresholds; error?: string } {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(value);
  } catch {
    return { error: invalidMessage };
  }
  if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
    return { error: invalidMessage };
  }
  const raw = parsedJson as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !ALLOWED_THRESHOLD_KEYS.has(key))) {
    return { error: invalidMessage };
  }
  const parsed = evaluationQualityGateThresholdsSchema.safeParse(raw);
  if (!parsed.success) return { error: invalidMessage };

  for (const mapping of [
    parsed.data.max_metric_regressions,
    parsed.data.minimum_candidate_metrics,
    parsed.data.max_latency_increase_ratios,
  ]) {
    if (!mapping) continue;
    const unsupported = Object.keys(mapping).find((key) => !COMPARABLE_METRIC_KEYS.has(key));
    if (unsupported) return { error: unsupportedMessage(unsupported) };
  }
  for (const mapping of [
    parsed.data.max_metric_regressions,
    parsed.data.max_latency_increase_ratios,
  ]) {
    if (mapping && Object.values(mapping).some((threshold) => threshold < 0)) {
      return { error: toleranceMessage };
    }
  }
  return { thresholds: parsed.data };
}

function ComparisonTable({ comparison }: { comparison: EvaluationRunComparison }) {
  const { t, i18n } = useTranslation(["evaluationRuns", "qualityGates"]);
  const locale = i18n.language as AppLocale;
  const unavailable = t("evaluationRuns:valueUnavailable");

  return (
    <div className={styles.comparisonResult}>
      <div className={styles.tableScroll}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>{t("qualityGates:checkMetric")}</th>
              <th>{t("evaluationRuns:baselineValue")}</th>
              <th>{t("evaluationRuns:candidateValue")}</th>
              <th>{t("evaluationRuns:delta")}</th>
              <th>{t("evaluationRuns:relativeDelta")}</th>
              <th>{t("qualityGates:checkResult")}</th>
            </tr>
          </thead>
          <tbody>
            {comparison.metrics.map((metric) => {
              const classification = classifyMetricChange(
                metric.metric,
                metric.baseline,
                metric.candidate,
                metric.delta,
              );
              const presentation =
                classification === "improved"
                  ? { label: t("evaluationRuns:improvement"), marker: "▲", className: styles.improved }
                  : classification === "regressed"
                    ? { label: t("evaluationRuns:regression"), marker: "▼", className: styles.regressed }
                    : classification === "unchanged"
                      ? { label: t("evaluationRuns:unchanged"), marker: "—", className: styles.unchanged }
                      : { label: t("evaluationRuns:notComparable"), marker: "○", className: styles.notComparable };
              return (
                <tr key={metric.metric}>
                  <th scope="row">
                    <span>{metricLabel(t, metric.metric)}</span>
                    <code title={t("evaluationRuns:metricRawKeyTitle", { metric: metric.metric })}>
                      {metric.metric}
                    </code>
                  </th>
                  <td className={styles.monoMetric}>{formatMetricValue(locale, metric.metric, metric.baseline, unavailable)}</td>
                  <td className={styles.monoMetric}>{formatMetricValue(locale, metric.metric, metric.candidate, unavailable)}</td>
                  <td className={styles.monoMetric}>{formatMetricValue(locale, metric.metric, metric.delta, unavailable)}</td>
                  <td className={styles.monoMetric}>{formatRelativeDelta(locale, metric.relative_delta, unavailable)}</td>
                  <td>
                    <span className={`${styles.changeLabel} ${presentation.className}`}>
                      <span aria-hidden="true">{presentation.marker}</span>
                      {presentation.label}
                    </span>
                    {classification === "not-comparable" ? (
                      <span className={styles.tableHint}>{t("evaluationRuns:notComparableDetail")}</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={styles.resultSection}>
        <h3>{t("evaluationRuns:configDifferences")}</h3>
        {comparison.config_differences.length === 0 ? (
          <p className={styles.muted}>{t("evaluationRuns:noConfigDifferences")}</p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>{t("evaluationRuns:configKey")}</th>
                  <th>{t("evaluationRuns:baselineValue")}</th>
                  <th>{t("evaluationRuns:candidateValue")}</th>
                </tr>
              </thead>
              <tbody>
                {comparison.config_differences.map((difference) => (
                  <tr key={difference.key}>
                    <th scope="row"><code>{difference.key}</code></th>
                    <td><pre className={styles.compactJson}>{json(difference.baseline)}</pre></td>
                    <td><pre className={styles.compactJson}>{json(difference.candidate)}</pre></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function GateReport({ result }: { result: GateResult }) {
  const { t, i18n } = useTranslation(["qualityGates", "evaluationRuns"]);
  const locale = i18n.language as AppLocale;
  const unavailable = t("qualityGates:valueUnavailable");

  return (
    <section className={styles.gateReport} aria-labelledby="quality-gate-result-title">
      <div className={styles.sectionHeader}>
        <div>
          <h3 id="quality-gate-result-title">
            {result.report.passed ? t("qualityGates:gatePassed") : t("qualityGates:gateFailed")}
          </h3>
          <p>
            {result.report.passed
              ? t("qualityGates:gatePassedDetail")
              : t("qualityGates:gateFailedDetail")}
          </p>
        </div>
        <StatusPill
          tone={result.report.passed ? "ok" : "error"}
          label={result.report.passed ? t("qualityGates:checkPassed") : t("qualityGates:checkFailed")}
        />
      </div>
      {result.conflict ? <p className={styles.notice}>{t("qualityGates:gateConflictDetail")}</p> : null}
      <RequestId requestId={result.requestId} />

      <div className={styles.tableScroll}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>{t("qualityGates:checkMetric")}</th>
              <th>{t("qualityGates:checkRule")}</th>
              <th>{t("qualityGates:checkThreshold")}</th>
              <th>{t("qualityGates:checkBaseline")}</th>
              <th>{t("qualityGates:checkCandidate")}</th>
              <th>{t("qualityGates:checkActual")}</th>
              <th>{t("qualityGates:checkResult")}</th>
              <th>{t("qualityGates:checkReason")}</th>
            </tr>
          </thead>
          <tbody>
            {result.report.checks.map((check, index) => {
              const rule =
                check.rule === "max_regression"
                  ? t("qualityGates:ruleMaxRegression")
                  : check.rule === "minimum_candidate"
                    ? t("qualityGates:ruleMinimumCandidate")
                    : check.rule === "max_increase_ratio"
                      ? t("qualityGates:ruleMaxIncreaseRatio")
                      : check.rule === "maximum_candidate"
                        ? t("qualityGates:ruleMaximumCandidate")
                        : t("qualityGates:ruleUnknown", { rule: check.rule });
              return (
                <tr key={`${check.metric}-${check.rule}-${index}`} className={!check.passed ? styles.failedRow : undefined}>
                  <th scope="row">
                    <span>{metricLabel(t, check.metric)}</span>
                    <code>{check.metric}</code>
                  </th>
                  <td>{rule}</td>
                  <td className={styles.monoMetric}>{formatGateCheckValue(locale, check, "threshold", unavailable)}</td>
                  <td className={styles.monoMetric}>{formatGateCheckValue(locale, check, "baseline", unavailable)}</td>
                  <td className={styles.monoMetric}>{formatGateCheckValue(locale, check, "candidate", unavailable)}</td>
                  <td className={styles.monoMetric}>{formatGateCheckValue(locale, check, "actual", unavailable)}</td>
                  <td>
                    <span className={`${styles.changeLabel} ${check.passed ? styles.improved : styles.regressed}`}>
                      <span aria-hidden="true">{check.passed ? "●" : "■"}</span>
                      {check.passed ? t("qualityGates:checkPassed") : t("qualityGates:checkFailed")}
                    </span>
                  </td>
                  <td>
                    <span>{check.reason}</span>
                    <code className={styles.rawReason} title={t("qualityGates:rawReasonTitle", { reason: check.reason })}>
                      {check.reason}
                    </code>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {result.report.checks.length === 0 ? (
        <p className={styles.muted}>{t("qualityGates:checksEmpty")}</p>
      ) : null}

      <div className={styles.resultSection}>
        <h3>{t("qualityGates:comparisonTitle")}</h3>
        <ComparisonTable comparison={result.report.comparison} />
      </div>
    </section>
  );
}

export function ComparisonGatePanel({ candidateRun }: { candidateRun: EvaluationRun }) {
  const { t } = useTranslation(["evaluationRuns", "qualityGates"]);
  const { api } = useAuth();
  const [baselineRunId, setBaselineRunId] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<Versioned<EvaluationRunComparison> | null>(null);
  const [comparisonError, setComparisonError] = useState<Versioned<unknown> | null>(null);
  const [gateResult, setGateResult] = useState<Versioned<GateResult> | null>(null);
  const [gateError, setGateError] = useState<GateFailure | null>(null);
  const [comparing, setComparing] = useState(false);
  const [gating, setGating] = useState(false);
  const [advancedJson, setAdvancedJson] = useState(() =>
    JSON.stringify(DEFAULT_EVALUATION_QUALITY_GATE_THRESHOLDS, null, 2),
  );
  const [advancedError, setAdvancedError] = useState<string | null>(null);

  async function loadBaseline(): Promise<EvaluationRun | null> {
    setValidationError(null);
    const parsed = runIdSchema.safeParse(baselineRunId.trim());
    if (!baselineRunId.trim()) {
      setValidationError(t("qualityGates:validationBaselineRequired"));
      return null;
    }
    if (!parsed.success) {
      setValidationError(t("qualityGates:validationRunUuid"));
      return null;
    }
    if (parsed.data === candidateRun.id) {
      setValidationError(t("qualityGates:validationDistinctRuns"));
      return null;
    }
    const baseline = await api.getEvaluationRun(parsed.data);
    if (baseline.dataset_id !== candidateRun.dataset_id) {
      setValidationError(t("qualityGates:validationSameDataset"));
      return null;
    }
    if (baseline.status !== "succeeded" || candidateRun.status !== "succeeded") {
      setValidationError(t("qualityGates:validationSucceededOnly"));
      return null;
    }
    return baseline;
  }

  async function compare() {
    const candidateVersion = candidateRun.updated_at;
    setComparisonError(null);
    setComparison(null);
    setComparing(true);
    try {
      const baseline = await loadBaseline();
      if (!baseline) return;
      const result = await api.compareEvaluationRuns(candidateRun.id, {
        baseline_run_id: baseline.id,
      });
      setComparison({ candidateVersion, value: result });
    } catch (error) {
      setComparisonError({ candidateVersion, value: error });
    } finally {
      setComparing(false);
    }
  }

  async function gate(thresholds?: EvaluationQualityGateThresholds) {
    const candidateVersion = candidateRun.updated_at;
    setGateError(null);
    setGateResult(null);
    setGating(true);
    try {
      const baseline = await loadBaseline();
      if (!baseline) return;
      const result = await api.gateEvaluationRun(
        candidateRun.id,
        thresholds
          ? { baseline_run_id: baseline.id, thresholds }
          : { baseline_run_id: baseline.id },
      );
      setGateResult({
        candidateVersion,
        value: {
          report: result.report,
          requestId: result.request_id,
          conflict: result.conflict,
        },
      });
    } catch (error) {
      setGateError({ candidateVersion, value: error, thresholds });
    } finally {
      setGating(false);
    }
  }

  function gateAdvanced() {
    const parsed = validateThresholdJson(
      advancedJson,
      t("qualityGates:errorValidation"),
      t("qualityGates:validationToleranceNonNegative"),
      (metric) => t("qualityGates:validationUnsupportedMetric", { metric }),
    );
    setAdvancedError(parsed.error ?? null);
    if (parsed.thresholds) void gate(parsed.thresholds);
  }

  const currentComparison =
    comparison?.candidateVersion === candidateRun.updated_at ? comparison.value : null;
  const currentComparisonError =
    comparisonError?.candidateVersion === candidateRun.updated_at ? comparisonError.value : null;
  const currentGateResult =
    gateResult?.candidateVersion === candidateRun.updated_at ? gateResult.value : null;
  const currentGateError =
    gateError?.candidateVersion === candidateRun.updated_at ? gateError : null;

  return (
    <section className={styles.panel} aria-labelledby="comparison-gate-title">
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.kicker}>{t("qualityGates:kicker")}</div>
          <h2 id="comparison-gate-title">{t("evaluationRuns:compareTitle")}</h2>
          <p>{t("evaluationRuns:compareSubtitle")}</p>
        </div>
      </div>

      <div className={styles.formField}>
        <label htmlFor="baseline-run-id">{t("qualityGates:baselineRunId")}</label>
        <input
          id="baseline-run-id"
          value={baselineRunId}
          onChange={(event) => setBaselineRunId(event.target.value)}
          placeholder={t("qualityGates:baselinePlaceholder")}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {validationError ? <p className={styles.validation} role="alert">{validationError}</p> : null}

      <div className={styles.actionRow}>
        <Button type="button" variant="secondary" disabled={comparing || gating} onClick={() => void compare()}>
          {comparing ? t("evaluationRuns:comparing") : t("evaluationRuns:compare")}
        </Button>
        <Button type="button" disabled={gating || comparing} onClick={() => void gate()}>
          {gating ? t("qualityGates:runningGate") : t("qualityGates:runGate")}
        </Button>
      </div>

      <details className={styles.advancedDetails}>
        <summary>{t("qualityGates:advancedThresholds")}</summary>
        <p>{t("qualityGates:advancedThresholdsDetail")}</p>
        <textarea
          className={styles.jsonEditor}
          value={advancedJson}
          onChange={(event) => setAdvancedJson(event.target.value)}
          rows={18}
          spellCheck={false}
          aria-label={t("qualityGates:advancedThresholds")}
        />
        {advancedError ? <p className={styles.validation} role="alert">{advancedError}</p> : null}
        <div className={styles.actionRow}>
          <Button type="button" variant="secondary" disabled={gating || comparing} onClick={gateAdvanced}>
            {gating ? t("qualityGates:runningGate") : t("qualityGates:runGate")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setAdvancedJson(JSON.stringify(DEFAULT_EVALUATION_QUALITY_GATE_THRESHOLDS, null, 2));
              setAdvancedError(null);
            }}
          >
            {t("qualityGates:resetDefaults")}
          </Button>
        </div>
      </details>

      {currentComparisonError ? <OperationError error={currentComparisonError} onRetry={() => void compare()} /> : null}
      {currentGateError ? (
        <OperationError
          error={currentGateError.value}
          onRetry={() => void gate(currentGateError.thresholds)}
        />
      ) : null}
      {currentComparison ? (
        <div className={styles.resultSection}>
          <h3>{t("evaluationRuns:compareTitle")}</h3>
          <ComparisonTable comparison={currentComparison} />
        </div>
      ) : null}
      {currentGateResult ? <GateReport result={currentGateResult} /> : null}
    </section>
  );
}
