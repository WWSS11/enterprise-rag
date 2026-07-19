import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AppLocale } from "@/i18n";
import { formatDateTime } from "@/i18n/format";
import { useAuth } from "@/auth/useAuth";
import { EmptyState } from "@/components/EmptyState";
import { OperationError } from "@/components/OperationError";
import { StatusPill } from "@/components/StatusPill";
import styles from "./KnowledgeBaseOps.module.css";

function statusLabel(status: string, t: (key: string, options?: Record<string, unknown>) => string) {
  return status === "active"
    ? { label: t("knowledgeBases:activeStatus"), tone: "ok" as const }
    : status === "archived"
      ? { label: t("knowledgeBases:archivedStatus"), tone: "unknown" as const }
    : {
        label: t("knowledgeBases:unknownStatus", { status }),
        tone: "unknown" as const,
      };
}

export function KnowledgeBasesPage() {
  const { t, i18n } = useTranslation(["knowledgeBases", "common"]);
  const { api } = useAuth();
  const knowledgeBases = useQuery({
    queryKey: ["knowledge-bases", "all"],
    queryFn: () => api.listKnowledgeBases({ includeArchived: true }),
  });
  const locale = i18n.language as AppLocale;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.kicker}>{t("knowledgeBases:kicker")}</div>
          <h1>{t("knowledgeBases:title")}</h1>
          <p>{t("knowledgeBases:subtitle")}</p>
        </div>
        <Link className={styles.primaryLink} to="/app/knowledge-bases/new">
          {t("knowledgeBases:create")}
        </Link>
      </header>

      {knowledgeBases.isLoading ? (
        <section className={styles.loading} aria-busy="true" aria-live="polite">
          {t("knowledgeBases:loading")}
        </section>
      ) : null}

      {knowledgeBases.isError ? (
        <OperationError
          error={knowledgeBases.error}
          onRetry={() => void knowledgeBases.refetch()}
          retryLabel={t("knowledgeBases:refresh")}
        />
      ) : null}

      {!knowledgeBases.isLoading && !knowledgeBases.isError && knowledgeBases.data?.length === 0 ? (
        <EmptyState
          kicker={t("knowledgeBases:kicker")}
          title={t("knowledgeBases:emptyTitle")}
          description={t("knowledgeBases:emptyDetail")}
          headingLevel={2}
          actions={
            <Link className={styles.primaryLink} to="/app/knowledge-bases/new">
              {t("knowledgeBases:create")}
            </Link>
          }
        />
      ) : null}

      {knowledgeBases.data && knowledgeBases.data.length > 0 ? (
        <section className={styles.listSection} aria-labelledby="knowledge-base-list-title">
          <h2 id="knowledge-base-list-title" className={styles.visuallyHidden}>
            {t("knowledgeBases:title")}
          </h2>
          <ul className={styles.list}>
            {knowledgeBases.data.map((knowledgeBase) => {
              const status = statusLabel(knowledgeBase.status, t);
              return (
                <li key={knowledgeBase.id} className={styles.row}>
                  <div className={styles.rowMain}>
                    <div className={styles.nameLine}>
                      <Link to={`/app/knowledge-bases/${knowledgeBase.id}`}>
                        {knowledgeBase.name}
                      </Link>
                      {knowledgeBase.is_default ? (
                        <span className={styles.defaultBadge}>
                          {t("knowledgeBases:defaultBadge")}
                        </span>
                      ) : null}
                    </div>
                    <p>{knowledgeBase.description || "—"}</p>
                    <code className={styles.slug}>{knowledgeBase.slug}</code>
                  </div>
                  <dl className={styles.rowFacts}>
                    <div>
                      <dt>{t("knowledgeBases:status")}</dt>
                      <dd>
                        <StatusPill tone={status.tone} label={status.label} />
                      </dd>
                    </div>
                    <div>
                      <dt>{t("knowledgeBases:accessMode")}</dt>
                      <dd>
                        {knowledgeBase.access_mode === "tenant"
                          ? t("knowledgeBases:tenantAccess")
                          : t("knowledgeBases:restrictedAccess")}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("knowledgeBases:updatedAt")}</dt>
                      <dd>{formatDateTime(locale, knowledgeBase.updated_at)}</dd>
                    </div>
                  </dl>
                  <Link
                    className={styles.detailLink}
                    to={`/app/knowledge-bases/${knowledgeBase.id}`}
                  >
                    {t("knowledgeBases:openDetail")}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
