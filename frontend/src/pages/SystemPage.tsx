import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/auth/useAuth";
import { config } from "@/config/env";
import { RequestId } from "@/components/RequestId";
import { StatusPill, type StatusTone } from "@/components/StatusPill";
import { CopyableValue } from "@/components/CopyableValue";
import { isApiError } from "@/api/errors";
import { TechnicalDetails } from "@/components/TechnicalDetails";
import { Button } from "@/components/Button";
import { OperationError } from "@/components/OperationError";
import { JobStatus } from "@/jobs/JobStatus";
import { localizeApiError } from "@/i18n/apiError";
import type { AppLocale } from "@/i18n";
import { formatDateTime } from "@/i18n/format";
import styles from "./SystemPage.module.css";

function tone(status: string | undefined, error: boolean, loading: boolean): StatusTone {
  if (loading) return "loading";
  if (error) return "error";
  if (status === "ok") return "ok";
  if (status === "degraded") return "degraded";
  return "unknown";
}

export function SystemPage() {
  const { t, i18n } = useTranslation();
  const { api, identity } = useAuth();
  const [rebuildJobId, setRebuildJobId] = useState<string | null>(null);
  const rebuild = useMutation({
    mutationFn: () => api.rebuildIndex(),
    onSuccess: (job) => {
      setRebuildJobId(job.id);
    },
  });

  function requestRebuild() {
    if (!window.confirm(t("system:rebuildConfirm"))) return;
    rebuild.mutate();
  }

  const live = useQuery({
    queryKey: ["health", "live", "system"],
    queryFn: () => api.getLiveHealth(),
    refetchInterval: 20_000,
  });

  const ready = useQuery({
    queryKey: ["health", "ready", "system"],
    queryFn: () => api.getReadyHealth(),
    refetchInterval: 30_000,
    retry: 0,
  });
  const auditLogs = useQuery({
    queryKey: ["audit-logs", "recent"],
    queryFn: () => api.listAuditLogs({ limit: 20 }),
    enabled: Boolean(identity?.is_admin),
  });
  const locale = i18n.language as AppLocale;

  const readyError = ready.error;
  const readyRequestId = isApiError(readyError) ? readyError.requestId : null;
  const readyLocalized = ready.isError
    ? localizeApiError((key, options) => t(key, options), readyError)
    : null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t("system:title")}</h1>
          <p className={styles.lead}>{t("system:lead")}</p>
        </div>
      </header>

      <section className={styles.grid} aria-label={t("system:runtimeConfig")}>
        <article className={styles.card}>
          <h2 className={styles.cardTitle}>{t("system:frontend")}</h2>
          <dl className={styles.dl}>
            <div>
              <dt>{t("system:appOrigin")}</dt>
              <dd>
                <CopyableValue value={config.appOrigin} />
              </dd>
            </div>
            <div>
              <dt>{t("system:apiBase")}</dt>
              <dd>
                <CopyableValue value={config.apiBaseUrl} />
              </dd>
            </div>
            <div>
              <dt>{t("system:oidcAuthority")}</dt>
              <dd>
                <CopyableValue value={config.oidc.authority} />
              </dd>
            </div>
            <div>
              <dt>{t("system:clientId")}</dt>
              <dd>
                <CopyableValue value={config.oidc.clientId} />
              </dd>
            </div>
          </dl>
        </article>

        <article className={styles.card}>
          <h2 className={styles.cardTitle}>{t("system:sessionIdentity")}</h2>
          {identity ? (
            <dl className={styles.dl}>
              <div>
                <dt>{t("system:userId")}</dt>
                <dd>
                  <CopyableValue value={identity.user_id} />
                </dd>
              </div>
              <div>
                <dt>{t("system:tenantId")}</dt>
                <dd>
                  <CopyableValue value={identity.tenant_id} />
                </dd>
              </div>
              <div>
                <dt>{t("system:roles")}</dt>
                <dd className="mono">{identity.roles.join(", ") || t("common:emDash")}</dd>
              </div>
              <div>
                <dt>{t("system:groups")}</dt>
                <dd className="mono">{identity.groups.join(", ") || t("common:emDash")}</dd>
              </div>
              <div>
                <dt>{t("system:authMethod")}</dt>
                <dd className="mono">{identity.auth_method}</dd>
              </div>
              <div>
                <dt>{t("system:isAdmin")}</dt>
                <dd className="mono">{String(identity.is_admin)}</dd>
              </div>
            </dl>
          ) : (
            <p className={styles.muted}>{t("system:noIdentity")}</p>
          )}
        </article>

        <article className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>{t("system:apiLiveness")}</h2>
            <StatusPill
              tone={tone(live.data?.status, live.isError, live.isLoading)}
              label={
                live.isLoading
                  ? t("system:checking")
                  : live.isError
                    ? t("system:unreachable")
                    : (live.data?.status ?? t("common:unknown"))
              }
            />
          </div>
          {live.data ? (
            <dl className={styles.dl}>
              <div>
                <dt>{t("system:service")}</dt>
                <dd className="mono">{live.data.service}</dd>
              </div>
              <div>
                <dt>{t("system:version")}</dt>
                <dd className="mono">{live.data.version}</dd>
              </div>
            </dl>
          ) : live.isError ? (
            <p className={styles.muted}>
              {live.error instanceof Error ? live.error.message : t("system:unreachable")}
            </p>
          ) : null}
        </article>

        <article className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>{t("system:apiReadiness")}</h2>
            <StatusPill
              tone={tone(ready.data?.status, ready.isError, ready.isLoading)}
              label={
                ready.isLoading
                  ? t("system:checking")
                  : ready.isError
                    ? t("system:unavailable")
                    : (ready.data?.status ?? t("common:unknown"))
              }
            />
          </div>
          {ready.data ? (
            <dl className={styles.dl}>
              <div>
                <dt>{t("system:status")}</dt>
                <dd className="mono">{ready.data.status}</dd>
              </div>
              {Object.entries(ready.data.dependencies).map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd className="mono">{String(value)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {ready.isError && readyLocalized ? (
            <div className={styles.errorBlock}>
              <p className={styles.muted}>
                <strong>{readyLocalized.title}</strong> — {readyLocalized.action}
              </p>
              <RequestId requestId={readyRequestId} />
              <TechnicalDetails detail={readyLocalized.serverDetail} />
            </div>
          ) : null}
        </article>

        <article className={styles.card}>
          <h2 className={styles.cardTitle}>{t("system:indexOperations")}</h2>
          <p className={styles.muted}>{t("system:indexOperationsDetail")}</p>
          {identity?.is_admin ? (
            <div className={styles.actions}>
              <Button
                type="button"
                variant="danger"
                disabled={rebuild.isPending}
                onClick={requestRebuild}
              >
                {rebuild.isPending ? t("system:rebuildStarting") : t("system:rebuildIndex")}
              </Button>
            </div>
          ) : (
            <p className={styles.muted}>{t("system:rebuildAdminOnly")}</p>
          )}
          {rebuild.isError ? (
            <OperationError error={rebuild.error} onRetry={requestRebuild} />
          ) : null}
          {rebuildJobId ? <JobStatus jobId={rebuildJobId} /> : null}
        </article>

        {identity?.is_admin ? (
          <article className={`${styles.card} ${styles.auditCard}`}>
            <div className={styles.cardHead}>
              <div>
                <h2 className={styles.cardTitle}>{t("system:auditTitle")}</h2>
                <p className={styles.muted}>{t("system:auditDetail")}</p>
              </div>
              <Button type="button" variant="secondary" onClick={() => void auditLogs.refetch()}>
                {t("system:auditRefresh")}
              </Button>
            </div>
            {auditLogs.isLoading ? <p>{t("system:auditLoading")}</p> : null}
            {auditLogs.isError ? <OperationError error={auditLogs.error} onRetry={() => void auditLogs.refetch()} /> : null}
            {auditLogs.data?.items.length === 0 ? <p className={styles.muted}>{t("system:auditEmpty")}</p> : null}
            {auditLogs.data?.items.length ? (
              <ul className={styles.auditList}>
                {auditLogs.data.items.map((entry) => (
                  <li key={entry.id}>
                    <div><strong>{entry.action}</strong><time>{formatDateTime(locale, entry.created_at)}</time></div>
                    <div><code>{entry.resource_type}</code>{entry.resource_id ? <code>{entry.resource_id}</code> : null}</div>
                    <div><span>{entry.user_id || "—"}</span>{entry.request_id ? <code>{entry.request_id}</code> : null}</div>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ) : null}
      </section>
    </div>
  );
}
