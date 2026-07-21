import { useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { AppLocale } from "@/i18n";
import { formatDateTime } from "@/i18n/format";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { OperationError } from "@/components/OperationError";
import { StatusPill } from "@/components/StatusPill";
import { EvaluationCaseForm } from "@/evaluations/EvaluationCaseForm";
import { EvaluationCaseTable } from "@/evaluations/EvaluationCaseTable";
import type { EvaluationCase } from "@/api/types";
import { canEditKnowledgeBase } from "@/knowledgeBases/permissions";
import styles from "./EvaluationConsole.module.css";

const uuidSchema = z.string().uuid();
const RUN_PAGE_SIZE = 10;
const CASE_PAGE_SIZE = 10;

export function EvaluationDatasetPage() {
  const { datasetId = "" } = useParams<{ datasetId: string }>();
  const { t, i18n } = useTranslation(["evaluations", "evaluationCases", "evaluationRuns", "common"]);
  const { api, identity } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const locale = i18n.language as AppLocale;
  const [pastedRunId, setPastedRunId] = useState("");
  const [runValidation, setRunValidation] = useState<string | null>(null);
  const [runStatusFilter, setRunStatusFilter] = useState("");
  const [runOffset, setRunOffset] = useState(0);
  const [caseOffset, setCaseOffset] = useState(0);
  const [caseQueryDraft, setCaseQueryDraft] = useState("");
  const [caseQuery, setCaseQuery] = useState("");
  const [caseTypeFilter, setCaseTypeFilter] = useState("");
  const [caseEditor, setCaseEditor] = useState<{ mode: "create" | "edit"; item?: EvaluationCase } | null>(null);
  const [confirmDeleteCaseId, setConfirmDeleteCaseId] = useState<string | null>(null);
  const editorRef = useRef<HTMLElement | null>(null);

  const dataset = useQuery({ queryKey: ["evaluation-dataset", datasetId], queryFn: () => api.getEvaluationDataset(datasetId), enabled: Boolean(datasetId) });
  const knowledgeBases = useQuery({ queryKey: ["knowledge-bases"], queryFn: () => api.listKnowledgeBases() });
  const cases = useQuery({
    queryKey: ["evaluation-cases", datasetId, caseQuery, caseTypeFilter, caseOffset],
    queryFn: () => api.listEvaluationCases(datasetId, {
      query: caseQuery || undefined,
      shouldRefuse: caseTypeFilter === "refusal" ? true : caseTypeFilter === "answerable" ? false : undefined,
      limit: CASE_PAGE_SIZE,
      offset: caseOffset,
    }),
    enabled: Boolean(dataset.data),
  });
  const caseCount = useQuery({
    queryKey: ["evaluation-cases", datasetId, "count"],
    queryFn: () => api.listEvaluationCases(datasetId, { limit: 1, offset: 0 }),
    enabled: Boolean(dataset.data && (caseQuery || caseTypeFilter)),
  });
  const documents = useQuery({ queryKey: ["documents", dataset.data?.knowledge_base_id], queryFn: () => api.listDocuments(dataset.data!.knowledge_base_id), enabled: Boolean(dataset.data) });
  const runs = useQuery({ queryKey: ["evaluation-runs", datasetId, runStatusFilter, runOffset], queryFn: () => api.listEvaluationRuns({ datasetId, status: runStatusFilter || undefined, limit: RUN_PAGE_SIZE, offset: runOffset }), enabled: Boolean(dataset.data) });
  const knowledgeBase = knowledgeBases.data?.find((item) => item.id === dataset.data?.knowledge_base_id);
  const canEdit = Boolean(knowledgeBase && canEditKnowledgeBase(identity, knowledgeBase));
  const readyDocuments = documents.data?.filter((item) => item.status === "ready") ?? [];
  const datasetCaseTotal = caseQuery || caseTypeFilter ? caseCount.data?.total : cases.data?.total;

  const createCase = useMutation({
    mutationFn: (payload: Parameters<typeof api.createEvaluationCase>[1]) => api.createEvaluationCase(datasetId, payload),
    onSuccess: async () => { setCaseEditor(null); setCaseOffset(0); await queryClient.invalidateQueries({ queryKey: ["evaluation-cases", datasetId] }); },
  });
  const updateCase = useMutation({
    mutationFn: ({ caseId, payload }: { caseId: string; payload: Parameters<typeof api.updateEvaluationCase>[2] }) => api.updateEvaluationCase(datasetId, caseId, payload),
    onSuccess: async () => { setCaseEditor(null); await queryClient.invalidateQueries({ queryKey: ["evaluation-cases", datasetId] }); },
  });
  const deleteCase = useMutation({
    mutationFn: (caseId: string) => api.deleteEvaluationCase(datasetId, caseId),
    onSuccess: async () => {
      setConfirmDeleteCaseId(null);
      if ((cases.data?.items.length ?? 0) === 1 && caseOffset > 0) setCaseOffset(Math.max(0, caseOffset - CASE_PAGE_SIZE));
      await queryClient.invalidateQueries({ queryKey: ["evaluation-cases", datasetId] });
    },
  });
  const startRun = useMutation({
    mutationFn: () => api.createEvaluationRun({ dataset_id: datasetId }),
    onSuccess: async (run) => { await queryClient.invalidateQueries({ queryKey: ["evaluation-runs", datasetId] }); navigate(`/app/evaluations/runs/${run.id}`, { state: { queued: true } }); },
  });
  const openRun = useMutation({
    mutationFn: (runId: string) => api.getEvaluationRun(runId),
    onSuccess: (run) => {
      if (run.dataset_id !== datasetId) { setRunValidation(t("qualityGates:validationSameDataset")); return; }
      navigate(`/app/evaluations/runs/${run.id}`);
    },
  });

  function submitRunId(event: FormEvent) {
    event.preventDefault();
    setRunValidation(null);
    const parsed = uuidSchema.safeParse(pastedRunId.trim());
    if (!pastedRunId.trim()) { setRunValidation(t("evaluationRuns:validationRunUuidRequired")); return; }
    if (!parsed.success) { setRunValidation(t("evaluationRuns:validationRunUuid")); return; }
    openRun.mutate(parsed.data);
  }

  if (dataset.isLoading) return <section className={styles.loading} aria-busy="true">{t("evaluations:detailLoading")}</section>;
  if (dataset.isError) return <OperationError error={dataset.error} onRetry={() => void dataset.refetch()} />;
  if (!dataset.data) return <EmptyState title={t("evaluations:notFoundTitle")} description={t("evaluations:notFoundDetail")} />;
  if (knowledgeBases.isLoading) return <section className={styles.loading} aria-busy="true">{t("evaluations:loading")}</section>;
  if (knowledgeBases.isError) return <OperationError error={knowledgeBases.error} onRetry={() => void knowledgeBases.refetch()} />;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}><div><div className={styles.kicker}>{t("evaluations:detailTitle")}</div><h1>{dataset.data.name}</h1><p>{dataset.data.description || "—"}</p></div><Link className={styles.secondaryLink} to="/app/evaluations">{t("evaluations:backToDatasets")}</Link></header>
      {(location.state as { created?: boolean } | null)?.created ? <p className={styles.successNotice} role="status">{t("evaluations:createSuccess")}</p> : null}

      <section className={styles.panel} aria-labelledby="dataset-metadata-title">
        <div className={styles.sectionHeader}><h2 id="dataset-metadata-title">{t("evaluations:detailTitle")}</h2><StatusPill tone={dataset.data.status === "active" ? "ok" : "unknown"} label={dataset.data.status === "active" ? t("evaluations:statusActive") : t("evaluations:statusUnknown", { status: dataset.data.status })} /></div>
        <dl className={styles.factGrid}>
          <div><dt>{t("evaluations:datasetId")}</dt><dd><code>{dataset.data.id}</code></dd></div><div><dt>{t("evaluations:knowledgeBase")}</dt><dd>{knowledgeBase?.name || <code>{dataset.data.knowledge_base_id}</code>}</dd></div><div><dt>{t("evaluations:createdBy")}</dt><dd><code>{dataset.data.created_by}</code></dd></div><div><dt>{t("evaluations:createdAt")}</dt><dd>{formatDateTime(locale, dataset.data.created_at)}</dd></div><div><dt>{t("evaluations:updatedAt")}</dt><dd>{formatDateTime(locale, dataset.data.updated_at)}</dd></div><div><dt>{t("evaluationRuns:totalCases")}</dt><dd className={styles.monoMetric}>{datasetCaseTotal ?? "—"}</dd></div>
        </dl>
      </section>

      <section className={styles.noticeSection}><h2>{t("evaluations:permissionTitle")}</h2><p>{canEdit ? t("evaluations:permissionEditor") : t("evaluations:permissionReadOnly")}</p></section>

      {canEdit && caseEditor ? (
        <section ref={editorRef} className={styles.panel} aria-labelledby="case-editor-title">
          <div className={styles.sectionHeader}><div><h2 id="case-editor-title">{caseEditor.mode === "edit" ? t("evaluationCases:editTitle") : t("evaluationCases:createTitle")}</h2><p>{caseEditor.mode === "edit" ? t("evaluationCases:editSubtitle") : t("evaluationCases:createSubtitle")}</p></div></div>
          {documents.isLoading ? <p className={styles.loading}>{t("common:loading")}</p> : documents.isError ? <OperationError error={documents.error} onRetry={() => void documents.refetch()} /> : (
            <EvaluationCaseForm
              key={caseEditor.item?.id ?? "create-case"}
              readyDocuments={readyDocuments}
              initialValue={caseEditor.item}
              mode={caseEditor.mode}
              submitting={createCase.isPending || updateCase.isPending}
              submitError={caseEditor.mode === "edit" ? updateCase.error : createCase.error}
              onCancel={() => setCaseEditor(null)}
              onSubmit={async (payload) => {
                if (caseEditor.mode === "edit" && caseEditor.item) await updateCase.mutateAsync({ caseId: caseEditor.item.id, payload });
                else await createCase.mutateAsync(payload);
              }}
            />
          )}
        </section>
      ) : null}

      <section className={styles.panel} aria-labelledby="case-list-title">
        <div className={styles.sectionHeader}>
          <div><h2 id="case-list-title">{t("evaluationCases:listTitle")}</h2><p>{t("evaluationCases:subtitle")}</p></div>
          <div className={styles.headerActions}>
            <Button type="button" variant="secondary" onClick={() => void cases.refetch()}>{t("evaluationCases:refresh")}</Button>
            {canEdit ? <Button type="button" onClick={() => { createCase.reset(); updateCase.reset(); setCaseEditor({ mode: "create" }); window.setTimeout(() => editorRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }), 0); }}>{t("evaluationCases:addCase")}</Button> : null}
          </div>
        </div>
        <form className={`${styles.inlineForm} ${styles.caseFilters}`} onSubmit={(event) => { event.preventDefault(); setCaseQuery(caseQueryDraft.trim()); setCaseOffset(0); }}>
          <div className={styles.formField}><label htmlFor="case-query">{t("evaluationCases:filterQuery")}</label><input id="case-query" value={caseQueryDraft} onChange={(event) => setCaseQueryDraft(event.target.value)} placeholder={t("evaluationCases:filterQueryPlaceholder")} /></div>
          <div className={styles.formField}><label htmlFor="case-type-filter">{t("evaluationCases:filterType")}</label><select id="case-type-filter" value={caseTypeFilter} onChange={(event) => { setCaseTypeFilter(event.target.value); setCaseOffset(0); }}><option value="">{t("evaluationCases:filterAll")}</option><option value="answerable">{t("evaluationCases:answerable")}</option><option value="refusal">{t("evaluationCases:refusal")}</option></select></div>
          <Button type="submit" variant="secondary">{t("common:search")}</Button>
        </form>
        {cases.isLoading ? <p className={styles.loading} aria-busy="true">{t("evaluationCases:loading")}</p> : null}
        {cases.isError ? <OperationError error={cases.error} onRetry={() => void cases.refetch()} /> : null}
        {deleteCase.isError ? <OperationError error={deleteCase.error} onRetry={() => confirmDeleteCaseId && deleteCase.mutate(confirmDeleteCaseId)} /> : null}
        {cases.data?.items.length === 0 ? <EmptyState title={t("evaluationCases:emptyTitle")} description={caseQuery || caseTypeFilter ? t("evaluationCases:filteredEmptyDetail") : t("evaluationCases:emptyDetail")} headingLevel={2} /> : null}
        {cases.data?.items.length ? <EvaluationCaseTable items={cases.data.items} offset={caseOffset} canEdit={canEdit} confirmingCaseId={confirmDeleteCaseId} deletingCaseId={deleteCase.isPending ? deleteCase.variables ?? null : null} onEdit={(item) => { createCase.reset(); updateCase.reset(); setCaseEditor({ mode: "edit", item }); window.setTimeout(() => editorRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }), 0); }} onRequestDelete={(caseId) => { deleteCase.reset(); setConfirmDeleteCaseId(caseId); }} onCancelDelete={() => setConfirmDeleteCaseId(null)} onConfirmDelete={(caseId) => deleteCase.mutate(caseId)} /> : null}
        {cases.data && cases.data.total > 0 ? <nav className={styles.pagination} aria-label={t("evaluationCases:pagination")}><Button type="button" variant="secondary" disabled={caseOffset === 0} onClick={() => setCaseOffset(Math.max(0, caseOffset - CASE_PAGE_SIZE))}>{t("evaluationRuns:previous")}</Button><span>{t("evaluationCases:pageSummary", { page: Math.floor(caseOffset / CASE_PAGE_SIZE) + 1, pages: Math.max(1, Math.ceil(cases.data.total / CASE_PAGE_SIZE)), total: cases.data.total })}</span><Button type="button" variant="secondary" disabled={caseOffset + CASE_PAGE_SIZE >= cases.data.total} onClick={() => setCaseOffset(caseOffset + CASE_PAGE_SIZE)}>{t("evaluationRuns:next")}</Button></nav> : null}
      </section>

      <section className={styles.panel} aria-labelledby="start-run-title"><div className={styles.sectionHeader}><div><h2 id="start-run-title">{t("evaluationRuns:startTitle")}</h2><p>{t("evaluationRuns:startDetail")}</p></div>{canEdit ? <Button type="button" disabled={startRun.isPending || datasetCaseTotal === 0} onClick={() => startRun.mutate()}>{startRun.isPending ? t("evaluationRuns:starting") : t("evaluationRuns:start")}</Button> : null}</div>{!canEdit ? <p className={styles.notice}>{t("evaluationRuns:permissionStartRequiresEditor")}</p> : null}{datasetCaseTotal === 0 ? <p className={styles.validation}>{t("evaluationRuns:datasetHasNoCases")}</p> : null}{startRun.isError ? <OperationError error={startRun.error} onRetry={() => startRun.mutate()} /> : null}</section>

      <section className={styles.panel} aria-labelledby="known-runs-title">
        <div className={styles.sectionHeader}><div><h2 id="known-runs-title">{t("evaluationRuns:runsTitle")}</h2><p>{t("evaluationRuns:serverScope")}</p></div><Button type="button" variant="secondary" onClick={() => void runs.refetch()}>{t("evaluationRuns:refresh")}</Button></div>
        <div className={styles.inlineForm}><div className={styles.formField}><label htmlFor="run-status-filter">{t("evaluationRuns:filterStatus")}</label><select id="run-status-filter" value={runStatusFilter} onChange={(event) => { setRunStatusFilter(event.target.value); setRunOffset(0); }}><option value="">{t("evaluationRuns:filterAll")}</option><option value="queued">{t("evaluationRuns:statusQueued")}</option><option value="running">{t("evaluationRuns:statusRunning")}</option><option value="succeeded">{t("evaluationRuns:statusSucceeded")}</option><option value="failed">{t("evaluationRuns:statusFailed")}</option></select></div></div>
        <form className={styles.inlineForm} onSubmit={submitRunId}><div className={styles.formField}><label htmlFor="existing-run-id">{t("evaluationRuns:pasteRunLabel")}</label><input id="existing-run-id" value={pastedRunId} onChange={(event) => setPastedRunId(event.target.value)} placeholder={t("evaluationRuns:pasteRunPlaceholder")} /></div><Button type="submit" variant="secondary" disabled={openRun.isPending}>{t("evaluationRuns:openRun")}</Button></form>
        {runValidation ? <p className={styles.validation}>{runValidation}</p> : null}
        {openRun.isError ? <OperationError error={openRun.error} onRetry={() => openRun.mutate(pastedRunId.trim())} /> : null}
        {runs.isError ? <OperationError error={runs.error} onRetry={() => void runs.refetch()} /> : null}
        {runs.isLoading ? <p className={styles.loading}>{t("evaluationRuns:loading")}</p> : null}
        {runs.data?.items.length === 0 ? <p className={styles.muted}>{t("evaluationRuns:emptyDetail")}</p> : <ul className={styles.runIdList}>{runs.data?.items.map((run) => <li key={run.id}><Link to={`/app/evaluations/runs/${run.id}`}><code>{run.id}</code><span>{run.status === "queued" ? t("evaluationRuns:statusQueued") : run.status === "running" ? t("evaluationRuns:statusRunning") : run.status === "succeeded" ? t("evaluationRuns:statusSucceeded") : run.status === "failed" ? t("evaluationRuns:statusFailed") : run.status}</span></Link></li>)}</ul>}
        {runs.data && runs.data.total > 0 ? <nav className={styles.pagination} aria-label={t("evaluationRuns:pagination")}><Button type="button" variant="secondary" disabled={runOffset === 0} onClick={() => setRunOffset(Math.max(0, runOffset - RUN_PAGE_SIZE))}>{t("evaluationRuns:previous")}</Button><span>{t("evaluationRuns:pageSummary", { page: Math.floor(runOffset / RUN_PAGE_SIZE) + 1, pages: Math.max(1, Math.ceil(runs.data.total / RUN_PAGE_SIZE)), total: runs.data.total })}</span><Button type="button" variant="secondary" disabled={runOffset + RUN_PAGE_SIZE >= runs.data.total} onClick={() => setRunOffset(runOffset + RUN_PAGE_SIZE)}>{t("evaluationRuns:next")}</Button></nav> : null}
      </section>
    </div>
  );
}
