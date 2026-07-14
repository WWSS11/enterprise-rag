import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/EmptyState";

export function KnowledgeBasesPage() {
  const { t } = useTranslation("navigation");
  return (
    <EmptyState
      kicker={t("kbKicker")}
      title={t("knowledgeBases")}
      description={t("kbDescription")}
      nextSteps={[t("kbStep1"), t("kbStep2"), t("kbStep3")]}
      note={t("kbNote")}
    />
  );
}

export function DocumentsPage() {
  const { t } = useTranslation("navigation");
  return (
    <EmptyState
      kicker={t("docsKicker")}
      title={t("documents")}
      description={t("docsDescription")}
      nextSteps={[t("docsStep1"), t("docsStep2"), t("docsStep3")]}
    />
  );
}

export function EvaluationsPage() {
  const { t } = useTranslation("navigation");
  return (
    <EmptyState
      kicker={t("evalsKicker")}
      title={t("evaluations")}
      description={t("evalsDescription")}
      nextSteps={[t("evalsStep1"), t("evalsStep2"), t("evalsStep3")]}
    />
  );
}

export function JobsPage() {
  const { t } = useTranslation("navigation");
  return (
    <EmptyState
      kicker={t("jobsKicker")}
      title={t("jobs")}
      description={t("jobsDescription")}
      nextSteps={[t("jobsStep1"), t("jobsStep2"), t("jobsStep3")]}
    />
  );
}
