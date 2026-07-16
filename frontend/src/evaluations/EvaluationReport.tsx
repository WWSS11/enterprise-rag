import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Citation, EvaluationResultReport } from "@/api/types";
import type { AppLocale } from "@/i18n";
import { formatLatencyMs } from "@/i18n/format";
import { useAuth } from "@/auth/useAuth";
import { AnswerMarkdown } from "@/chat/AnswerMarkdown";
import { EmptyState } from "@/components/EmptyState";
import { OperationError } from "@/components/OperationError";
import { StatusPill } from "@/components/StatusPill";
import {
  SUMMARY_METRICS,
  formatMetricValue,
  metricLabel,
  numericMetric,
} from "./metrics";
import styles from "@/pages/EvaluationConsole.module.css";

const CASE_METRIC_LABELS: Record<string, string> = {
  matched_key_points: "evaluationRuns:metricMatchedKeyPoints",
  matched_key_point_groups: "evaluationRuns:metricMatchedKeyPointGroups",
  citation_grounded_key_point_groups: "evaluationRuns:metricCitationGroundedKeyPointGroups",
  citation_unsupported_answer_key_point_groups: "evaluationRuns:metricCitationUnsupportedAnswerKeyPointGroups",
  citation_supported_chunk_ids: "evaluationRuns:metricCitationSupportedChunkIds",
  citation_unsupported_chunk_ids: "evaluationRuns:metricCitationUnsupportedChunkIds",
  citation_key_point_support: "evaluationRuns:metricCitationKeyPointSupport",
  expected_refusal: "evaluationRuns:metricExpectedRefusal",
  actual_refusal: "evaluationRuns:metricActualRefusal",
  refusal_correct: "evaluationRuns:metricRefusalCorrect",
  rerank_fallback: "evaluationRuns:metricRerankFallback",
  rerank_attempts: "evaluationRuns:metricRerankAttempts",
  rerank_fallback_reason: "evaluationRuns:metricRerankFallbackReason",
  citation_diagnostics: "evaluationRuns:metricCitationDiagnostics",
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function numberValue(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function answerCitations(values: Array<Record<string, unknown>>): Citation[] {
  return values.map((citation) => {
    const chunks = citation.chunk_ids;
    const firstChunk = Array.isArray(chunks) && typeof chunks[0] === "string" ? chunks[0] : "";
    return {
      document_id: textValue(citation, "document_id"),
      document_name: textValue(citation, "document_name"),
      chunk_id: textValue(citation, "chunk_id") || firstChunk,
      score: numberValue(citation, "score"),
      content_preview:
        textValue(citation, "content_preview") ||
        textValue(citation, "evidence_content") ||
        textValue(citation, "content"),
    };
  });
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "—";
  } catch {
    return "—";
  }
}

function IdList({ values, empty }: { values: string[]; empty: string }) {
  if (values.length === 0) return <span className={styles.muted}>{empty}</span>;
  return (
    <ul className={styles.inlineList}>
      {values.map((value) => <li key={value}><code>{value}</code></li>)}
    </ul>
  );
}

function GroupList({ groups, empty }: { groups: string[][]; empty: string }) {
  if (groups.length === 0) return <span className={styles.muted}>{empty}</span>;
  return (
    <ul className={styles.groupList}>
      {groups.map((group, index) => (
        <li key={`${index}-${group.join("|")}`}>{group.join(" | ")}</li>
      ))}
    </ul>
  );
}

function RecordCollection({
  title,
  empty,
  values,
}: {
  title: string;
  empty: string;
  values: Array<Record<string, unknown>>;
}) {
  if (values.length === 0) {
    return (
      <div className={styles.resultSection}>
        <h4>{title}</h4>
        <p className={styles.muted}>{empty}</p>
      </div>
    );
  }
  return (
    <div className={styles.resultSection}>
      <h4>{title}</h4>
      <div className={styles.recordList}>
        {values.map((value, index) => {
          const identifier = textValue(value, "chunk_id") || textValue(value, "document_id");
          const content =
            textValue(value, "evidence_content") ||
            textValue(value, "content") ||
            textValue(value, "content_preview") ||
            textValue(value, "quote");
          return (
            <details className={styles.recordDetails} key={`${identifier}-${index}`}>
              <summary>
                <span>{identifier || `${title} ${index + 1}`}</span>
              </summary>
              {content ? <p className={styles.evidenceProse}>{content}</p> : null}
              <pre className={styles.jsonBlock}>{json(value)}</pre>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function CaseMetricValue({
  metric,
  value,
  locale,
  unavailable,
}: {
  metric: string;
  value: unknown;
  locale: AppLocale;
  unavailable: string;
}) {
  const numeric = numericMetric(value);
  if (numeric !== null) {
    return <span className={styles.monoMetric}>{formatMetricValue(locale, metric, numeric, unavailable)}</span>;
  }
  if (typeof value === "boolean") return <code>{String(value)}</code>;
  if (typeof value === "string") return <span>{value || unavailable}</span>;
  if (value === null || value === undefined) return <span>{unavailable}</span>;
  return <pre className={styles.compactJson}>{json(value)}</pre>;
}

function CollapsibleContent({
  label,
  collapse,
  children,
}: {
  label: string;
  collapse: boolean;
  children: ReactNode;
}) {
  return collapse ? (
    <details className={styles.longDetails}>
      <summary>{label}</summary>
      {children}
    </details>
  ) : children;
}

function CaseResult({ result, index }: { result: EvaluationResultReport; index: number }) {
  const { t, i18n } = useTranslation(["evaluationRuns", "evaluationCases"]);
  const locale = i18n.language as AppLocale;
  const [activeCitation, setActiveCitation] = useState<number | null>(null);
  const citations = result.citations.map((item) => recordValue(item) ?? {});
  const markdownCitations = answerCitations(citations);
  const statusSucceeded = result.status === "succeeded";
  const unavailable = t("evaluationRuns:valueUnavailable");

  return (
    <article className={styles.caseResult} aria-labelledby={`evaluation-case-result-${result.id}`}>
      <header className={styles.caseResultHeader}>
        <div>
          <div className={styles.kicker}>{t("evaluationRuns:caseNumber", { number: index + 1 })}</div>
          <h3 id={`evaluation-case-result-${result.id}`}>{result.question}</h3>
          <code>{result.case_id}</code>
        </div>
        <StatusPill
          tone={statusSucceeded ? "ok" : "error"}
          label={
            statusSucceeded
              ? t("evaluationRuns:resultStatusSucceeded")
              : result.status === "failed"
                ? t("evaluationRuns:resultStatusFailed")
                : t("evaluationRuns:resultStatusUnknown", { status: result.status })
          }
        />
      </header>

      <div className={styles.caseExpectations}>
        <div>
          <h4>{t("evaluationRuns:question")}</h4>
          <p className={styles.prose}>{result.question}</p>
        </div>
        <div>
          <h4>{t("evaluationRuns:referenceAnswer")}</h4>
          <p className={styles.prose}>{result.reference_answer}</p>
        </div>
      </div>

      <dl className={styles.factGrid}>
        <div>
          <dt>{t("evaluationRuns:caseId")}</dt>
          <dd><code>{result.case_id}</code></dd>
        </div>
        <div>
          <dt>{t("evaluationRuns:shouldRefuse")}</dt>
          <dd>{result.should_refuse ? t("evaluationCases:shouldRefuseYes") : t("evaluationCases:shouldRefuseNo")}</dd>
        </div>
        <div>
          <dt>{t("evaluationRuns:firstTokenMs")}</dt>
          <dd className={styles.monoMetric}>
            {typeof result.first_token_ms === "number"
              ? formatLatencyMs(locale, result.first_token_ms)
              : unavailable}
          </dd>
        </div>
        <div>
          <dt>{t("evaluationRuns:totalLatencyMs")}</dt>
          <dd className={styles.monoMetric}>
            {typeof result.total_latency_ms === "number"
              ? formatLatencyMs(locale, result.total_latency_ms)
              : unavailable}
          </dd>
        </div>
      </dl>

      {result.error_message ? (
        <div className={styles.failure} role="alert">
          <strong>{t("evaluationRuns:errorMessage")}</strong>
          <p>{result.error_message}</p>
        </div>
      ) : null}

      <div className={styles.resultSection}>
        <h4>{t("evaluationRuns:rewrittenQuery")}</h4>
        <p className={styles.prose}>{result.rewritten_query || t("evaluationRuns:noRewrittenQuery")}</p>
      </div>

      <div className={styles.resultSection}>
        <h4>{t("evaluationRuns:generatedAnswer")}</h4>
        {result.answer ? (
          <CollapsibleContent
            label={t("evaluationRuns:generatedAnswer")}
            collapse={result.answer.length > 800}
          >
            <AnswerMarkdown
              answer={result.answer}
              citations={markdownCitations}
              activeCitation={activeCitation}
              onCitationSelect={setActiveCitation}
            />
          </CollapsibleContent>
        ) : (
          <p className={styles.muted}>{t("evaluationRuns:noAnswer")}</p>
        )}
      </div>

      <div className={styles.expectationGrid}>
        <div>
          <h4>{t("evaluationRuns:expectedDocumentIds")}</h4>
          <IdList values={result.expected_document_ids} empty={t("evaluationRuns:noDocuments")} />
        </div>
        <div>
          <h4>{t("evaluationRuns:acceptableCitationDocumentIds")}</h4>
          <IdList values={result.acceptable_citation_document_ids} empty={t("evaluationRuns:noDocuments")} />
        </div>
        <div>
          <h4>{t("evaluationRuns:requiredKeyPoints")}</h4>
          <IdList values={result.required_key_points} empty={t("evaluationRuns:noKeyPoints")} />
        </div>
        <div>
          <h4>{t("evaluationRuns:requiredKeyPointGroups")}</h4>
          <GroupList groups={result.required_key_point_groups} empty={t("evaluationRuns:noKeyPoints")} />
        </div>
        <div>
          <h4>{t("evaluationRuns:tags")}</h4>
          <IdList values={result.tags} empty={t("evaluationRuns:noTags")} />
        </div>
      </div>

      <RecordCollection
        title={t("evaluationRuns:retrievedDocuments")}
        empty={t("evaluationRuns:noDocuments")}
        values={result.retrieved_documents}
      />
      <RecordCollection
        title={t("evaluationRuns:rerankedDocuments")}
        empty={t("evaluationRuns:noDocuments")}
        values={result.reranked_documents}
      />
      <RecordCollection
        title={t("evaluationRuns:citations")}
        empty={t("evaluationRuns:noCitations")}
        values={citations}
      />
      <RecordCollection
        title={t("evaluationRuns:citationEvidence")}
        empty={t("evaluationRuns:noEvidence")}
        values={result.citation_evidence}
      />

      <div className={styles.resultSection}>
        <h4>{t("evaluationRuns:metrics")}</h4>
        <div className={styles.tableScroll}>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th>{t("qualityGates:checkMetric")}</th>
                <th>{t("qualityGates:checkActual")}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(result.metrics).map(([metric, value]) => (
                <tr key={metric}>
                  <th scope="row">
                    <span>{CASE_METRIC_LABELS[metric] ? t(CASE_METRIC_LABELS[metric]) : metricLabel(t, metric)}</span>
                    <code title={t("evaluationRuns:metricRawKeyTitle", { metric })}>{metric}</code>
                  </th>
                  <td><CaseMetricValue metric={metric} value={value} locale={locale} unavailable={unavailable} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </article>
  );
}

export function EvaluationReport({ runId }: { runId: string }) {
  const { t, i18n } = useTranslation(["evaluationRuns", "qualityGates"]);
  const { api } = useAuth();
  const locale = i18n.language as AppLocale;
  const report = useQuery({
    queryKey: ["evaluation-report", runId],
    queryFn: () => api.getEvaluationRunReport(runId),
  });
  const unavailable = t("evaluationRuns:valueUnavailable");

  if (report.isLoading) {
    return <section className={styles.loading} aria-busy="true">{t("evaluationRuns:reportLoading")}</section>;
  }
  if (report.isError) {
    return <OperationError error={report.error} onRetry={() => void report.refetch()} />;
  }
  if (!report.data) return null;

  return (
    <div className={styles.reportStack}>
      <section className={styles.panel} aria-labelledby="evaluation-summary-title">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="evaluation-summary-title">{t("evaluationRuns:summaryTitle")}</h2>
            <p>{t("evaluationRuns:summaryDescription")}</p>
          </div>
        </div>
        <dl className={styles.metricGrid}>
          {SUMMARY_METRICS.map((metric) => (
            <div key={metric.key}>
              <dt title={t("evaluationRuns:metricRawKeyTitle", { metric: metric.key })}>
                {t(metric.labelKey)}
              </dt>
              <dd className={styles.monoMetric}>
                {formatMetricValue(locale, metric.key, report.data.run.summary[metric.key], unavailable)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <details className={styles.detailsPanel}>
        <summary>{t("evaluationRuns:configTitle")}</summary>
        <p>{t("evaluationRuns:configDescription")}</p>
        <pre className={styles.jsonBlock}>{json(report.data.run.config_snapshot)}</pre>
      </details>

      <section className={styles.reportCases} aria-labelledby="evaluation-cases-report-title">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="evaluation-cases-report-title">{t("evaluationRuns:perCaseTitle")}</h2>
            <p>{t("evaluationRuns:perCaseDescription")}</p>
          </div>
        </div>
        {report.data.results.length === 0 ? (
          <EmptyState
            title={t("evaluationRuns:reportEmptyTitle")}
            description={t("evaluationRuns:reportEmptyDetail")}
            headingLevel={2}
          />
        ) : (
          <div className={styles.caseResultList}>
            {report.data.results.map((result, index) => (
              <CaseResult key={result.id} result={result} index={index} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
