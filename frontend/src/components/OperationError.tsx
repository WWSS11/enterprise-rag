import { useId } from "react";
import { useTranslation } from "react-i18next";
import { localizeApiError } from "@/i18n/apiError";
import { Button } from "./Button";
import { RequestId } from "./RequestId";
import { TechnicalDetails } from "./TechnicalDetails";
import styles from "./OperationError.module.css";

type OperationErrorProps = {
  error: unknown;
  onRetry?: () => void;
  retryLabel?: string;
};

export function OperationError({ error, onRetry, retryLabel }: OperationErrorProps) {
  const { t } = useTranslation(["errors", "common"]);
  const titleId = useId();
  const localized = localizeApiError((key, options) => t(key, options), error, {
    retryAfterHeader:
      error && typeof error === "object" && "retryAfter" in error
        ? String(error.retryAfter ?? "")
        : null,
  });

  return (
    <section className={styles.root} role="alert" aria-labelledby={titleId}>
      <div className={styles.copy}>
        <h2 id={titleId}>{localized.title}</h2>
        <p>{localized.action}</p>
      </div>
      <RequestId requestId={localized.requestId} />
      <TechnicalDetails detail={localized.serverDetail} />
      {onRetry ? (
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onRetry}>
            {retryLabel ?? t("common:retry")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
