import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AppLocale } from "@/i18n";
import { formatDateTime, formatNumber } from "@/i18n/format";
import type { DocumentRecord, DocumentUploadAccepted, KnowledgeBase } from "@/api/types";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { OperationError } from "@/components/OperationError";
import { StatusPill, type StatusTone } from "@/components/StatusPill";
import { JobStatus } from "@/jobs/JobStatus";
import { usePageVisibility } from "@/hooks/usePageVisibility";
import styles from "./DocumentOperations.module.css";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".xml",
  ".pdf",
  ".docx",
  ".pptx",
  ".xlsx",
  ".xlsm",
  ".xls",
  ".html",
  ".htm",
] as const;

const ACTIVE_DOCUMENT_STATUSES = new Set<DocumentRecord["status"]>([
  "pending",
  "queued",
  "processing",
  "reindexing",
  "deleting",
]);

type UploadState = "idle" | "uploading" | "accepted" | "cancelled" | "error";

function fileExtension(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

function formatBytes(locale: AppLocale, bytes: number): string {
  if (bytes < 1024) return `${formatNumber(locale, bytes)} B`;
  if (bytes < 1024 * 1024) {
    return `${formatNumber(locale, bytes / 1024, { maximumFractionDigits: 1 })} KB`;
  }
  return `${formatNumber(locale, bytes / (1024 * 1024), { maximumFractionDigits: 1 })} MB`;
}

function documentStatus(
  status: DocumentRecord["status"],
  t: (key: string, options?: Record<string, unknown>) => string,
): { label: string; tone: StatusTone } {
  if (status === "pending") {
    return { label: t("documents:statusPending"), tone: "loading" };
  }
  if (status === "queued") return { label: t("documents:statusQueued"), tone: "loading" };
  if (status === "processing") {
    return { label: t("documents:statusProcessing"), tone: "loading" };
  }
  if (status === "ready") return { label: t("documents:statusReady"), tone: "ok" };
  if (status === "failed") return { label: t("documents:statusFailed"), tone: "error" };
  if (status === "reindexing") {
    return { label: t("documents:statusReindexing"), tone: "loading" };
  }
  if (status === "deleting") {
    return { label: t("documents:statusDeleting"), tone: "degraded" };
  }
  return { label: t("documents:statusUnknown", { status }), tone: "unknown" };
}

function hasActiveDocuments(documents: DocumentRecord[] | undefined): boolean {
  return Boolean(documents?.some((document) => ACTIVE_DOCUMENT_STATUSES.has(document.status)));
}

export function DocumentOperations({
  knowledgeBase,
  canEdit,
}: {
  knowledgeBase: KnowledgeBase;
  canEdit: boolean;
}) {
  const { t, i18n } = useTranslation(["documents", "jobs", "knowledgeBases", "common"]);
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const visible = usePageVisibility();
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<DocumentUploadAccepted | null>(null);
  const [scanRootAlias, setScanRootAlias] = useState("default");
  const [scanJobId, setScanJobId] = useState<string | null>(null);
  const [scanError, setScanError] = useState<unknown>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [documentActionError, setDocumentActionError] = useState<{
    documentId: string;
    action: "reindex" | "delete";
    error: unknown;
  } | null>(null);
  const [documentJobs, setDocumentJobs] = useState<Record<string, string>>({});
  const locale = i18n.language as AppLocale;

  const documents = useQuery({
    queryKey: ["documents", knowledgeBase.id],
    queryFn: () => api.listDocuments(knowledgeBase.id),
    refetchInterval: (query) =>
      visible && hasActiveDocuments(query.state.data) ? 3000 : false,
    refetchIntervalInBackground: false,
  });

  function selectFile(nextFile: File | null) {
    setFile(nextFile);
    setUploadState("idle");
    setUploadProgress(0);
    setUploadError(null);
    setValidationError(null);
    setAccepted(null);
  }

  function validateFile(selected: File): string | null {
    if (selected.size > MAX_UPLOAD_BYTES) return t("documents:fileTooLarge");
    if (!SUPPORTED_DOCUMENT_EXTENSIONS.includes(fileExtension(selected.name) as never)) {
      return t("documents:unsupportedFile");
    }
    return null;
  }

  async function startUpload() {
    if (!file || uploadState === "uploading") return;
    const invalid = validateFile(file);
    if (invalid) {
      setValidationError(invalid);
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setUploadState("uploading");
    setUploadProgress(0);
    setUploadError(null);
    setValidationError(null);
    setAccepted(null);

    try {
      const result = await api.uploadDocument(
        file,
        knowledgeBase.id,
        (progress) => setUploadProgress(progress.percent),
        controller.signal,
      );
      setAccepted(result);
      setUploadState("accepted");
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      await queryClient.invalidateQueries({ queryKey: ["documents", knowledgeBase.id] });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setUploadState("cancelled");
      } else {
        setUploadState("error");
        setUploadError(error);
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }

  function cancelUpload() {
    controllerRef.current?.abort();
  }

  async function startScan() {
    const rootAlias = scanRootAlias.trim();
    if (!rootAlias || pendingAction) return;
    setPendingAction("scan");
    setScanError(null);
    try {
      const job = await api.scanDocuments({
        root_alias: rootAlias,
        knowledge_base_id: knowledgeBase.id,
      });
      setScanJobId(job.id);
    } catch (error) {
      setScanError(error);
    } finally {
      setPendingAction(null);
    }
  }

  async function runDocumentAction(
    document: DocumentRecord,
    action: "reindex" | "delete",
  ) {
    const actionKey = `${action}:${document.id}`;
    if (pendingAction) return;
    if (action === "delete" && !window.confirm(t("documents:deleteConfirm", { name: document.name }))) {
      return;
    }
    setPendingAction(actionKey);
    setDocumentActionError(null);
    try {
      const job =
        action === "reindex"
          ? await api.reindexDocument(document.id)
          : await api.deleteDocument(document.id);
      setDocumentJobs((current) => ({ ...current, [document.id]: job.id }));
      await queryClient.invalidateQueries({ queryKey: ["documents", knowledgeBase.id] });
    } catch (error) {
      setDocumentActionError({ documentId: document.id, action, error });
    } finally {
      setPendingAction(null);
    }
  }

  function refreshDocumentsAfterJob() {
    void queryClient.invalidateQueries({ queryKey: ["documents", knowledgeBase.id] });
  }

  return (
    <div className={styles.root}>
      {canEdit ? (
        <>
          <section className={styles.upload} aria-labelledby="document-scan-title">
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="document-scan-title">{t("documents:scanTitle")}</h2>
                <p>{t("documents:scanDetail")}</p>
              </div>
            </div>
            <div className={styles.inlineOperation}>
              <label htmlFor="document-scan-root">{t("documents:scanRootAlias")}</label>
              <input
                id="document-scan-root"
                value={scanRootAlias}
                maxLength={64}
                onChange={(event) => setScanRootAlias(event.target.value)}
              />
              <Button
                type="button"
                disabled={!scanRootAlias.trim() || pendingAction === "scan"}
                onClick={() => void startScan()}
              >
                {pendingAction === "scan" ? t("documents:scanStarting") : t("documents:scanStart")}
              </Button>
            </div>
            <p className={styles.fieldHint}>{t("documents:scanRootHint")}</p>
            {scanError ? <OperationError error={scanError} onRetry={() => void startScan()} /> : null}
            {scanJobId ? (
              <JobStatus jobId={scanJobId} onTerminal={refreshDocumentsAfterJob} />
            ) : null}
          </section>

          <section className={styles.upload} aria-labelledby="document-upload-title">
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="document-upload-title">{t("documents:uploadTitle")}</h2>
              <p>{t("documents:uploadDetail")}</p>
            </div>
          </div>

          <div className={styles.constraints} id="document-upload-constraints">
            <strong>{t("documents:limits")}</strong>
            <span>{t("documents:supportedFormats")}</span>
          </div>

          <div className={styles.fileLine}>
            <input
              ref={inputRef}
              className={styles.fileInput}
              id="document-file"
              type="file"
              accept={SUPPORTED_DOCUMENT_EXTENSIONS.join(",")}
              disabled={uploadState === "uploading"}
              aria-describedby="document-upload-constraints"
              onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
            />
            <label className={styles.fileLabel} htmlFor="document-file">
              {t("documents:chooseFile")}
            </label>
            <span className={styles.fileName}>
              {file ? t("documents:selectedFile", { name: file.name }) : t("documents:noFile")}
            </span>
          </div>

          {validationError ? (
            <p className={styles.validation} role="alert">{validationError}</p>
          ) : null}

          {uploadState === "uploading" ? (
            <div className={styles.transfer} aria-live="polite">
              <div>
                <span>{t("documents:uploading")}</span>
                <strong>{uploadProgress}%</strong>
              </div>
              <progress max={100} value={uploadProgress} aria-label={t("documents:transferProgress", { percent: uploadProgress })} />
            </div>
          ) : null}

          {uploadState === "cancelled" ? (
            <p className={styles.cancelled} role="status">{t("documents:uploadCancelled")}</p>
          ) : null}

          {uploadState === "accepted" && accepted ? (
            <div className={styles.accepted} role="status">
              <strong>{t("documents:uploadAccepted")}</strong>
              <code>{accepted.document.id}</code>
              <code>{accepted.job_id}</code>
            </div>
          ) : null}

          {uploadState === "error" ? (
            <OperationError error={uploadError} />
          ) : null}

          <div className={styles.uploadActions}>
            {uploadState === "uploading" ? (
              <Button type="button" variant="danger" onClick={cancelUpload}>
                {t("documents:cancel")}
              </Button>
            ) : (
              <Button type="button" disabled={!file} onClick={() => void startUpload()}>
                {uploadState === "error" || uploadState === "cancelled"
                  ? t("documents:retryUpload")
                  : t("documents:upload")}
              </Button>
            )}
          </div>

            {accepted ? (
              <JobStatus jobId={accepted.job_id} onTerminal={refreshDocumentsAfterJob} />
            ) : null}
          </section>
        </>
      ) : (
        <section className={styles.readOnly} aria-labelledby="documents-read-only-title">
          <h2 id="documents-read-only-title">{t("documents:readOnlyTitle")}</h2>
          <p>{t("documents:readOnlyDetail")}</p>
        </section>
      )}

      <section className={styles.documents} aria-labelledby="document-list-title">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="document-list-title">{t("documents:listTitle")}</h2>
          </div>
          <Button type="button" variant="secondary" onClick={() => void documents.refetch()}>
            {t("documents:refresh")}
          </Button>
        </div>

        {documents.isLoading ? (
          <p className={styles.loading} aria-busy="true">{t("documents:loading")}</p>
        ) : null}
        {documents.isError ? (
          <OperationError error={documents.error} onRetry={() => void documents.refetch()} />
        ) : null}
        {documents.data?.length === 0 ? (
          <EmptyState
            title={t("documents:emptyTitle")}
            description={t("documents:emptyDetail")}
            headingLevel={2}
          />
        ) : null}

        {documents.data && documents.data.length > 0 ? (
          <ul className={styles.documentList}>
            {documents.data.map((document) => {
              const status = documentStatus(document.status, t);
              const active = ACTIVE_DOCUMENT_STATUSES.has(document.status);
              const reindexAction = `reindex:${document.id}`;
              const deleteAction = `delete:${document.id}`;
              const documentJobId = documentJobs[document.id];
              return (
                <li key={document.id} className={styles.documentRow}>
                  <div className={styles.documentMain}>
                    <strong>{document.name}</strong>
                    <code title={document.id}>{document.id}</code>
                    {document.error_message ? (
                      <p className={styles.documentError} role="alert">
                        <span>{t("documents:errorReason")}</span>
                        {document.error_message}
                      </p>
                    ) : null}
                  </div>
                  <dl className={styles.documentFacts}>
                    <div>
                      <dt>{t("documents:status")}</dt>
                      <dd><StatusPill tone={status.tone} label={status.label} /></dd>
                    </div>
                    <div>
                      <dt>{t("documents:size")}</dt>
                      <dd>{formatBytes(locale, document.size_bytes)}</dd>
                    </div>
                    <div>
                      <dt>{t("documents:contentType")}</dt>
                      <dd>{document.content_type || "—"}</dd>
                    </div>
                    <div>
                      <dt>{t("documents:chunks")}</dt>
                      <dd>{formatNumber(locale, document.chunk_count)}</dd>
                    </div>
                    <div>
                      <dt>{t("documents:updatedAt")}</dt>
                      <dd>{formatDateTime(locale, document.updated_at)}</dd>
                    </div>
                  </dl>
                  {canEdit ? (
                    <div className={styles.documentActions}>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={active || !document.source_uri || pendingAction !== null}
                        title={!document.source_uri ? t("documents:reindexUnavailable") : undefined}
                        onClick={() => void runDocumentAction(document, "reindex")}
                      >
                        {pendingAction === reindexAction
                          ? t("documents:reindexStarting")
                          : t("documents:reindex")}
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        disabled={active || pendingAction !== null}
                        onClick={() => void runDocumentAction(document, "delete")}
                      >
                        {pendingAction === deleteAction
                          ? t("documents:deleteStarting")
                          : t("documents:delete")}
                      </Button>
                    </div>
                  ) : null}
                  {documentActionError?.documentId === document.id ? (
                    <div className={styles.documentOperationResult}>
                      <OperationError
                        error={documentActionError.error}
                        onRetry={() =>
                          void runDocumentAction(document, documentActionError.action)
                        }
                      />
                    </div>
                  ) : null}
                  {documentJobId ? (
                    <div className={styles.documentOperationResult}>
                      <JobStatus jobId={documentJobId} onTerminal={refreshDocumentsAfterJob} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
