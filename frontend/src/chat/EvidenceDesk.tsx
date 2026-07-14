import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Citation } from "@/api/types";
import type { ChatStreamMetadata } from "@/chat/streamEvents";
import { Button } from "@/components/Button";
import { IconClose } from "@/components/icons";
import { useBodyScrollLock, useFocusTrap } from "@/hooks/useFocusTrap";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import styles from "./EvidenceDesk.module.css";

type EvidenceOutcome = "pending" | "grounded" | "no_evidence" | "empty";

type EvidenceDeskProps = {
  citations: Citation[];
  metadata: ChatStreamMetadata;
  outcome: EvidenceOutcome;
  activeCitation: number | null;
  onCitationSelect: (index: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presentation: "desktop" | "mobile";
};

function EvidenceList({
  citations,
  outcome,
  activeCitation,
  onCitationSelect,
}: Pick<
  EvidenceDeskProps,
  "citations" | "outcome" | "activeCitation" | "onCitationSelect"
>) {
  const { t, i18n } = useTranslation("evidence");
  const formatter = new Intl.NumberFormat(i18n.language, {
    style: "percent",
    maximumFractionDigits: 1,
  });

  if (citations.length === 0) {
    const completedWithoutEvidence = outcome === "no_evidence" || outcome === "empty";
    return (
      <div className={styles.empty}>
        <h3>{t(completedWithoutEvidence ? "noEvidenceTitle" : "emptyTitle")}</h3>
        <p>{t(completedWithoutEvidence ? "noEvidenceDetail" : "emptyDetail")}</p>
      </div>
    );
  }

  return (
    <ol className={styles.list}>
      {citations.map((citation, index) => {
        const active = activeCitation === index;
        return (
          <li key={`${citation.document_id}:${citation.chunk_id}`}>
            <article
              id={`evidence-citation-${index}`}
              className={`${styles.item} ${active ? styles.active : ""}`}
              aria-current={active ? "true" : undefined}
            >
              <button
                type="button"
                className={styles.itemButton}
                onClick={() => onCitationSelect(index)}
                aria-label={t("evidenceItem", { index: index + 1 })}
              >
                <span className={styles.index}>{index + 1}</span>
                <span className={styles.itemBody}>
                  <span className={styles.documentName}>{citation.document_name}</span>
                  <span className={styles.meta}>
                    <code>{citation.chunk_id}</code>
                    <span>{formatter.format(citation.score)}</span>
                  </span>
                  <span className={styles.preview}>{citation.content_preview}</span>
                  <span className={styles.locate}>{t("locateInAnswer")}</span>
                </span>
              </button>
            </article>
          </li>
        );
      })}
    </ol>
  );
}

function EvidenceMetadata({ metadata }: { metadata: ChatStreamMetadata }) {
  const { t } = useTranslation("evidence");
  const hasCounts =
    metadata.retrieved_count !== undefined || metadata.reranked_count !== undefined;
  const hasDiagnostics =
    metadata.citation_diagnostics !== undefined &&
    Object.keys(metadata.citation_diagnostics).length > 0;

  if (!hasCounts && !hasDiagnostics) return null;

  return (
    <div className={styles.metadata}>
      {hasCounts ? (
        <dl className={styles.counts}>
          {metadata.retrieved_count !== undefined ? (
            <div>
              <dt>{t("retrievedCount", { count: metadata.retrieved_count })}</dt>
              <dd>{metadata.retrieved_count}</dd>
            </div>
          ) : null}
          {metadata.reranked_count !== undefined ? (
            <div>
              <dt>{t("rerankedCount", { count: metadata.reranked_count })}</dt>
              <dd>{metadata.reranked_count}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {hasDiagnostics ? (
        <details className={styles.diagnostics}>
          <summary>{t("diagnostics")}</summary>
          <pre>{JSON.stringify(metadata.citation_diagnostics, null, 2)}</pre>
        </details>
      ) : null}
    </div>
  );
}

export function EvidenceDesk({
  citations,
  metadata,
  outcome,
  activeCitation,
  onCitationSelect,
  open,
  onOpenChange,
  presentation,
}: EvidenceDeskProps) {
  const { t } = useTranslation("evidence");
  const mobile = useMediaQuery("(max-width: 780px)");
  const titleId = useId();
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useFocusTrap(mobile && open, drawerRef, closeRef);
  useBodyScrollLock(mobile && open);

  if (presentation === "desktop") {
    if (mobile) return null;
    return (
      <aside className={styles.desktop} aria-labelledby={titleId}>
        <header className={styles.header}>
          <div>
            <h2 id={titleId}>{t("title")}</h2>
            <p>{t("sourceCount", { count: citations.length })}</p>
          </div>
        </header>
        <p className={styles.subtitle}>{t("subtitle")}</p>
        <EvidenceMetadata metadata={metadata} />
        <EvidenceList
          citations={citations}
          outcome={outcome}
          activeCitation={activeCitation}
          onCitationSelect={onCitationSelect}
        />
      </aside>
    );
  }

  if (!mobile) return null;

  const handleMobileCitation = (index: number) => {
    onOpenChange(false);
    window.setTimeout(() => onCitationSelect(index), 0);
  };

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className={styles.mobileTrigger}
        onClick={() => onOpenChange(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {t("openDrawer")} · {citations.length}
      </Button>
      {open ? (
        <>
          <div className={styles.overlay} aria-hidden="true" onClick={() => onOpenChange(false)} />
          <div
            ref={drawerRef}
            className={styles.drawer}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <header className={styles.drawerHeader}>
              <div>
                <h2 id={titleId}>{t("title")}</h2>
                <p>{t("sourceCount", { count: citations.length })}</p>
              </div>
              <button
                ref={closeRef}
                type="button"
                className={styles.close}
                aria-label={t("closeDrawer")}
                onClick={() => onOpenChange(false)}
              >
                <IconClose />
              </button>
            </header>
            <p className={styles.subtitle}>{t("subtitle")}</p>
            <EvidenceMetadata metadata={metadata} />
            <EvidenceList
              citations={citations}
              outcome={outcome}
              activeCitation={activeCitation}
              onCitationSelect={handleMobileCitation}
            />
          </div>
        </>
      ) : null}
    </>
  );
}
