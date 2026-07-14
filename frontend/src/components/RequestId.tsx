import { useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./RequestId.module.css";

type RequestIdProps = {
  requestId: string | null | undefined;
  label?: string;
};

export function RequestId({ requestId, label }: RequestIdProps) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);
  const resolvedLabel = label ?? t("requestId");

  if (!requestId) {
    return null;
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(requestId!);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <span className={styles.label}>{resolvedLabel}</span>
      <code className={styles.value} title={requestId}>
        {requestId}
      </code>
      <button
        type="button"
        className={`${styles.copy} ${copied ? styles.copied : ""}`}
        onClick={() => void handleCopy()}
        aria-label={t("copyRequestId")}
      >
        {copied ? t("copied") : t("copy")}
      </button>
    </div>
  );
}
