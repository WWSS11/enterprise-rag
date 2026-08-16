import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import { citationSchema, type ChatMessage } from "@/api/types";
import { Button } from "@/components/Button";
import { formatDateTime } from "@/i18n/format";
import type { AppLocale } from "@/i18n";
import {
  DocumentPreviewDialog,
  type DocumentPreviewTarget,
} from "@/documents/DocumentPreviewDialog";
import { sourceLocationLabel } from "@/documents/sourceLocation";
import styles from "./ConversationTranscript.module.css";

type ConversationTranscriptProps = {
  messages: ChatMessage[];
  hasMore: boolean;
  loading: boolean;
  error: boolean;
  onLoadEarlier: () => void;
};

export function ConversationTranscript({
  messages,
  hasMore,
  loading,
  error,
  onLoadEarlier,
}: ConversationTranscriptProps) {
  const { t, i18n } = useTranslation(["chat", "documents"]);
  const locale = (i18n.resolvedLanguage ?? "zh-CN") as AppLocale;
  const [previewTarget, setPreviewTarget] = useState<DocumentPreviewTarget | null>(null);

  if (!messages.length && !loading && !error) return null;

  return (
    <section className={styles.transcript} aria-labelledby="conversation-transcript-title">
      <header className={styles.header}>
        <div>
          <h2 id="conversation-transcript-title">{t("transcriptTitle")}</h2>
          <p>{t("transcriptDetail")}</p>
        </div>
        {hasMore ? (
          <Button type="button" variant="secondary" disabled={loading} onClick={onLoadEarlier}>
            {loading ? t("loadingEarlier") : t("loadEarlier")}
          </Button>
        ) : null}
      </header>

      {error ? <p className={styles.error} role="alert">{t("transcriptError")}</p> : null}
      {loading && !messages.length ? <p className={styles.loading}>{t("loadingTranscript")}</p> : null}

      <ol className={styles.messages}>
        {messages.map((message) => {
          const citations = message.citations.flatMap((citation) => {
            const parsed = citationSchema.safeParse(citation);
            return parsed.success ? [parsed.data] : [];
          });
          return (
            <li key={message.id} className={message.role === "user" ? styles.user : styles.assistant}>
              <div className={styles.messageMeta}>
                <strong>{message.role === "user" ? t("roleUser") : t("roleAssistant")}</strong>
                <time dateTime={message.created_at}>{formatDateTime(locale, message.created_at)}</time>
              </div>
              {message.role === "assistant" ? (
                <div className={styles.markdown}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{message.content}</ReactMarkdown>
                </div>
              ) : (
                <p className={styles.userText}>{message.content}</p>
              )}
              {citations.length ? (
                <details className={styles.sources}>
                  <summary>{t("historicalEvidence", { count: citations.length })}</summary>
                  <ol>
                    {citations.map((citation, index) => (
                      <li key={`${message.id}-${citation.chunk_id}-${index}`}>
                        <strong>{citation.document_name}</strong>
                        <code>{citation.chunk_id}</code>
                        <span>{sourceLocationLabel(citation.location, t)}</span>
                        {citation.content_preview ? <p>{citation.content_preview}</p> : null}
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setPreviewTarget({
                            documentId: citation.document_id,
                            documentName: citation.document_name,
                            chunkId: citation.chunk_id,
                          })}
                        >
                          {t("documents:preview")}
                        </Button>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </li>
          );
        })}
      </ol>
      {previewTarget ? (
        <DocumentPreviewDialog
          target={previewTarget}
          onClose={() => setPreviewTarget(null)}
        />
      ) : null}
    </section>
  );
}
