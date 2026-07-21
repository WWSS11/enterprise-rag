import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EvaluationCase } from "@/api/types";
import { Button } from "@/components/Button";
import type { AppLocale } from "@/i18n";
import { formatDateTime } from "@/i18n/format";
import styles from "./EvaluationCaseTable.module.css";

type EvaluationCaseTableProps = {
  items: EvaluationCase[];
  offset: number;
  canEdit: boolean;
  confirmingCaseId: string | null;
  deletingCaseId: string | null;
  onEdit: (item: EvaluationCase) => void;
  onRequestDelete: (caseId: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (caseId: string) => void;
};

export function EvaluationCaseTable({
  items,
  offset,
  canEdit,
  confirmingCaseId,
  deletingCaseId,
  onEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: EvaluationCaseTableProps) {
  const { t, i18n } = useTranslation(["evaluationCases", "evaluationRuns", "common"]);
  const locale = i18n.language as AppLocale;
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);

  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t("evaluationCases:number")}</th>
            <th scope="col">{t("evaluationCases:question")}</th>
            <th scope="col">{t("evaluationCases:caseType")}</th>
            <th scope="col">{t("evaluationCases:groundTruth")}</th>
            <th scope="col">{t("evaluationCases:updatedAt")}</th>
            {canEdit ? <th scope="col">{t("common:actions")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const expanded = expandedCaseId === item.id;
            const confirming = confirmingCaseId === item.id;
            const deleting = deletingCaseId === item.id;
            return (
              <Fragment key={item.id}>
                <tr>
                  <td data-label={t("evaluationCases:number")} className={styles.number}>
                    {offset + index + 1}
                  </td>
                  <td data-label={t("evaluationCases:question")} className={styles.questionCell}>
                    <button
                      type="button"
                      className={styles.questionButton}
                      aria-expanded={expanded}
                      aria-controls={`evaluation-case-${item.id}`}
                      onClick={() => setExpandedCaseId(expanded ? null : item.id)}
                    >
                      {item.question}
                    </button>
                    <code>{item.id}</code>
                  </td>
                  <td data-label={t("evaluationCases:caseType")}>
                    {item.should_refuse
                      ? t("evaluationCases:refusal")
                      : t("evaluationCases:answerable")}
                  </td>
                  <td data-label={t("evaluationCases:groundTruth")}>
                    {t("evaluationCases:groundTruthSummary", {
                      documents: item.expected_document_ids.length,
                      points: item.required_key_points.length,
                    })}
                  </td>
                  <td data-label={t("evaluationCases:updatedAt")}>
                    <time dateTime={item.updated_at}>{formatDateTime(locale, item.updated_at)}</time>
                  </td>
                  {canEdit ? (
                    <td data-label={t("common:actions")} className={styles.actions}>
                      {confirming ? (
                        <div className={styles.confirmation} role="group" aria-label={t("evaluationCases:deleteConfirmLabel")}>
                          <span>{t("evaluationCases:deleteConfirm")}</span>
                          <Button type="button" variant="danger" disabled={deleting} onClick={() => onConfirmDelete(item.id)}>
                            {deleting ? t("evaluationCases:deleting") : t("evaluationCases:deleteConfirmAction")}
                          </Button>
                          <Button type="button" variant="secondary" disabled={deleting} onClick={onCancelDelete}>
                            {t("common:cancel")}
                          </Button>
                        </div>
                      ) : (
                        <div className={styles.actionButtons}>
                          <Button type="button" variant="secondary" onClick={() => onEdit(item)}>
                            {t("common:edit")}
                          </Button>
                          <Button type="button" variant="secondary" onClick={() => onRequestDelete(item.id)}>
                            {t("common:delete")}
                          </Button>
                        </div>
                      )}
                    </td>
                  ) : null}
                </tr>
                {expanded ? (
                  <tr key={`${item.id}-detail`} id={`evaluation-case-${item.id}`} className={styles.detailRow}>
                    <td colSpan={canEdit ? 6 : 5}>
                      <div className={styles.detailGrid}>
                        <section>
                          <h3>{t("evaluationCases:referenceAnswer")}</h3>
                          <p>{item.reference_answer}</p>
                        </section>
                        <dl>
                          <div>
                            <dt>{t("evaluationCases:expectedDocumentIds")}</dt>
                            <dd><code>{item.expected_document_ids.join(", ") || "—"}</code></dd>
                          </div>
                          <div>
                            <dt>{t("evaluationCases:acceptableCitationDocumentIds")}</dt>
                            <dd><code>{item.acceptable_citation_document_ids.join(", ") || "—"}</code></dd>
                          </div>
                          <div>
                            <dt>{t("evaluationCases:requiredKeyPoints")}</dt>
                            <dd>{item.required_key_points.join(" · ") || "—"}</dd>
                          </div>
                          <div>
                            <dt>{t("evaluationCases:requiredKeyPointGroups")}</dt>
                            <dd>{item.required_key_point_groups.map((group) => group.join(" | ")).join("; ") || "—"}</dd>
                          </div>
                          <div>
                            <dt>{t("evaluationCases:tags")}</dt>
                            <dd>{item.tags.join(" · ") || "—"}</dd>
                          </div>
                        </dl>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
