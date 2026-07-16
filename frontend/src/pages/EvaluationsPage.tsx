import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AppLocale } from "@/i18n";
import { formatDateTime } from "@/i18n/format";
import { useAuth } from "@/auth/useAuth";
import { EmptyState } from "@/components/EmptyState";
import { OperationError } from "@/components/OperationError";
import { StatusPill } from "@/components/StatusPill";
import { canEditKnowledgeBase } from "@/knowledgeBases/permissions";
import styles from "./EvaluationConsole.module.css";

export function EvaluationsPage() {
  const { t, i18n } = useTranslation(["evaluations", "evaluationRuns"]);
  const { api, identity } = useAuth();
  const locale = i18n.language as AppLocale;
  const datasets = useQuery({ queryKey: ["evaluation-datasets"], queryFn: () => api.listEvaluationDatasets() });
  const knowledgeBases = useQuery({ queryKey: ["knowledge-bases"], queryFn: () => api.listKnowledgeBases() });
  const editable = knowledgeBases.data?.filter((item) => canEditKnowledgeBase(identity, item)) ?? [];
  const names = new Map(knowledgeBases.data?.map((item) => [item.id, item.name]) ?? []);

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.kicker}>{t("evaluations:kicker")}</div>
          <h1>{t("evaluations:title")}</h1>
          <p>{t("evaluations:subtitle")}</p>
          <code className={styles.workflow}>{t("evaluations:workflow")}</code>
        </div>
        {editable.length > 0 ? <Link className={styles.primaryLink} to="/app/evaluations/new">{t("evaluations:create")}</Link> : null}
      </header>

      <section className={styles.noticeSection} aria-labelledby="evaluation-history-scope-title">
        <h2 id="evaluation-history-scope-title">{t("evaluationRuns:runsTitle")}</h2>
        <p>{t("evaluationRuns:sessionScope")}</p>
        <p>{t("evaluationRuns:sessionStorageNote")}</p>
      </section>

      {datasets.isLoading ? <section className={styles.loading} aria-busy="true">{t("evaluations:loading")}</section> : null}
      {datasets.isError ? <OperationError error={datasets.error} onRetry={() => void datasets.refetch()} retryLabel={t("evaluations:retry")} /> : null}
      {!datasets.isLoading && !datasets.isError && datasets.data?.length === 0 ? (
        <EmptyState kicker={t("evaluations:kicker")} title={t("evaluations:emptyTitle")} description={t("evaluations:emptyDetail")} headingLevel={2}
          actions={editable.length > 0 ? <Link className={styles.primaryLink} to="/app/evaluations/new">{t("evaluations:create")}</Link> : undefined} />
      ) : null}

      {datasets.data?.length ? (
        <section className={styles.listPanel} aria-labelledby="dataset-list-title">
          <div className={styles.sectionHeader}><div><h2 id="dataset-list-title">{t("evaluations:datasetsTitle")}</h2><p>{t("evaluations:datasetsDescription")}</p></div></div>
          <ul className={styles.datasetList}>
            {datasets.data.map((dataset) => (
              <li key={dataset.id} className={styles.datasetRow}>
                <div className={styles.rowMain}><Link to={`/app/evaluations/datasets/${dataset.id}`}>{dataset.name}</Link><p>{dataset.description || "—"}</p><code>{dataset.id}</code></div>
                <dl className={styles.rowFacts}>
                  <div><dt>{t("evaluations:knowledgeBase")}</dt><dd>{names.get(dataset.knowledge_base_id) || <code>{dataset.knowledge_base_id}</code>}</dd></div>
                  <div><dt>{t("evaluations:status")}</dt><dd><StatusPill tone={dataset.status === "active" ? "ok" : "unknown"} label={dataset.status === "active" ? t("evaluations:statusActive") : t("evaluations:statusUnknown", { status: dataset.status })} /></dd></div>
                  <div><dt>{t("evaluations:updatedAt")}</dt><dd>{formatDateTime(locale, dataset.updated_at)}</dd></div>
                </dl>
                <Link to={`/app/evaluations/datasets/${dataset.id}`}>{t("evaluations:openDataset")}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {knowledgeBases.isError ? <OperationError error={knowledgeBases.error} onRetry={() => void knowledgeBases.refetch()} /> : null}
      {!knowledgeBases.isLoading && !knowledgeBases.isError && editable.length === 0 ? (
        <section className={styles.noticeSection}><h2>{t("evaluations:noEditableKnowledgeBasesTitle")}</h2><p>{t("evaluations:noEditableKnowledgeBasesDetail")}</p></section>
      ) : null}
    </div>
  );
}
