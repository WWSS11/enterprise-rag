import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { DocumentRecord, EvaluationCaseCreate } from "@/api/types";
import { Button } from "@/components/Button";
import { OperationError } from "@/components/OperationError";
import styles from "@/pages/EvaluationConsole.module.css";

const MAX_ALIAS_LENGTH = 500;

function unique(values: string[]): string[] {
  const output: string[] = [];
  for (const value of values) {
    if (!output.includes(value)) output.push(value);
  }
  return output;
}

function parseLines(value: string): string[] {
  return unique(
    value
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function parseGroups(value: string): string[][] {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => unique(line.split("|").map((item) => item.trim()).filter(Boolean)))
    .filter((group) => group.length > 0);
}

function toggle(values: string[], value: string, checked: boolean): string[] {
  if (checked) return values.includes(value) ? values : [...values, value];
  return values.filter((item) => item !== value);
}

type EvaluationCaseFormProps = {
  readyDocuments: DocumentRecord[];
  submitting: boolean;
  submitError?: unknown;
  onSubmit: (payload: EvaluationCaseCreate) => Promise<void>;
};

export function EvaluationCaseForm({
  readyDocuments,
  submitting,
  submitError,
  onSubmit,
}: EvaluationCaseFormProps) {
  const { t } = useTranslation(["evaluationCases", "evaluationRuns", "common"]);
  const [question, setQuestion] = useState("");
  const [referenceAnswer, setReferenceAnswer] = useState("");
  const [shouldRefuse, setShouldRefuse] = useState(false);
  const [expectedDocumentIds, setExpectedDocumentIds] = useState<string[]>([]);
  const [additionalCitationIds, setAdditionalCitationIds] = useState<string[]>([]);
  const [requiredKeyPointsText, setRequiredKeyPointsText] = useState("");
  const [keyPointGroupsText, setKeyPointGroupsText] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  function reset() {
    setQuestion("");
    setReferenceAnswer("");
    setShouldRefuse(false);
    setExpectedDocumentIds([]);
    setAdditionalCitationIds([]);
    setRequiredKeyPointsText("");
    setKeyPointGroupsText("");
    setTagsText("");
    setValidationErrors([]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors: string[] = [];
    const cleanQuestion = question.trim();
    const cleanReference = referenceAnswer.trim();
    const requiredKeyPoints = parseLines(requiredKeyPointsText);
    const requiredKeyPointGroups = parseGroups(keyPointGroupsText);
    const tags = parseLines(tagsText);
    const acceptableCitationDocumentIds = unique([
      ...expectedDocumentIds,
      ...additionalCitationIds,
    ]);

    if (!cleanQuestion) errors.push(t("evaluationCases:validationQuestionRequired"));
    if (cleanQuestion.length > 8000) errors.push(t("evaluationCases:validationQuestionMax"));
    if (!cleanReference) errors.push(t("evaluationCases:validationReferenceRequired"));
    if (cleanReference.length > 32000) errors.push(t("evaluationCases:validationReferenceMax"));
    if (!shouldRefuse && expectedDocumentIds.length === 0) {
      errors.push(t("evaluationCases:validationExpectedDocumentRequired"));
    }
    if (shouldRefuse && (expectedDocumentIds.length > 0 || additionalCitationIds.length > 0)) {
      errors.push(t("evaluationCases:validationRefusalDocuments"));
    }
    if (expectedDocumentIds.length > 100) {
      errors.push(t("evaluationCases:validationExpectedDocumentsMax"));
    }
    if (acceptableCitationDocumentIds.length > 100) {
      errors.push(t("evaluationCases:validationCitationDocumentsMax"));
    }
    if (requiredKeyPoints.length > 100) {
      errors.push(t("evaluationCases:validationKeyPointsMax"));
    }
    if (requiredKeyPointGroups.length > 100) {
      errors.push(t("evaluationCases:validationGroupsMax"));
    }
    if (tags.length > 50) errors.push(t("evaluationCases:validationTagsMax"));

    const groupedAnchors = new Set<string>();
    for (const group of requiredKeyPointGroups) {
      if (group.length > 20) errors.push(t("evaluationCases:validationAliasesMax"));
      if (group.some((alias) => alias.length > MAX_ALIAS_LENGTH)) {
        errors.push(t("evaluationCases:validationAliasLength"));
      }
      const anchors = requiredKeyPoints.filter((point) => group.includes(point));
      if (anchors.length !== 1) {
        errors.push(t("evaluationCases:validationGroupAnchor"));
      } else if (groupedAnchors.has(anchors[0])) {
        errors.push(t("evaluationCases:validationGroupDuplicate"));
      } else {
        groupedAnchors.add(anchors[0]);
      }
    }

    const deterministicErrors = unique(errors);
    setValidationErrors(deterministicErrors);
    if (deterministicErrors.length > 0) return;

    try {
      await onSubmit({
        question: cleanQuestion,
        reference_answer: cleanReference,
        expected_document_ids: shouldRefuse ? [] : expectedDocumentIds,
        acceptable_citation_document_ids: shouldRefuse ? [] : acceptableCitationDocumentIds,
        required_key_points: requiredKeyPoints,
        required_key_point_groups: requiredKeyPointGroups,
        should_refuse: shouldRefuse,
        tags,
      });
    } catch {
      return;
    }
    reset();
  }

  return (
    <form className={styles.caseForm} onSubmit={(event) => void submit(event)}>
      <div className={styles.formField}>
        <label htmlFor="evaluation-question">{t("evaluationCases:question")}</label>
        <textarea
          id="evaluation-question"
          rows={4}
          maxLength={8000}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          aria-invalid={validationErrors.includes(t("evaluationCases:validationQuestionRequired"))}
        />
        <span className={styles.characterCount}>{question.length} / 8000</span>
      </div>

      <div className={styles.formField}>
        <label htmlFor="evaluation-reference">{t("evaluationCases:referenceAnswer")}</label>
        <textarea
          id="evaluation-reference"
          rows={7}
          maxLength={32000}
          value={referenceAnswer}
          onChange={(event) => setReferenceAnswer(event.target.value)}
        />
        <span className={styles.characterCount}>{referenceAnswer.length} / 32000</span>
      </div>

      <fieldset className={styles.fieldset}>
        <legend>{t("evaluationCases:caseType")}</legend>
        <label className={styles.radioOption}>
          <input
            type="radio"
            name="case-type"
            checked={!shouldRefuse}
            onChange={() => setShouldRefuse(false)}
          />
          <span>
            <strong>{t("evaluationCases:answerable")}</strong>
            <small>{t("evaluationCases:expectedDocumentsHint")}</small>
          </span>
        </label>
        <label className={styles.radioOption}>
          <input
            type="radio"
            name="case-type"
            checked={shouldRefuse}
            onChange={() => {
              setShouldRefuse(true);
              setExpectedDocumentIds([]);
              setAdditionalCitationIds([]);
            }}
          />
          <span>
            <strong>{t("evaluationCases:refusal")}</strong>
            <small>{t("evaluationCases:noExpectedDocumentsForRefusal")}</small>
          </span>
        </label>
      </fieldset>

      {!shouldRefuse ? (
        <div className={styles.documentSelectors}>
          <fieldset className={styles.fieldset}>
            <legend>{t("evaluationCases:expectedDocuments")}</legend>
            <p className={styles.fieldHint}>{t("evaluationCases:expectedDocumentsHint")}</p>
            {readyDocuments.length === 0 ? (
              <p className={styles.muted}>{t("evaluationRuns:noDocuments")}</p>
            ) : (
              <div className={styles.checkboxList}>
                {readyDocuments.map((document) => (
                  <label key={document.id} className={styles.checkboxOption}>
                    <input
                      type="checkbox"
                      checked={expectedDocumentIds.includes(document.id)}
                      onChange={(event) =>
                        setExpectedDocumentIds((current) =>
                          toggle(current, document.id, event.target.checked),
                        )
                      }
                    />
                    <span>
                      <strong>{document.name}</strong>
                      <code>{document.id}</code>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <fieldset className={styles.fieldset}>
            <legend>{t("evaluationCases:acceptableCitationDocuments")}</legend>
            <p className={styles.fieldHint}>
              {t("evaluationCases:acceptableCitationDocumentsHint")}
            </p>
            {readyDocuments.length === 0 ? (
              <p className={styles.muted}>{t("evaluationRuns:noDocuments")}</p>
            ) : (
              <div className={styles.checkboxList}>
                {readyDocuments.map((document) => {
                  const expected = expectedDocumentIds.includes(document.id);
                  return (
                    <label key={document.id} className={styles.checkboxOption}>
                      <input
                        type="checkbox"
                        checked={expected || additionalCitationIds.includes(document.id)}
                        disabled={expected}
                        onChange={(event) =>
                          setAdditionalCitationIds((current) =>
                            toggle(current, document.id, event.target.checked),
                          )
                        }
                      />
                      <span>
                        <strong>{document.name}</strong>
                        <code>{document.id}</code>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>
        </div>
      ) : null}

      <div className={styles.formField}>
        <label htmlFor="evaluation-key-points">{t("evaluationCases:requiredKeyPoints")}</label>
        <textarea
          id="evaluation-key-points"
          rows={5}
          value={requiredKeyPointsText}
          onChange={(event) => setRequiredKeyPointsText(event.target.value)}
          placeholder={t("evaluationCases:keyPointPlaceholder")}
        />
        <p className={styles.fieldHint}>{t("evaluationCases:requiredKeyPointsHint")}</p>
      </div>

      <div className={styles.formField}>
        <label htmlFor="evaluation-key-point-groups">
          {t("evaluationCases:requiredKeyPointGroups")}
        </label>
        <textarea
          id="evaluation-key-point-groups"
          rows={5}
          value={keyPointGroupsText}
          onChange={(event) => setKeyPointGroupsText(event.target.value)}
          placeholder={`${t("evaluationCases:keyPointPlaceholder")} | ${t("evaluationCases:aliasPlaceholder")}`}
        />
        <p className={styles.fieldHint}>{t("evaluationCases:requiredKeyPointGroupsHint")}</p>
      </div>

      <div className={styles.formField}>
        <label htmlFor="evaluation-tags">{t("evaluationCases:tags")}</label>
        <textarea
          id="evaluation-tags"
          rows={3}
          value={tagsText}
          onChange={(event) => setTagsText(event.target.value)}
          placeholder={t("evaluationCases:tagPlaceholder")}
        />
        <p className={styles.fieldHint}>{t("evaluationCases:tagsHint")}</p>
      </div>

      {validationErrors.length > 0 ? (
        <div className={styles.validationSummary} role="alert">
          <ul>
            {validationErrors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        </div>
      ) : null}

      {submitError ? <OperationError error={submitError} /> : null}

      <div className={styles.formActions}>
        <Button type="submit" disabled={submitting}>
          {submitting
            ? t("evaluationCases:creating")
            : t("evaluationCases:createSubmit")}
        </Button>
      </div>
    </form>
  );
}
