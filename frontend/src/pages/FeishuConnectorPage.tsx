import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { ConnectorCheck, Job } from "@/api/types";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/Button";
import { OperationError } from "@/components/OperationError";
import { StatusPill, type StatusTone } from "@/components/StatusPill";
import type { AppLocale } from "@/i18n";
import { formatDateTime } from "@/i18n/format";
import { JobStatus } from "@/jobs/JobStatus";
import styles from "./FeishuConnectorPage.module.css";

const CHECK_LABELS: Record<string, string> = {
  enabled: "checkEnabled",
  credentials: "checkCredentials",
  space: "checkSpace",
  knowledge_base: "checkKnowledgeBase",
  connectivity: "checkConnectivity",
};

const CHECK_STATUS: Record<string, { key: string; tone: StatusTone }> = {
  passed: { key: "checkPassed", tone: "ok" },
  failed: { key: "checkFailed", tone: "error" },
  warning: { key: "checkWarning", tone: "degraded" },
  skipped: { key: "checkSkipped", tone: "unknown" },
};

const STAT_LABELS: Record<string, string> = {
  remote: "statRemote",
  enqueued: "statEnqueued",
  unchanged: "statUnchanged",
  busy: "statBusy",
  deleted: "statDeleted",
  unsupported: "statUnsupported",
  ingestion_jobs: "statIngestionJobs",
  deletion_jobs: "statDeletionJobs",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function primitive(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function CheckList({ checks }: { checks: ConnectorCheck[] }) {
  const { t } = useTranslation("connectors");

  return (
    <ul className={styles.checkList}>
      {checks.map((check) => {
        const presentation = CHECK_STATUS[check.status] ?? CHECK_STATUS.skipped;
        const details = asRecord(check.details);
        return (
          <li key={check.key} className={styles.checkItem}>
            <div className={styles.checkHead}>
              <strong>{t(CHECK_LABELS[check.key] ?? check.key)}</strong>
              <StatusPill tone={presentation.tone} label={t(presentation.key)} />
            </div>
            <p>{check.message}</p>
            {check.error_code !== null || check.log_id || (details && Object.keys(details).length > 0) ? (
              <dl className={styles.inlineFacts}>
                {check.error_code !== null ? (
                  <div><dt>{t("errorCode")}</dt><dd><code>{check.error_code}</code></dd></div>
                ) : null}
                {check.log_id ? (
                  <div><dt>{t("logId")}</dt><dd><code>{check.log_id}</code></dd></div>
                ) : null}
                {primitive(details?.operation) ? (
                  <div><dt>{t("operation")}</dt><dd><code>{primitive(details?.operation)}</code></dd></div>
                ) : null}
                {typeof details?.retryable === "boolean" ? (
                  <div><dt>{t("retryable")}</dt><dd>{details.retryable ? t("yes") : t("no")}</dd></div>
                ) : null}
              </dl>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function JobResult({ job }: { job: Job }) {
  const { t } = useTranslation("connectors");
  const failure = asRecord(job.result.failure);
  const stats = Object.entries(STAT_LABELS)
    .map(([key, label]) => ({ key, label, value: primitive(job.result[key]) }))
    .filter((entry) => entry.value !== null);
  const failureEntries = failure
    ? [
        "category",
        "message",
        "operation",
        "error_code",
        "code",
        "log_id",
        "retryable",
        "error_type",
      ]
        .map((key) => ({ key, value: primitive(failure[key]) }))
        .filter((entry) => entry.value !== null)
    : [];

  if (stats.length === 0 && failureEntries.length === 0) return null;

  return (
    <div className={styles.jobResult}>
      {stats.length > 0 ? (
        <div>
          <strong>{t("result")}</strong>
          <dl className={styles.statGrid}>
            {stats.map((entry) => (
              <div key={entry.key}><dt>{t(entry.label)}</dt><dd>{entry.value}</dd></div>
            ))}
          </dl>
        </div>
      ) : null}
      {failureEntries.length > 0 ? (
        <div className={styles.failure} role="alert">
          <strong>{t("failure")}</strong>
          <dl className={styles.inlineFacts}>
            {failureEntries.map((entry) => (
              <div key={entry.key}><dt>{entry.key}</dt><dd><code>{entry.value}</code></dd></div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

export function FeishuConnectorPage() {
  const { t, i18n } = useTranslation(["connectors", "common"]);
  const { api, identity } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = Boolean(identity?.is_admin);
  const locale = i18n.language as AppLocale;
  const status = useQuery({
    queryKey: ["connectors", "feishu"],
    queryFn: () => api.getFeishuConnector(),
    enabled: isAdmin,
    refetchInterval: (query) => query.state.data?.active_job ? 5_000 : false,
  });
  const history = useQuery({
    queryKey: ["jobs", "history", "feishu_sync"],
    queryFn: () => api.listJobs({ jobType: "feishu_sync", limit: 10, offset: 0 }),
    enabled: isAdmin,
    refetchInterval: (query) => query.state.data?.items.some(
      (job) => job.status === "queued" || job.status === "running",
    ) ? 5_000 : false,
  });
  const diagnose = useMutation({
    mutationFn: () => api.diagnoseFeishuConnector(),
  });
  const sync = useMutation({
    mutationFn: () => api.startFeishuSync(),
    onSuccess: (job) => {
      queryClient.setQueryData(["jobs", job.id], job);
      void queryClient.invalidateQueries({ queryKey: ["connectors", "feishu"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs", "history", "feishu_sync"] });
    },
  });

  if (identity && !identity.is_admin) return <Navigate to="/403" replace />;

  const connector = status.data;
  const checks = diagnose.data?.checks ?? connector?.checks ?? [];
  const activeJob = sync.data && ["queued", "running"].includes(sync.data.status)
    ? sync.data
    : connector?.active_job;
  const refresh = () => {
    void status.refetch();
    void history.refetch();
  };
  const activeJobFinished = () => {
    sync.reset();
    refresh();
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className={styles.kicker}>{t("kicker")}</div>
          <h1>{t("title")}</h1>
          <p>{t("lead")}</p>
        </div>
        <Button type="button" variant="secondary" onClick={refresh}>
          {t("refresh")}
        </Button>
      </header>

      {status.isLoading ? <p className={styles.loading} aria-busy="true">{t("common:loading")}</p> : null}
      {status.isError ? <OperationError error={status.error} onRetry={() => void status.refetch()} /> : null}

      {connector ? (
        <>
          <section className={styles.card} aria-labelledby="feishu-configuration-title">
            <div className={styles.cardHead}>
              <h2 id="feishu-configuration-title">{t("configuration")}</h2>
              <StatusPill
                tone={connector.ready ? "ok" : "error"}
                label={connector.ready ? t("statusReady") : t("statusNotReady")}
              />
            </div>
            <dl className={styles.configGrid}>
              <div><dt>{t("enabled")}</dt><dd>{connector.enabled ? t("enabled") : t("disabled")}</dd></div>
              <div><dt>{t("tenant")}</dt><dd><code>{connector.tenant_id}</code></dd></div>
              <div><dt>{t("space")}</dt><dd><code>{connector.space_id ?? "—"}</code></dd></div>
              <div><dt>{t("knowledgeBase")}</dt><dd>{connector.knowledge_base_name ?? "—"}</dd></div>
              <div><dt>{t("runAsUser")}</dt><dd><code>{connector.run_as_user}</code></dd></div>
              <div><dt>{t("appId")}</dt><dd>{connector.app_id_configured ? t("configured") : t("missing")}</dd></div>
              <div><dt>{t("appSecret")}</dt><dd>{connector.app_secret_configured ? t("configured") : t("missing")}</dd></div>
            </dl>
          </section>

          <section className={styles.card} aria-labelledby="feishu-checks-title">
            <div className={styles.cardHead}>
              <h2 id="feishu-checks-title">{t("checks")}</h2>
              <Button
                type="button"
                variant="secondary"
                disabled={diagnose.isPending}
                onClick={() => diagnose.mutate()}
              >
                {diagnose.isPending ? t("diagnosing") : t("diagnose")}
              </Button>
            </div>
            {diagnose.data ? (
              <div className={diagnose.data.status === "passed" ? styles.successNote : styles.failureNote} role="status">
                <strong>{diagnose.data.status === "passed" ? t("diagnosisPassed") : t("diagnosisFailed")}</strong>
                <span>{t("checkedAt")}: {formatDateTime(locale, diagnose.data.checked_at)}</span>
              </div>
            ) : null}
            {diagnose.isError ? <OperationError error={diagnose.error} /> : null}
            <CheckList checks={checks} />
          </section>

          <section className={styles.card} aria-labelledby="feishu-sync-title">
            <div className={styles.cardHead}>
              <div>
                <h2 id="feishu-sync-title">{t("manualSync")}</h2>
                <p className={styles.muted}>{t("syncDetail")}</p>
              </div>
              <Button
                type="button"
                disabled={!connector.ready || Boolean(activeJob) || sync.isPending}
                onClick={() => sync.mutate()}
              >
                {sync.isPending ? t("startingSync") : t("manualSync")}
              </Button>
            </div>
            {!connector.ready ? <p className={styles.warning}>{t("syncNotReady")}</p> : null}
            {sync.isError ? <OperationError error={sync.error} /> : null}
            {activeJob ? (
              <div className={styles.activeJob}>
                <h3>{t("activeSync")}</h3>
                <JobStatus
                  jobId={activeJob.id}
                  initialJob={activeJob}
                  canControl
                  onTerminal={activeJobFinished}
                  onChanged={refresh}
                />
              </div>
            ) : null}
          </section>

          <section className={styles.card} aria-labelledby="feishu-history-title">
            <div className={styles.cardHead}>
              <h2 id="feishu-history-title">{t("recentRuns")}</h2>
              <Link className={styles.textLink} to="/app/jobs">{t("openJobs")}</Link>
            </div>
            {history.isError ? <OperationError error={history.error} onRetry={() => void history.refetch()} /> : null}
            {history.isLoading ? <p className={styles.loading} aria-busy="true">{t("common:loading")}</p> : null}
            {history.data?.items.length === 0 ? <p className={styles.muted}>{t("noRuns")}</p> : null}
            {history.data?.items.length ? (
              <div className={styles.historyList}>
                {history.data.items.map((job) => (
                  <div key={job.id} className={styles.historyItem}>
                    <JobStatus
                      jobId={job.id}
                      initialJob={job}
                      canControl
                      onTerminal={() => void history.refetch()}
                      onChanged={refresh}
                    />
                    <JobResult job={job} />
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
