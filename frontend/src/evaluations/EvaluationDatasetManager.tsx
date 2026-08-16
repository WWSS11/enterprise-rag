import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { EvaluationDataset } from "@/api/types";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/Button";
import { OperationError } from "@/components/OperationError";
import styles from "@/pages/EvaluationConsole.module.css";

type EditorMode = "edit" | "copy" | null;

export function EvaluationDatasetManager({
  dataset,
}: {
  dataset: EvaluationDataset;
}) {
  const { t } = useTranslation(["evaluations", "common"]);
  const { api } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<EditorMode>(null);
  const [name, setName] = useState(dataset.name);
  const [description, setDescription] = useState(dataset.description ?? "");
  const [validation, setValidation] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const update = useMutation({
    mutationFn: () =>
      api.updateEvaluationDataset(dataset.id, {
        name: name.trim(),
        description: description.trim() || null,
      }),
    onSuccess: async (updated) => {
      setMode(null);
      await queryClient.invalidateQueries({ queryKey: ["evaluation-dataset", dataset.id] });
      await queryClient.invalidateQueries({ queryKey: ["evaluation-datasets"] });
      queryClient.setQueryData(["evaluation-dataset", dataset.id], updated);
    },
  });
  const copy = useMutation({
    mutationFn: () =>
      api.copyEvaluationDataset(dataset.id, {
        name: name.trim(),
        description: description.trim() || null,
      }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["evaluation-datasets"] });
      navigate(`/app/evaluations/datasets/${created.id}`, {
        state: { copiedFrom: dataset.id },
      });
    },
  });
  const archive = useMutation({
    mutationFn: () => api.archiveEvaluationDataset(dataset.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["evaluation-datasets"] });
      queryClient.removeQueries({ queryKey: ["evaluation-dataset", dataset.id] });
      navigate("/app/evaluations?status=archived", {
        replace: true,
        state: { archived: true },
      });
    },
  });

  function openEditor(nextMode: Exclude<EditorMode, null>) {
    update.reset();
    copy.reset();
    setValidation(null);
    setMode(nextMode);
    setName(nextMode === "copy" ? t("evaluations:copyDefaultName", { name: dataset.name }) : dataset.name);
    setDescription(dataset.description ?? "");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setValidation(t("evaluations:validationNameRequired"));
      return;
    }
    if (cleanName.length > 255) {
      setValidation(t("evaluations:validationNameMax"));
      return;
    }
    if (description.length > 4_000) {
      setValidation(t("evaluations:validationDescriptionMax"));
      return;
    }
    setValidation(null);
    if (mode === "copy") copy.mutate();
    else update.mutate();
  }

  const pending = update.isPending || copy.isPending || archive.isPending;
  return (
    <section className={styles.panel} aria-labelledby="dataset-management-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="dataset-management-title">{t("evaluations:manageTitle")}</h2>
          <p>{t("evaluations:manageDetail")}</p>
        </div>
        <div className={styles.headerActions}>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => openEditor("edit")}>
            {t("evaluations:editDataset")}
          </Button>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => openEditor("copy")}>
            {t("evaluations:copyDataset")}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={pending}
            onClick={() => {
              archive.reset();
              setConfirmArchive(true);
            }}
          >
            {t("evaluations:archiveDataset")}
          </Button>
        </div>
      </div>

      {mode ? (
        <form className={styles.managementForm} onSubmit={submit}>
          <div className={styles.formField}>
            <label htmlFor="manage-dataset-name">{t("evaluations:fieldName")}</label>
            <input
              id="manage-dataset-name"
              value={name}
              maxLength={255}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className={styles.formField}>
            <label htmlFor="manage-dataset-description">{t("evaluations:fieldDescription")}</label>
            <textarea
              id="manage-dataset-description"
              rows={4}
              value={description}
              maxLength={4_000}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {validation ? <p className={styles.validation} role="alert">{validation}</p> : null}
          {update.isError ? <OperationError error={update.error} /> : null}
          {copy.isError ? <OperationError error={copy.error} /> : null}
          <div className={styles.formActions}>
            <Button type="submit" disabled={pending}>
              {pending
                ? t("common:loading")
                : mode === "copy"
                  ? t("evaluations:copySubmit")
                  : t("evaluations:editSubmit")}
            </Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setMode(null)}>
              {t("common:cancel")}
            </Button>
          </div>
        </form>
      ) : null}

      {confirmArchive ? (
        <div className={styles.confirmPanel} role="alertdialog" aria-labelledby="archive-dataset-title">
          <strong id="archive-dataset-title">{t("evaluations:archiveConfirmTitle")}</strong>
          <p>{t("evaluations:archiveConfirmDetail")}</p>
          {archive.isError ? <OperationError error={archive.error} /> : null}
          <div className={styles.formActions}>
            <Button type="button" variant="danger" disabled={archive.isPending} onClick={() => archive.mutate()}>
              {archive.isPending ? t("evaluations:archiving") : t("evaluations:archiveConfirm")}
            </Button>
            <Button type="button" variant="secondary" disabled={archive.isPending} onClick={() => setConfirmArchive(false)}>
              {t("common:cancel")}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
