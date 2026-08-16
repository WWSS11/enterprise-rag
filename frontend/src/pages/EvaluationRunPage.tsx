import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/auth/useAuth";
import { OperationError } from "@/components/OperationError";
import { ComparisonGatePanel } from "@/evaluations/ComparisonGatePanel";
import { EvaluationReport } from "@/evaluations/EvaluationReport";
import { EvaluationRunPanel } from "@/evaluations/EvaluationRunPanel";
import { usePageVisibility } from "@/hooks/usePageVisibility";
import { canEditKnowledgeBase } from "@/knowledgeBases/permissions";
import styles from "./EvaluationConsole.module.css";

export function EvaluationRunPage() {
  const { runId = "" } = useParams<{ runId: string }>();
  const { t } = useTranslation(["evaluationRuns", "evaluations"]);
  const { api, identity } = useAuth();
  const visible = usePageVisibility();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const run = useQuery({
    queryKey: ["evaluation-run", runId],
    queryFn: () => api.getEvaluationRun(runId),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return visible && (!status || status === "queued" || status === "running") ? 2500 : false;
    },
    refetchIntervalInBackground: false,
  });
  const knowledgeBases = useQuery({ queryKey: ["knowledge-bases"], queryFn: () => api.listKnowledgeBases() });
  const knowledgeBase = knowledgeBases.data?.find((item) => item.id === run.data?.knowledge_base_id);
  const canRecalculate = Boolean(knowledgeBase && canEditKnowledgeBase(identity, knowledgeBase));
  const recalculate = useMutation({
    mutationFn: () => api.recalculateEvaluationRun(runId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["evaluation-run", runId] }),
        queryClient.invalidateQueries({ queryKey: ["evaluation-report", runId] }),
      ]);
      await run.refetch();
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelEvaluationRun(runId),
    onSuccess: async (updated) => {
      queryClient.setQueryData(["evaluation-run", runId], updated);
      await queryClient.invalidateQueries({ queryKey: ["evaluation-runs"] });
    },
  });
  const retry = useMutation({
    mutationFn: () => api.retryEvaluationRun(runId),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["evaluation-runs"] });
      navigate(`/app/evaluations/runs/${created.id}`);
    },
  });

  if (run.isLoading) return <section className={styles.loading} aria-busy="true">{t("evaluationRuns:loading")}</section>;
  if (run.isError) return <OperationError error={run.error} onRetry={() => void run.refetch()} />;
  if (!run.data) return null;
  if (knowledgeBases.isLoading) return <section className={styles.loading} aria-busy="true">{t("evaluations:loading")}</section>;
  if (knowledgeBases.isError) return <OperationError error={knowledgeBases.error} onRetry={() => void knowledgeBases.refetch()} />;

  return (
    <div className={styles.page}>
      <div className={styles.breadcrumbRow}><Link className={styles.secondaryLink} to={`/app/evaluations/datasets/${run.data.dataset_id}`}>{t("evaluations:detailTitle")}</Link></div>
      <EvaluationRunPanel
        run={run.data}
        visible={visible}
        canRecalculate={canRecalculate}
        recalculating={recalculate.isPending}
        recalculateError={recalculate.error}
        onRecalculate={() => recalculate.mutate()}
        canControl={canRecalculate}
        cancelling={cancel.isPending}
        retrying={retry.isPending}
        controlError={cancel.error || retry.error}
        onCancel={() => cancel.mutate()}
        onRetry={() => retry.mutate()}
      />
      {run.data.status === "succeeded" ? (
        <>
          <section className={styles.reportHeading}><div className={styles.kicker}>{t("evaluationRuns:kicker")}</div><h2>{t("evaluationRuns:reportTitle")}</h2><p>{t("evaluationRuns:reportSubtitle")}</p></section>
          <EvaluationReport runId={run.data.id} />
          <ComparisonGatePanel candidateRun={run.data} />
        </>
      ) : null}
    </div>
  );
}
