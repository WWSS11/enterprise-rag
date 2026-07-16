import { useState, type FormEvent } from "react";
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
import { forgetRunId, listRunIds, rememberRunId } from "@/evaluations/runStorage";
import { canEditKnowledgeBase } from "@/knowledgeBases/permissions";
import styles from "./EvaluationConsole.module.css";

const uuidSchema = z.string().uuid();

export function EvaluationDatasetPage() {
  const { datasetId = "" } = useParams<{ datasetId: string }>();
  const { t, i18n } = useTranslation(["evaluations", "evaluationCases", "evaluationRuns", "common"]);
  const { api, identity } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const locale = i18n.language as AppLocale;
  const runStorageScope = {
    tenant_id: identity?.tenant_id ?? "",
    user_id: identity?.user_id ?? "",
    dataset_id: datasetId,
  };
  const [runIds, setRunIds] = useState(() => listRunIds(runStorageScope));
  const [pastedRunId, setPastedRunId] = useState("");
  const [runValidation, setRunValidation] = useState<string | null>(null);

  const dataset = useQuery({ queryKey: ["evaluation-dataset", datasetId], queryFn: () => api.getEvaluationDataset(datasetId), enabled: Boolean(datasetId) });
  const knowledgeBases = useQuery({ queryKey: ["knowledge-bases"], queryFn: () => api.listKnowledgeBases() });
  const cases = useQuery({ queryKey: ["evaluation-cases", datasetId], queryFn: () => api.listEvaluationCases(datasetId), enabled: Boolean(dataset.data) });
  const documents = useQuery({ queryKey: ["documents", dataset.data?.knowledge_base_id], queryFn: () => api.listDocuments(dataset.data!.knowledge_base_id), enabled: Boolean(dataset.data) });
  const knowledgeBase = knowledgeBases.data?.find((item) => item.id === dataset.data?.knowledge_base_id);
  const canEdit = Boolean(knowledgeBase && canEditKnowledgeBase(identity, knowledgeBase));
  const readyDocuments = documents.data?.filter((item) => item.status === "ready") ?? [];

  const createCase = useMutation({
    mutationFn: (payload: Parameters<typeof api.createEvaluationCase>[1]) => api.createEvaluationCase(datasetId, payload),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["evaluation-cases", datasetId] }); },
  });
  const startRun = useMutation({
    mutationFn: () => api.createEvaluationRun({ dataset_id: datasetId }),
    onSuccess: (run) => { setRunIds(rememberRunId(runStorageScope, run.id)); navigate(`/app/evaluations/runs/${run.id}`, { state: { queued: true } }); },
  });
  const openRun = useMutation({
    mutationFn: (runId: string) => api.getEvaluationRun(runId),
    onSuccess: (run) => {
      if (run.dataset_id !== datasetId) { setRunValidation(t("qualityGates:validationSameDataset")); return; }
      setRunIds(rememberRunId(runStorageScope, run.id));
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
          <div><dt>{t("evaluations:datasetId")}</dt><dd><code>{dataset.data.id}</code></dd></div><div><dt>{t("evaluations:knowledgeBase")}</dt><dd>{knowledgeBase?.name || <code>{dataset.data.knowledge_base_id}</code>}</dd></div><div><dt>{t("evaluations:createdBy")}</dt><dd><code>{dataset.data.created_by}</code></dd></div><div><dt>{t("evaluations:createdAt")}</dt><dd>{formatDateTime(locale, dataset.data.created_at)}</dd></div><div><dt>{t("evaluations:updatedAt")}</dt><dd>{formatDateTime(locale, dataset.data.updated_at)}</dd></div><div><dt>{t("evaluationRuns:totalCases")}</dt><dd className={styles.monoMetric}>{cases.data?.length ?? "—"}</dd></div>
        </dl>
      </section>

      <section className={styles.noticeSection}><h2>{t("evaluations:permissionTitle")}</h2><p>{canEdit ? t("evaluations:permissionEditor") : t("evaluations:permissionReadOnly")}</p></section>

      <section className={styles.panel} aria-labelledby="case-list-title">
        <div className={styles.sectionHeader}><div><h2 id="case-list-title">{t("evaluationCases:listTitle")}</h2><p>{t("evaluationCases:subtitle")}</p></div><Button type="button" variant="secondary" onClick={() => void cases.refetch()}>{t("evaluationCases:refresh")}</Button></div>
        {cases.isLoading ? <p className={styles.loading} aria-busy="true">{t("evaluationCases:loading")}</p> : null}
        {cases.isError ? <OperationError error={cases.error} onRetry={() => void cases.refetch()} /> : null}
        {cases.data?.length === 0 ? <EmptyState title={t("evaluationCases:emptyTitle")} description={t("evaluationCases:emptyDetail")} headingLevel={2} /> : null}
        {cases.data?.length ? <div className={styles.caseList}>{cases.data.map((item, index) => <details className={styles.caseItem} key={item.id}><summary><span>{t("evaluationRuns:caseNumber", { number: index + 1 })}: {item.question}</span><code>{item.id}</code></summary><div className={styles.caseBody}><h4>{t("evaluationCases:referenceAnswer")}</h4><p className={styles.prose}>{item.reference_answer}</p><dl className={styles.factGrid}><div><dt>{t("evaluationCases:caseType")}</dt><dd>{item.should_refuse ? t("evaluationCases:refusal") : t("evaluationCases:answerable")}</dd></div><div><dt>{t("evaluationCases:expectedDocumentIds")}</dt><dd><code>{item.expected_document_ids.join(", ") || "—"}</code></dd></div><div><dt>{t("evaluationCases:acceptableCitationDocumentIds")}</dt><dd><code>{item.acceptable_citation_document_ids.join(", ") || "—"}</code></dd></div><div><dt>{t("evaluationCases:requiredKeyPoints")}</dt><dd>{item.required_key_points.join(" · ") || "—"}</dd></div><div><dt>{t("evaluationCases:requiredKeyPointGroups")}</dt><dd>{item.required_key_point_groups.map((group) => group.join(" | ")).join("; ") || "—"}</dd></div><div><dt>{t("evaluationCases:tags")}</dt><dd>{item.tags.join(" · ") || "—"}</dd></div></dl></div></details>)}</div> : null}
      </section>

      {canEdit ? <section className={styles.panel} aria-labelledby="add-case-title"><div className={styles.sectionHeader}><div><h2 id="add-case-title">{t("evaluationCases:createTitle")}</h2><p>{t("evaluationCases:createSubtitle")}</p></div></div>{documents.isError ? <OperationError error={documents.error} onRetry={() => void documents.refetch()} /> : <EvaluationCaseForm readyDocuments={readyDocuments} submitting={createCase.isPending} submitError={createCase.error} onSubmit={async (payload) => { await createCase.mutateAsync(payload); }} />}</section> : null}

      <section className={styles.panel} aria-labelledby="start-run-title"><div className={styles.sectionHeader}><div><h2 id="start-run-title">{t("evaluationRuns:startTitle")}</h2><p>{t("evaluationRuns:startDetail")}</p></div>{canEdit ? <Button type="button" disabled={startRun.isPending || !cases.data?.length} onClick={() => startRun.mutate()}>{startRun.isPending ? t("evaluationRuns:starting") : t("evaluationRuns:start")}</Button> : null}</div>{!canEdit ? <p className={styles.notice}>{t("evaluationRuns:permissionStartRequiresEditor")}</p> : null}{cases.data?.length === 0 ? <p className={styles.validation}>{t("evaluationRuns:datasetHasNoCases")}</p> : null}{startRun.isError ? <OperationError error={startRun.error} onRetry={() => startRun.mutate()} /> : null}</section>

      <section className={styles.panel} aria-labelledby="known-runs-title"><div className={styles.sectionHeader}><div><h2 id="known-runs-title">{t("evaluationRuns:runsTitle")}</h2><p>{t("evaluationRuns:sessionScope")}</p></div></div><form className={styles.inlineForm} onSubmit={submitRunId}><div className={styles.formField}><label htmlFor="existing-run-id">{t("evaluationRuns:pasteRunLabel")}</label><input id="existing-run-id" value={pastedRunId} onChange={(event) => setPastedRunId(event.target.value)} placeholder={t("evaluationRuns:pasteRunPlaceholder")} /></div><Button type="submit" variant="secondary" disabled={openRun.isPending}>{t("evaluationRuns:openRun")}</Button></form>{runValidation ? <p className={styles.validation}>{runValidation}</p> : null}{openRun.isError ? <OperationError error={openRun.error} onRetry={() => openRun.mutate(pastedRunId.trim())} /> : null}{runIds.length === 0 ? <p className={styles.muted}>{t("evaluationRuns:emptyDetail")}</p> : <ul className={styles.runIdList}>{runIds.map((runId) => <li key={runId}><Link to={`/app/evaluations/runs/${runId}`}><code>{runId}</code></Link><Button type="button" variant="ghost" onClick={() => setRunIds(forgetRunId(runStorageScope, runId))}>{t("evaluationRuns:forgetRun")}</Button></li>)}</ul>}</section>
    </div>
  );
}
