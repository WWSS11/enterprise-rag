import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconCopy } from "./icons";
import styles from "./CopyableValue.module.css";

type CopyableValueProps = {
  value: string;
  display?: string;
  label?: string;
  mono?: boolean;
};

export function CopyableValue({
  value,
  display,
  label,
  mono = true,
}: CopyableValueProps) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <span className={styles.wrap}>
      {label ? <span className={styles.label}>{label}</span> : null}
      <span className={`${styles.value} ${mono ? styles.mono : ""}`} title={value}>
        {display ?? value}
      </span>
      <button
        type="button"
        className={`${styles.copy} ${copied ? styles.copied : ""}`}
        onClick={() => void handleCopy()}
        aria-label={`${t("copy")}: ${value}`}
      >
        <IconCopy />
        <span>{copied ? t("copied") : t("copy")}</span>
      </button>
      <span className={styles.live} aria-live="polite">
        {copied ? t("copied") : ""}
      </span>
    </span>
  );
}
