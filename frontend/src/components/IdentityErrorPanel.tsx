import { useTranslation } from "react-i18next";
import { isApiError } from "@/api/errors";
import { localizeApiError } from "@/i18n/apiError";
import { RequestId } from "./RequestId";
import { Button } from "./Button";
import { TechnicalDetails } from "./TechnicalDetails";
import styles from "./IdentityErrorPanel.module.css";

type IdentityErrorPanelProps = {
  error: unknown;
  onRetry: () => void;
  onLogout: () => void;
};

export function IdentityErrorPanel({ error, onRetry, onLogout }: IdentityErrorPanelProps) {
  const { t } = useTranslation();
  const localized = localizeApiError((key, options) => t(key, options), error);
  const requestId = isApiError(error) ? error.requestId : null;
  const serverDetail =
    localized.serverDetail ||
    (error instanceof Error ? error.message : t("auth:identityLoadFailed"));

  return (
    <div className={styles.page}>
      <main id="main-content" className={styles.panel} tabIndex={-1} aria-labelledby="identity-error-title">
        <h1 id="identity-error-title" className={styles.title}>
          {t("auth:identityUnavailableTitle")}
        </h1>
        <p className={styles.detail}>{t("auth:identityUnavailableBody")}</p>
        <p className={styles.detail}>
          <strong>{localized.title}</strong> — {localized.action}
        </p>
        <RequestId requestId={requestId} />
        <TechnicalDetails detail={serverDetail} />
        <div className={styles.actions}>
          <Button type="button" onClick={onRetry}>
            {t("auth:retryIdentity")}
          </Button>
          <Button type="button" variant="secondary" onClick={onLogout}>
            {t("common:signOut")}
          </Button>
        </div>
      </main>
    </div>
  );
}
