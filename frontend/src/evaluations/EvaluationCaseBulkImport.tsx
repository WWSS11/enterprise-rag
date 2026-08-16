import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  evaluationCaseBulkCreateSchema,
  type EvaluationCaseBulkCreate,
} from "@/api/types";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/Button";
import { OperationError } from "@/components/OperationError";
import styles from "@/pages/EvaluationConsole.module.css";

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export function EvaluationCaseBulkImport({
  datasetId,
  onImported,
}: {
  datasetId: string;
  onImported: (count: number) => Promise<void> | void;
}) {
  const { t } = useTranslation(["evaluations", "common"]);
  const { api } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState("");
  const [validated, setValidated] = useState<EvaluationCaseBulkCreate | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const importCases = useMutation({
    mutationFn: (payload: EvaluationCaseBulkCreate) =>
      api.createEvaluationCasesBulk(datasetId, payload),
    onSuccess: async (items) => {
      setImportedCount(items.length);
      setContent("");
      setValidated(null);
      if (fileRef.current) fileRef.current.value = "";
      await onImported(items.length);
    },
  });

  function validate(raw = content) {
    importCases.reset();
    setImportedCount(null);
    if (new Blob([raw]).size > MAX_IMPORT_BYTES) {
      setValidation(t("evaluations:importFileTooLarge"));
      setValidated(null);
      return;
    }
    try {
      const decoded: unknown = JSON.parse(raw);
      const result = evaluationCaseBulkCreateSchema.safeParse(
        Array.isArray(decoded) ? { cases: decoded } : decoded,
      );
      if (!result.success) {
        const first = result.error.issues[0];
        setValidation(
          t("evaluations:importSchemaError", {
            path: first?.path.join(".") || "cases",
            message: first?.message || "invalid value",
          }),
        );
        setValidated(null);
        return;
      }
      setValidation(null);
      setValidated(result.data);
    } catch {
      setValidation(t("evaluations:importJsonError"));
      setValidated(null);
    }
  }

  async function selectFile(file: File | null) {
    setImportedCount(null);
    setValidated(null);
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setValidation(t("evaluations:importFileTooLarge"));
      return;
    }
    try {
      const text = await file.text();
      setContent(text);
      validate(text);
    } catch {
      setValidation(t("evaluations:importFileReadError"));
    }
  }

  const answerable = validated?.cases.filter((item) => !item.should_refuse).length ?? 0;
  const refusal = validated?.cases.filter((item) => item.should_refuse).length ?? 0;
  return (
    <section className={styles.panel} aria-labelledby="bulk-import-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="bulk-import-title">{t("evaluations:importTitle")}</h2>
          <p>{t("evaluations:importDetail")}</p>
        </div>
      </div>
      <div className={styles.formField}>
        <label htmlFor="evaluation-import-file">{t("evaluations:importFile")}</label>
        <input
          ref={fileRef}
          id="evaluation-import-file"
          type="file"
          accept="application/json,.json"
          onChange={(event) => void selectFile(event.target.files?.[0] ?? null)}
        />
        <span className={styles.fieldHint}>{t("evaluations:importFileHint")}</span>
      </div>
      <div className={styles.formField}>
        <label htmlFor="evaluation-import-json">{t("evaluations:importJson")}</label>
        <textarea
          id="evaluation-import-json"
          className={styles.jsonEditor}
          rows={12}
          value={content}
          placeholder={t("evaluations:importPlaceholder")}
          onChange={(event) => {
            setContent(event.target.value);
            setValidated(null);
            setValidation(null);
            setImportedCount(null);
            importCases.reset();
          }}
        />
      </div>
      {validation ? <p className={styles.validationSummary} role="alert">{validation}</p> : null}
      {validated ? (
        <p className={styles.successNotice} role="status">
          {t("evaluations:importValidated", {
            count: validated.cases.length,
            answerable,
            refusal,
          })}
        </p>
      ) : null}
      {importedCount !== null ? (
        <p className={styles.successNotice} role="status">
          {t("evaluations:importSuccess", { count: importedCount })}
        </p>
      ) : null}
      {importCases.isError ? <OperationError error={importCases.error} /> : null}
      <div className={styles.formActions}>
        <Button type="button" variant="secondary" disabled={!content.trim() || importCases.isPending} onClick={() => validate()}>
          {t("evaluations:importValidate")}
        </Button>
        <Button type="button" disabled={!validated || importCases.isPending} onClick={() => validated && importCases.mutate(validated)}>
          {importCases.isPending
            ? t("evaluations:importing")
            : t("evaluations:importSubmit", { count: validated?.cases.length ?? 0 })}
        </Button>
      </div>
    </section>
  );
}
