import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import type { Citation } from "@/api/types";
import { linkifyCitationMarkers } from "./citations";
import styles from "./AnswerMarkdown.module.css";

type AnswerMarkdownProps = {
  answer: string;
  citations: Citation[];
  activeCitation: number | null;
  onCitationSelect: (index: number) => void;
};

function isSafeExternalHref(href: string | undefined): href is string {
  if (!href) return false;
  try {
    const url = new URL(href, window.location.origin);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

export function AnswerMarkdown({
  answer,
  citations,
  activeCitation,
  onCitationSelect,
}: AnswerMarkdownProps) {
  const { t } = useTranslation("evidence");
  const markdown = linkifyCitationMarkers(answer, citations);

  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a({ href, children }) {
            const match = href?.match(/^#evidence-(\d+)$/);
            if (match) {
              const index = Number(match[1]);
              return (
                <button
                  id={`answer-citation-${index}`}
                  type="button"
                  className={`${styles.citation} ${activeCitation === index ? styles.active : ""}`}
                  onClick={() => onCitationSelect(index)}
                  aria-label={t("citationInAnswer", { index: index + 1 })}
                  aria-pressed={activeCitation === index}
                >
                  {children}
                </button>
              );
            }
            if (!isSafeExternalHref(href)) return <>{children}</>;
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
          img() {
            // Prevent external image tracking and untrusted remote media.
            return null;
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
