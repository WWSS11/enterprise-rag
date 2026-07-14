import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/auth/useAuth";
import { RETURN_PATH_KEY, safeReturnPath } from "@/auth/sessionPaths";
import { AppLoadingSkeleton } from "@/components/AppLoadingSkeleton";
import { Button } from "@/components/Button";
import styles from "./CallbackPage.module.css";

export function CallbackPage() {
  const { t } = useTranslation(["auth", "common"]);
  const { completeLogin } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      try {
        await completeLogin();

        const stored = window.sessionStorage.getItem(RETURN_PATH_KEY);
        window.sessionStorage.removeItem(RETURN_PATH_KEY);
        const target = safeReturnPath(stored);
        navigate(target, { replace: true });
      } catch (err) {
        if (disposed) return;
        setError(err instanceof Error ? err.message : t("auth:signInFailed"));
      }
    })();

    return () => {
      disposed = true;
    };
  }, [completeLogin, navigate, t]);

  if (error) {
    return (
      <div className={styles.page}>
        <section className={styles.panel} role="alert">
          <h1 className={styles.title}>{t("auth:signInIncompleteTitle")}</h1>
          <p className={styles.detail}>{t("auth:signInIncompleteBody")}</p>
          <div className={styles.error}>{error}</div>
          <Button type="button" onClick={() => navigate("/login", { replace: true })}>
            {t("auth:backToSignIn")}
          </Button>
        </section>
      </div>
    );
  }

  return <AppLoadingSkeleton label={t("auth:completingSignIn")} />;
}
