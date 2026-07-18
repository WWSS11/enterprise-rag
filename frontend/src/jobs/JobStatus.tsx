import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AppLocale } from "@/i18n";
import { formatDateTime } from "@/i18n/format";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/Button";
import { OperationError } from "@/components/OperationError";
import { StatusPill, type StatusTone } from "@/components/StatusPill";
import { usePageVisibility } from "@/hooks/usePageVisibility";
import type { Job } from "@/api/types";
import styles from "./JobStatus.module.css";

const TERMINAL_STATUSES = new Set(["succeeded", "failed"]);

function statusPresentation(
  status: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): { label: string; tone: StatusTone } {
  if (status === "queued") return { label: t("jobs:statusQueued"), tone: "loading" };
  if (status === "running") return { label: t("jobs:statusRunning"), tone: "loading" };
  if (status === "succeeded") return { label: t("jobs:statusSucceeded"), tone: "ok" };
  if (status === "failed") return { label: t("jobs:statusFailed"), tone: "error" };
  return { label: t("jobs:statusUnknown", { status }), tone: "unknown" };
}

function typeLabel(
  type: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (type === "document_ingestion") return t("jobs:typeIngestion");
  if (type === "document_reindex") return t("jobs:typeReindex");
  if (type === "document_deletion") return t("jobs:typeDeletion");
  if (type === "local_document_scan") return t("jobs:typeScan");
  if (type === "vector_index_rebuild") return t("jobs:typeRebuild");
  return t("jobs:typeUnknown", { type });
}

export function JobStatus({
  jobId,
  onForget,
  onTerminal,
}: {
  jobId: string;
  onForget?: () => void;
  onTerminal?: (job: Job) => void;
}) {
  const { t, i18n } = useTranslation(["jobs", "common"]);
  const { api } = useAuth();
  const visible = usePageVisibility();
  const job = useQuery({
    queryKey: ["jobs", jobId],
    queryFn: () => api.getJob(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return visible && (!status || !TERMINAL_STATUSES.has(status)) ? 2500 : false;
    },
    refetchIntervalInBackground: false,
  });
  const notifiedTerminalJobRef = useRef<string | null>(null);
  const locale = i18n.language as AppLocale;

  useEffect(() => {
    if (!job.data || !TERMINAL_STATUSES.has(job.data.status)) return;
    const notificationKey = `${job.data.id}:${job.data.status}:${job.data.updated_at}`;
    if (notifiedTerminalJobRef.current === notificationKey) return;
    notifiedTerminalJobRef.current = notificationKey;
    onTerminal?.(job.data);
  }, [job.data, onTerminal]);

  if (job.isLoading) {
    return (
      <article className={styles.root} aria-busy="true">
        <code>{jobId}</code>
        <p>{t("jobs:loading")}</p>
      </article>
    );
  }

  if (job.isError) {
    return (
      <article className={styles.root}>
        <code>{jobId}</code>
        <OperationError error={job.error} onRetry={() => void job.refetch()} />
        {onForget ? (
          <Button type="button" variant="ghost" onClick={onForget}>
            {t("jobs:forget")}
          </Button>
        ) : null}
      </article>
    );
  }

  if (!job.data) return null;
  const status = statusPresentation(job.data.status, t);
  const active = !TERMINAL_STATUSES.has(job.data.status);

  return (
    <article className={styles.root} aria-labelledby={`job-${job.data.id}`}>
      <header className={styles.header}>
        <div>
          <div className={styles.label}>{t("jobs:type")}</div>
          <h3 id={`job-${job.data.id}`}>{typeLabel(job.data.job_type, t)}</h3>
        </div>
        <StatusPill tone={status.tone} label={status.label} />
      </header>

      <div className={styles.progressLine}>
        <label htmlFor={`job-progress-${job.data.id}`}>{t("jobs:progress")}</label>
        <strong>{job.data.progress}%</strong>
      </div>
      <progress
        id={`job-progress-${job.data.id}`}
        className={styles.progress}
        max={100}
        value={job.data.progress}
      />

      <dl className={styles.facts}>
        <div>
          <dt>{t("jobs:jobId")}</dt>
          <dd><code>{job.data.id}</code></dd>
        </div>
        {job.data.task_id ? (
          <div>
            <dt>{t("jobs:taskId")}</dt>
            <dd><code>{job.data.task_id}</code></dd>
          </div>
        ) : null}
        {job.data.document_id ? (
          <div>
            <dt>{t("jobs:documentId")}</dt>
            <dd><code>{job.data.document_id}</code></dd>
          </div>
        ) : null}
        <div>
          <dt>{t("jobs:updatedAt")}</dt>
          <dd>{formatDateTime(locale, job.data.updated_at)}</dd>
        </div>
      </dl>

      {!visible && active ? <p className={styles.note}>{t("jobs:pollingPaused")}</p> : null}
      {job.data.status === "failed" ? (
        <div className={styles.failure} role="alert">
          <strong>{t("jobs:failureReason")}</strong>
          <p>{job.data.error_message || "—"}</p>
          <p>{t("jobs:noRetry")}</p>
        </div>
      ) : null}
      {onForget ? (
        <div className={styles.actions}>
          <Button type="button" variant="ghost" onClick={onForget}>
            {t("jobs:forget")}
          </Button>
        </div>
      ) : null}
    </article>
  );
}
