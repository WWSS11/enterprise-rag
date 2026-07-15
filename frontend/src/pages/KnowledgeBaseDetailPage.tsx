import { Link, useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AppLocale } from "@/i18n";
import { formatDateTime } from "@/i18n/format";
import { useAuth } from "@/auth/useAuth";
import { EmptyState } from "@/components/EmptyState";
import { OperationError } from "@/components/OperationError";
import { StatusPill } from "@/components/StatusPill";
import { DocumentOperations } from "@/documents/DocumentOperations";
import {
  canEditKnowledgeBase,
  confirmedKnowledgeBaseAccess,
} from "@/knowledgeBases/permissions";
import styles from "./KnowledgeBaseOps.module.css";

export function KnowledgeBaseDetailPage() {
  const { knowledgeBaseId } = useParams<{ knowledgeBaseId: string }>();
  const location = useLocation();
  const { t, i18n } = useTranslation(["knowledgeBases", "documents", "common"]);
  const { api, identity } = useAuth();
  const knowledgeBases = useQuery({
    queryKey: ["knowledge-bases"],
    queryFn: () => api.listKnowledgeBases(),
  });
  const knowledgeBase = knowledgeBases.data?.find((item) => item.id === knowledgeBaseId);
  const locale = i18n.language as AppLocale;

  if (knowledgeBases.isLoading) {
    return <section className={styles.loading} aria-busy="true">{t("knowledgeBases:loading")}</section>;
  }

  if (knowledgeBases.isError) {
    return (
      <OperationError
        error={knowledgeBases.error}
        onRetry={() => void knowledgeBases.refetch()}
      />
    );
  }

  if (!knowledgeBase) {
    return (
      <EmptyState
        kicker={t("knowledgeBases:kicker")}
        title={t("knowledgeBases:notFoundTitle")}
        description={t("knowledgeBases:notFoundDetail")}
        actions={
          <Link className={styles.secondaryLink} to="/app/knowledge-bases">
            {t("knowledgeBases:backToList")}
          </Link>
        }
      />
    );
  }

  const access = confirmedKnowledgeBaseAccess(identity, knowledgeBase);
  const canEdit = canEditKnowledgeBase(identity, knowledgeBase);
  const permissionMessage =
    access === "admin"
      ? t("knowledgeBases:permissionAdmin")
      : access === "creator"
        ? t("knowledgeBases:permissionCreator")
        : access === "tenant-editor"
          ? t("knowledgeBases:permissionTenantEditor")
          : t("knowledgeBases:permissionRestrictedUnknown");
  const created = Boolean((location.state as { created?: boolean } | null)?.created);

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.kicker}>{t("knowledgeBases:detailTitle")}</div>
          <h1>{knowledgeBase.name}</h1>
          <p>{knowledgeBase.description || "—"}</p>
        </div>
        <Link className={styles.secondaryLink} to="/app/knowledge-bases">
          {t("knowledgeBases:backToList")}
        </Link>
      </header>

      {created ? (
        <p className={styles.successNotice} role="status">
          {t("knowledgeBases:createSuccess")}
        </p>
      ) : null}

      <section className={styles.detailPanel} aria-labelledby="knowledge-base-metadata-title">
        <div className={styles.detailHeading}>
          <h2 id="knowledge-base-metadata-title">{t("knowledgeBases:detailTitle")}</h2>
          <StatusPill
            tone={knowledgeBase.status === "active" ? "ok" : "unknown"}
            label={
              knowledgeBase.status === "active"
                ? t("knowledgeBases:activeStatus")
                : t("knowledgeBases:unknownStatus", { status: knowledgeBase.status })
            }
          />
        </div>
        <dl className={styles.metadata}>
          <div>
            <dt>{t("knowledgeBases:identifier")}</dt>
            <dd><code>{knowledgeBase.id}</code></dd>
          </div>
          <div>
            <dt>{t("knowledgeBases:slug")}</dt>
            <dd><code>{knowledgeBase.slug}</code></dd>
          </div>
          <div>
            <dt>{t("knowledgeBases:accessMode")}</dt>
            <dd>
              {knowledgeBase.access_mode === "tenant"
                ? t("knowledgeBases:tenantAccess")
                : knowledgeBase.access_mode === "restricted"
                  ? t("knowledgeBases:restrictedAccess")
                  : t("knowledgeBases:unknownAccessMode", {
                      accessMode: knowledgeBase.access_mode,
                    })}
            </dd>
          </div>
          <div>
            <dt>{t("knowledgeBases:createdBy")}</dt>
            <dd><code>{knowledgeBase.created_by}</code></dd>
          </div>
          <div>
            <dt>{t("knowledgeBases:createdAt")}</dt>
            <dd>{formatDateTime(locale, knowledgeBase.created_at)}</dd>
          </div>
          <div>
            <dt>{t("knowledgeBases:updatedAt")}</dt>
            <dd>{formatDateTime(locale, knowledgeBase.updated_at)}</dd>
          </div>
        </dl>
        <div className={styles.detailActions}>
          <Link
            className={styles.primaryLink}
            to={`/app/chat?knowledge_base_id=${encodeURIComponent(knowledgeBase.id)}`}
          >
            {t("knowledgeBases:openChat")}
          </Link>
          <Link
            className={styles.secondaryLink}
            to={`/app/documents?knowledge_base_id=${encodeURIComponent(knowledgeBase.id)}`}
          >
            {t("knowledgeBases:documents")}
          </Link>
        </div>
      </section>

      <section className={styles.permission} aria-labelledby="knowledge-base-permission-title">
        <h2 id="knowledge-base-permission-title">{t("knowledgeBases:permissionTitle")}</h2>
        <p>{permissionMessage}</p>
      </section>

      <DocumentOperations knowledgeBase={knowledgeBase} canEdit={canEdit} />
    </div>
  );
}
