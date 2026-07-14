import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/auth/useAuth";
import { config } from "@/config/env";
import { Button } from "@/components/Button";
import { AppLoadingSkeleton } from "@/components/AppLoadingSkeleton";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { consumeJustLoggedOut } from "@/auth/sessionPaths";
import styles from "./LoginPage.module.css";

function returnPathFromState(state: unknown): string | null {
  if (
    typeof state === "object" &&
    state &&
    "from" in state &&
    typeof (state as { from?: unknown }).from === "string"
  ) {
    return (state as { from: string }).from;
  }
  return null;
}

export function LoginPage() {
  const { t } = useTranslation(["auth", "common"]);
  const { status, isAuthenticated, login } = useAuth();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const autoStarted = useRef(false);
  const skipAuto = useRef(
    consumeJustLoggedOut() ||
      new URLSearchParams(location.search).get("logged_out") === "1",
  );

  const returnPath = returnPathFromState(location.state) ?? "/app/chat";

  useEffect(() => {
    if (status !== "anonymous") return;
    if (skipAuto.current) return;
    if (!returnPathFromState(location.state)) return;
    if (autoStarted.current || pending) return;
    autoStarted.current = true;
    setPending(true);
    void login(returnPath).catch((err: unknown) => {
      setPending(false);
      autoStarted.current = false;
      setError(err instanceof Error ? err.message : t("auth:signInFailed"));
    });
  }, [status, location.state, login, returnPath, pending, t]);

  if (status === "bootstrapping") {
    return <AppLoadingSkeleton label={t("auth:checkingSession")} />;
  }

  if (isAuthenticated) {
    return <Navigate to={returnPath} replace />;
  }

  async function handleLogin() {
    setError(null);
    setPending(true);
    skipAuto.current = false;
    try {
      await login(returnPath);
    } catch (err) {
      setPending(false);
      setError(err instanceof Error ? err.message : t("auth:signInFailed"));
    }
  }

  return (
    <div className={styles.page}>
      <main id="main-content" className={styles.card} tabIndex={-1} aria-labelledby="login-title">
        <div className={styles.brand}>
          <div className={styles.mark} aria-hidden="true">
            ED
          </div>
          <div>
            <h1 id="login-title" className={styles.title}>
              {t("auth:loginTitle")}
            </h1>
          </div>
        </div>

        <p className={styles.lead}>{t("auth:loginLead")}</p>

        <div className={styles.facts} aria-label={t("auth:connection")}>
          <div className={styles.fact}>
            <span className={styles.factLabel}>{t("auth:authority")}</span>
            <span className={styles.factValue}>{config.oidc.authority}</span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factLabel}>{t("auth:client")}</span>
            <span className={styles.factValue}>{config.oidc.clientId}</span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factLabel}>{t("auth:api")}</span>
            <span className={styles.factValue}>{config.apiBaseUrl}</span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factLabel}>{t("auth:flow")}</span>
            <span className={styles.factValue}>{t("auth:flowValue")}</span>
          </div>
        </div>

        {error ? (
          <div className={styles.error} role="alert">
            {error}
          </div>
        ) : null}

        <div className={styles.actions}>
          <Button type="button" fullWidth disabled={pending} onClick={() => void handleLogin()}>
            {pending ? t("auth:redirectingIdp") : t("auth:continueSso")}
          </Button>
          <p className={styles.note}>{t("auth:loginNote")}</p>
          <LanguageSwitcher />
        </div>
      </main>
    </div>
  );
}
