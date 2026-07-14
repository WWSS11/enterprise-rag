import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/useAuth";
import { StatusPill, type StatusTone } from "./StatusPill";
import styles from "./ApiHealth.module.css";

function toneForStatus(status: string | undefined, isError: boolean, isLoading: boolean): StatusTone {
  if (isLoading) return "loading";
  if (isError) return "error";
  if (status === "ok") return "ok";
  if (status === "degraded") return "degraded";
  return "unknown";
}

export function ApiHealth() {
  const { t } = useTranslation("system");
  const { api } = useAuth();

  const live = useQuery({
    queryKey: ["health", "live"],
    queryFn: () => api.getLiveHealth(),
    refetchInterval: 30_000,
    retry: 1,
  });

  const tone = toneForStatus(live.data?.status, live.isError, live.isLoading || live.isFetching);
  const label = live.isLoading
    ? t("apiChecking")
    : live.isError
      ? t("apiUnreachable")
      : live.data?.status === "ok"
        ? t("apiLive")
        : live.data?.status === "degraded"
          ? t("apiDegraded")
          : t("apiStatus", { status: live.data?.status ?? t("unknown", { ns: "common" }) });
  const version = live.data?.version;
  const title = live.error instanceof Error ? live.error.message : t("apiHealthLink", { ns: "common" });

  return (
    <Link
      to="/app/system"
      className={styles.wrap}
      title={title}
      aria-label={t("apiHealthLink", { ns: "common" })}
    >
      <StatusPill tone={tone} label={label} />
      {version ? <span className={`${styles.detail} mono`}>{version}</span> : null}
    </Link>
  );
}
