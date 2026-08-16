import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/useAuth";
import { EmptyState } from "@/components/EmptyState";
import { OperationError } from "@/components/OperationError";
import { Button } from "@/components/Button";
import { JobStatus } from "@/jobs/JobStatus";
import styles from "./JobsPage.module.css";

export function JobsPage() {
  const { t } = useTranslation("jobs");
  const { api } = useAuth();
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [knowledgeBaseFilter, setKnowledgeBaseFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 10;
  const knowledgeBases = useQuery({
    queryKey: ["knowledge-bases"],
    queryFn: () => api.listKnowledgeBases(),
  });
  const jobs = useQuery({
    queryKey: ["jobs", "history", statusFilter, typeFilter, knowledgeBaseFilter, offset],
    queryFn: () => api.listJobs({
      status: statusFilter || undefined,
      jobType: typeFilter || undefined,
      knowledgeBaseId: knowledgeBaseFilter || undefined,
      limit,
      offset,
    }),
    refetchInterval: (query) => query.state.data?.items.some((job) => job.status === "queued" || job.status === "running") ? 5000 : false,
  });
  const pageNumber = Math.floor(offset / limit) + 1;
  const pageCount = Math.max(1, Math.ceil((jobs.data?.total ?? 0) / limit));

  function resetAndSet(setter: (value: string) => void, value: string) {
    setter(value);
    setOffset(0);
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.kicker}>{t("kicker")}</div>
          <h1>{t("title")}</h1>
          <p>{t("subtitle")}</p>
        </div>
      </header>

      <p className={styles.scope}>{t("serverScope")}</p>

      <section className={styles.filters} aria-label={t("filters") }>
        <label>{t("filterStatus")}<select value={statusFilter} onChange={(event) => resetAndSet(setStatusFilter, event.target.value)}><option value="">{t("filterAll")}</option><option value="queued">{t("statusQueued")}</option><option value="running">{t("statusRunning")}</option><option value="succeeded">{t("statusSucceeded")}</option><option value="failed">{t("statusFailed")}</option><option value="cancelled">{t("statusCancelled")}</option></select></label>
        <label>{t("filterType")}<select value={typeFilter} onChange={(event) => resetAndSet(setTypeFilter, event.target.value)}><option value="">{t("filterAll")}</option><option value="document_ingestion">{t("typeIngestion")}</option><option value="document_reindex">{t("typeReindex")}</option><option value="document_deletion">{t("typeDeletion")}</option><option value="local_document_scan">{t("typeScan")}</option><option value="vector_index_rebuild">{t("typeRebuild")}</option><option value="feishu_sync">{t("typeFeishuSync")}</option></select></label>
        <label>{t("filterKnowledgeBase")}<select value={knowledgeBaseFilter} onChange={(event) => resetAndSet(setKnowledgeBaseFilter, event.target.value)}><option value="">{t("filterAll")}</option>{knowledgeBases.data?.map((knowledgeBase) => <option key={knowledgeBase.id} value={knowledgeBase.id}>{knowledgeBase.name}</option>)}</select></label>
      </section>

      {jobs.isError ? <OperationError error={jobs.error} onRetry={() => void jobs.refetch()} /> : null}
      {jobs.isLoading ? <p>{t("loading")}</p> : null}
      {jobs.data?.items.length === 0 ? (
        <EmptyState
          kicker={t("kicker")}
          title={t("emptyTitle")}
          description={t("emptyDetail")}
          headingLevel={2}
        />
      ) : (
        <section className={styles.list} aria-label={t("title")}>
          {jobs.data?.items.map((job) => (
            <JobStatus
              key={job.id}
              jobId={job.id}
              initialJob={job}
              onTerminal={() => void jobs.refetch()}
              canControl
              onChanged={() => void jobs.refetch()}
            />
          ))}
        </section>
      )}
      {jobs.data && jobs.data.total > 0 ? <nav className={styles.pagination} aria-label={t("pagination")}><Button type="button" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>{t("previous")}</Button><span>{t("pageSummary", { page: pageNumber, pages: pageCount, total: jobs.data.total })}</span><Button type="button" variant="secondary" disabled={offset + limit >= jobs.data.total} onClick={() => setOffset(offset + limit)}>{t("next")}</Button></nav> : null}
    </div>
  );
}
