import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/Button";
import styles from "./StatusPages.module.css";

export function ForbiddenPage() {
  const { t } = useTranslation(["errors", "common"]);

  return (
    <div className={styles.page}>
      <main id="main-content" className={styles.panel} tabIndex={-1} aria-labelledby="forbidden-title">
        <div className={styles.code}>{t("errors:forbiddenCode")}</div>
        <h1 id="forbidden-title" className={styles.title}>
          {t("errors:forbiddenTitle")}
        </h1>
        <p className={styles.detail}>{t("errors:forbiddenBody")}</p>
        <div className={styles.actions}>
          <Button type="button" onClick={() => window.history.back()}>
            {t("common:back")}
          </Button>
          <Link to="/app/chat">
            <Button type="button" variant="secondary">
              {t("common:openChat")}
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation(["errors", "common"]);
  const { isAuthenticated } = useAuth();

  return (
    <div className={styles.page}>
      <main id="main-content" className={styles.panel} tabIndex={-1} aria-labelledby="not-found-title">
        <div className={styles.code}>{t("errors:notFoundCode")}</div>
        <h1 id="not-found-title" className={styles.title}>
          {t("errors:notFoundTitle")}
        </h1>
        <p className={styles.detail}>{t("errors:notFoundBody")}</p>
        <div className={styles.actions}>
          <Link to={isAuthenticated ? "/app/chat" : "/login"}>
            <Button type="button">
              {isAuthenticated ? t("common:goHome") : t("common:signIn")}
            </Button>
          </Link>
          {isAuthenticated ? (
            <Link to="/app/system">
              <Button type="button" variant="secondary">
                {t("common:openSystem")}
              </Button>
            </Link>
          ) : null}
        </div>
      </main>
    </div>
  );
}
