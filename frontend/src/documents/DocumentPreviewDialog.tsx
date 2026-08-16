import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/Button";
import { IconClose } from "@/components/icons";
import { OperationError } from "@/components/OperationError";
import { useBodyScrollLock, useFocusTrap } from "@/hooks/useFocusTrap";
import { sourceLocationLabel } from "./sourceLocation";
import styles from "./DocumentPreviewDialog.module.css";

export type DocumentPreviewTarget = {
  documentId: string;
  documentName: string;
  chunkId?: string;
};

export function DocumentPreviewDialog({
  target,
  onClose,
}: {
  target: DocumentPreviewTarget;
  onClose: () => void;
}) {
  const { t } = useTranslation(["documents", "common"]);
  const { api } = useAuth();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const targetRef = useRef<HTMLElement>(null);
  const [downloadError, setDownloadError] = useState<unknown>(null);
  const [downloading, setDownloading] = useState(false);
  const preview = useQuery({
    queryKey: ["documents", target.documentId, "preview", target.chunkId ?? null],
    queryFn: () => api.getDocumentPreview(target.documentId, target.chunkId),
  });

  useFocusTrap(true, dialogRef, closeRef);
  useBodyScrollLock(true);

  useEffect(() => {
    if (!preview.data?.target_chunk_id) return;
    targetRef.current?.scrollIntoView?.({ block: "center" });
  }, [preview.data?.target_chunk_id]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function download() {
    setDownloading(true);
    setDownloadError(null);
    try {
      const blob = await api.downloadDocument(target.documentId);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = preview.data?.name ?? target.documentName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch (error) {
      setDownloadError(error);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <div className={styles.overlay} aria-hidden="true" onClick={onClose} />
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className={styles.header}>
          <div>
            <div className={styles.kicker}>{t("documents:previewTitle")}</div>
            <h2 id={titleId}>{target.documentName}</h2>
            <p>{t("documents:previewIndexedHint")}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            aria-label={t("documents:closePreview")}
            onClick={onClose}
          >
            <IconClose />
          </button>
        </header>

        {preview.isLoading ? (
          <p className={styles.loading} aria-busy="true">{t("documents:previewLoading")}</p>
        ) : null}
        {preview.isError ? (
          <OperationError error={preview.error} onRetry={() => void preview.refetch()} />
        ) : null}
        {preview.data?.target_location ? (
          <p className={styles.targetLocation}>
            <strong>{t("documents:targetExcerpt")}</strong>
            <span>{sourceLocationLabel(preview.data.target_location, t)}</span>
          </p>
        ) : null}
        {preview.data?.truncated ? (
          <p className={styles.truncated} role="status">
            {t("documents:previewTruncated", { count: preview.data.sections.length })}
          </p>
        ) : null}
        {preview.data ? (
          <div className={styles.sections}>
            {preview.data.sections.map((section) => (
              <article
                key={section.section_index}
                ref={section.is_target ? targetRef : undefined}
                className={`${styles.section} ${section.is_target ? styles.target : ""}`}
              >
                <header>
                  <strong>{section.is_target ? t("documents:targetExcerpt") : t("documents:nearbyExcerpt")}</strong>
                  <span>{sourceLocationLabel(section.location, t)}</span>
                </header>
                {section.title ? <h3>{section.title}</h3> : null}
                <pre>{section.content}</pre>
              </article>
            ))}
          </div>
        ) : null}
        {downloadError ? <OperationError error={downloadError} /> : null}
        <footer className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("documents:closePreview")}
          </Button>
          <Button
            type="button"
            disabled={!preview.data?.download_available || downloading}
            onClick={() => void download()}
          >
            {downloading ? t("documents:downloading") : t("documents:download")}
          </Button>
        </footer>
      </div>
    </>
  );
}
