import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/useAuth";
import { EmptyState } from "@/components/EmptyState";
import { OperationError } from "@/components/OperationError";
import { JobStatus } from "@/jobs/JobStatus";
import styles from "./JobsPage.module.css";

export function JobsPage() {
  const { t } = useTranslation("jobs");
  const { api } = useAuth();
  const jobs = useQuery({
    queryKey: ["jobs", "history"],
    queryFn: () => api.listJobs({ limit: 50 }),
    refetchInterval: 5000,
  });

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.kicker}>{t("kicker")}</div>
          <h1>{t("title")}</h1>
          <p>{t("subtitle")}</p>
        </div>
      </header>

      <p className={styles.scope}>{t("serverScope")}</p>

      {jobs.isError ? <OperationError error={jobs.error} onRetry={() => void jobs.refetch()} /> : null}
      {jobs.isLoading ? <p>{t("loading")}</p> : null}
      {jobs.data?.items.length === 0 ? (
        <EmptyState
          kicker={t("kicker")}
          title={t("emptyTitle")}
          description={t("emptyDetail")}
          headingLevel={2}
        />
      ) : (
        <section className={styles.list} aria-label={t("title")}>
          {jobs.data?.items.map((job) => (
            <JobStatus
              key={job.id}
              jobId={job.id}
              initialJob={job}
              onTerminal={() => void jobs.refetch()}
            />
          ))}
        </section>
      )}
    </div>
  );
}
