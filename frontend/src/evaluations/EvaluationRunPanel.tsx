import { useTranslation } from "react-i18next";
import type { EvaluationRun } from "@/api/types";
import type { AppLocale } from "@/i18n";
import { formatDateTime, formatNumber } from "@/i18n/format";
import { Button } from "@/components/Button";
import { OperationError } from "@/components/OperationError";
import { StatusPill, type StatusTone } from "@/components/StatusPill";
import styles from "@/pages/EvaluationConsole.module.css";

function statusPresentation(
  status: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): { label: string; detail: string; tone: StatusTone } {
  if (status === "queued") {
    return {
      label: t("evaluationRuns:statusQueued"),
      detail: t("evaluationRuns:queuedDetail"),
      tone: "loading",
    };
  }
  if (status === "running") {
    return {
      label: t("evaluationRuns:statusRunning"),
      detail: t("evaluationRuns:runningDetail"),
      tone: "loading",
    };
  }
  if (status === "succeeded") {
    return {
      label: t("evaluationRuns:statusSucceeded"),
      detail: t("evaluationRuns:succeededDetail"),
      tone: "ok",
    };
  }
  if (status === "failed") {
    return {
      label: t("evaluationRuns:statusFailed"),
      detail: t("evaluationRuns:failedDetail"),
      tone: "error",
    };
  }
  return {
    label: t("evaluationRuns:statusUnknown", { status }),
    detail: t("evaluationRuns:noRetry"),
    tone: "unknown",
  };
}

type EvaluationRunPanelProps = {
  run: EvaluationRun;
  visible: boolean;
  canRecalculate: boolean;
  recalculating: boolean;
  recalculateError?: unknown;
  onRecalculate: () => void;
};

export function EvaluationRunPanel({
  run,
  visible,
  canRecalculate,
  recalculating,
  recalculateError,
  onRecalculate,
}: EvaluationRunPanelProps) {
  const { t, i18n } = useTranslation(["evaluationRuns", "qualityGates", "common"]);
  const locale = i18n.language as AppLocale;
  const status = statusPresentation(run.status, t);
  const active = run.status === "queued" || run.status === "running";
  const remaining = Math.max(0, run.total_cases - run.completed_cases);

  return (
    <div className={styles.runStack}>
      <section className={styles.panel} aria-labelledby="evaluation-run-status-title">
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.kicker}>{t("evaluationRuns:kicker")}</div>
            <h1 id="evaluation-run-status-title">{t("evaluationRuns:title")}</h1>
            <p>{status.detail}</p>
          </div>
          <StatusPill tone={status.tone} label={status.label} />
        </div>

        <div className={styles.progressHeader}>
          <span>{t("evaluationRuns:progress")}</span>
          <strong>{t("evaluationRuns:progressPercent", { percent: run.progress })}</strong>
        </div>
        <progress className={styles.progress} max={100} value={run.progress} />
        <p className={styles.muted}>
          {t("evaluationRuns:progressSummary", {
            completed: run.completed_cases,
            total: run.total_cases,
            failed: run.failed_cases,
          })}
        </p>
        {!visible && active ? (
          <p className={styles.notice}>{t("evaluationRuns:pollingPaused")}</p>
        ) : null}

        <dl className={styles.factGrid}>
          <div>
            <dt>{t("evaluationRuns:runId")}</dt>
            <dd><code>{run.id}</code></dd>
          </div>
          <div>
            <dt>{t("evaluationRuns:datasetId")}</dt>
            <dd><code>{run.dataset_id}</code></dd>
          </div>
          <div>
            <dt>{t("evaluationRuns:knowledgeBaseId")}</dt>
            <dd><code>{run.knowledge_base_id}</code></dd>
          </div>
          <div>
            <dt>{t("evaluationRuns:taskId")}</dt>
            <dd><code>{run.task_id || "—"}</code></dd>
          </div>
          <div>
            <dt>{t("evaluationRuns:totalCases")}</dt>
            <dd className={styles.monoMetric}>{formatNumber(locale, run.total_cases)}</dd>
          </div>
          <div>
            <dt>{t("evaluationRuns:completedCases")}</dt>
            <dd className={styles.monoMetric}>{formatNumber(locale, run.completed_cases)}</dd>
          </div>
          <div>
            <dt>{t("evaluationRuns:failedCases")}</dt>
            <dd className={styles.monoMetric}>{formatNumber(locale, run.failed_cases)}</dd>
          </div>
          <div>
            <dt>{t("evaluationRuns:remainingCases")}</dt>
            <dd className={styles.monoMetric}>{formatNumber(locale, remaining)}</dd>
          </div>
          <div>
            <dt>{t("evaluationRuns:createdBy")}</dt>
            <dd><code>{run.created_by}</code></dd>
          </div>
          <div>
            <dt>{t("evaluationRuns:createdAt")}</dt>
            <dd>{formatDateTime(locale, run.created_at)}</dd>
          </div>
          <div>
            <dt>{t("evaluationRuns:startedAt")}</dt>
            <dd>{run.started_at ? formatDateTime(locale, run.started_at) : "—"}</dd>
          </div>
          <div>
            <dt>{t("evaluationRuns:completedAt")}</dt>
            <dd>{run.completed_at ? formatDateTime(locale, run.completed_at) : "—"}</dd>
          </div>
          <div>
            <dt>{t("evaluationRuns:updatedAt")}</dt>
            <dd>{formatDateTime(locale, run.updated_at)}</dd>
          </div>
        </dl>

        {run.error_message ? (
          <div className={styles.failure} role="alert">
            <strong>{t("evaluationRuns:errorMessage")}</strong>
            <p>{run.error_message}</p>
            <p>{t("evaluationRuns:noRetry")}</p>
          </div>
        ) : null}
      </section>

      <details className={styles.detailsPanel}>
        <summary>{t("evaluationRuns:configTitle")}</summary>
        <p>{t("evaluationRuns:configDescription")}</p>
        <pre className={styles.jsonBlock}>{JSON.stringify(run.config_snapshot, null, 2)}</pre>
      </details>

      {run.status === "succeeded" ? (
        <section className={styles.panel} aria-labelledby="recalculate-title">
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="recalculate-title">{t("qualityGates:recalculateTitle")}</h2>
              <p>{t("qualityGates:recalculateDetail")}</p>
            </div>
            {canRecalculate ? (
              <Button type="button" variant="secondary" disabled={recalculating} onClick={onRecalculate}>
                {recalculating
                  ? t("qualityGates:recalculating")
                  : t("qualityGates:recalculate")}
              </Button>
            ) : null}
          </div>
          {!canRecalculate ? (
            <p className={styles.notice}>{t("qualityGates:recalculatePermission")}</p>
          ) : null}
          {recalculateError ? <OperationError error={recalculateError} /> : null}
        </section>
      ) : null}
    </div>
  );
}
