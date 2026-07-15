import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/EmptyState";
import { JobStatus } from "@/jobs/JobStatus";
import { forgetJobId, readKnownJobIds } from "@/jobs/jobStorage";
import styles from "./JobsPage.module.css";

export function JobsPage() {
  const { t } = useTranslation("jobs");
  const [jobIds, setJobIds] = useState(readKnownJobIds);

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.kicker}>{t("kicker")}</div>
          <h1>{t("title")}</h1>
          <p>{t("subtitle")}</p>
        </div>
      </header>

      <p className={styles.scope}>{t("sessionScope")}</p>

      {jobIds.length === 0 ? (
        <EmptyState
          kicker={t("kicker")}
          title={t("emptyTitle")}
          description={t("emptyDetail")}
          headingLevel={2}
        />
      ) : (
        <section className={styles.list} aria-label={t("title")}>
          {jobIds.map((jobId) => (
            <JobStatus
              key={jobId}
              jobId={jobId}
              onForget={() => setJobIds(forgetJobId(jobId))}
            />
          ))}
        </section>
      )}
    </div>
  );
}
