import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { OperationError } from "@/components/OperationError";
import { canEditKnowledgeBase } from "@/knowledgeBases/permissions";
import styles from "./EvaluationConsole.module.css";

export function CreateEvaluationDatasetPage() {
  const { t } = useTranslation(["evaluations", "common"]);
  const { api, identity } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [knowledgeBaseId, setKnowledgeBaseId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [validation, setValidation] = useState<string[]>([]);
  const knowledgeBases = useQuery({ queryKey: ["knowledge-bases"], queryFn: () => api.listKnowledgeBases() });
  const editable = knowledgeBases.data?.filter((item) => canEditKnowledgeBase(identity, item)) ?? [];
  const create = useMutation({
    mutationFn: () => api.createEvaluationDataset({ knowledge_base_id: knowledgeBaseId, name: name.trim(), description: description.trim() || null }),
    onSuccess: async (dataset) => {
      await queryClient.invalidateQueries({ queryKey: ["evaluation-datasets"] });
      navigate(`/app/evaluations/datasets/${dataset.id}`, { replace: true, state: { created: true } });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const errors: string[] = [];
    if (!knowledgeBaseId) errors.push(t("evaluations:validationKnowledgeBaseRequired"));
    if (!name.trim()) errors.push(t("evaluations:validationNameRequired"));
    if (name.trim().length > 255) errors.push(t("evaluations:validationNameMax"));
    if (description.length > 4000) errors.push(t("evaluations:validationDescriptionMax"));
    setValidation(errors);
    if (!errors.length) create.mutate();
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}><div><div className={styles.kicker}>{t("evaluations:kicker")}</div><h1>{t("evaluations:createTitle")}</h1><p>{t("evaluations:createSubtitle")}</p></div><Link className={styles.secondaryLink} to="/app/evaluations">{t("evaluations:backToDatasets")}</Link></header>
      {knowledgeBases.isLoading ? <section className={styles.loading} aria-busy="true">{t("evaluations:loading")}</section> : null}
      {knowledgeBases.isError ? <OperationError error={knowledgeBases.error} onRetry={() => void knowledgeBases.refetch()} /> : null}
      {!knowledgeBases.isLoading && !knowledgeBases.isError && editable.length === 0 ? <EmptyState title={t("evaluations:noEditableKnowledgeBasesTitle")} description={t("evaluations:noEditableKnowledgeBasesDetail")} actions={<Link className={styles.secondaryLink} to="/app/evaluations">{t("evaluations:backToDatasets")}</Link>} /> : null}
      {editable.length > 0 ? (
        <form className={styles.form} onSubmit={submit}>
          <div className={styles.formField}><label htmlFor="evaluation-kb">{t("evaluations:fieldKnowledgeBase")}</label><select id="evaluation-kb" value={knowledgeBaseId} onChange={(event) => setKnowledgeBaseId(event.target.value)}><option value="">{t("evaluations:chooseKnowledgeBase")}</option>{editable.map((kb) => <option key={kb.id} value={kb.id}>{kb.name}</option>)}</select></div>
          <div className={styles.formField}><label htmlFor="evaluation-name">{t("evaluations:fieldName")}</label><input id="evaluation-name" maxLength={255} value={name} onChange={(event) => setName(event.target.value)} placeholder={t("evaluations:fieldNamePlaceholder")} /></div>
          <div className={styles.formField}><label htmlFor="evaluation-description">{t("evaluations:fieldDescription")}</label><textarea id="evaluation-description" rows={6} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("evaluations:fieldDescriptionPlaceholder")} /><span className={styles.characterCount}>{description.length} / 4000</span></div>
          {validation.length ? <div className={styles.validationSummary} role="alert"><ul>{validation.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          {create.isError ? <OperationError error={create.error} onRetry={() => create.mutate()} /> : null}
          <div className={styles.formActions}><Button type="submit" disabled={create.isPending}>{create.isPending ? t("evaluations:creating") : t("evaluations:createSubmit")}</Button><Link className={styles.secondaryLink} to="/app/evaluations">{t("common:cancel")}</Link></div>
        </form>
      ) : null}
    </div>
  );
}
