import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/auth/useAuth";
import { EmptyState } from "@/components/EmptyState";
import { OperationError } from "@/components/OperationError";
import { DocumentOperations } from "@/documents/DocumentOperations";
import { canEditKnowledgeBase } from "@/knowledgeBases/permissions";
import styles from "./DocumentsPage.module.css";

export function DocumentsPage() {
  const { t } = useTranslation(["documents", "knowledgeBases"]);
  const { api, identity } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const knowledgeBases = useQuery({
    queryKey: ["knowledge-bases"],
    queryFn: () => api.listKnowledgeBases(),
  });
  const selectedId = searchParams.get("knowledge_base_id") ?? "";
  const selected = knowledgeBases.data?.find((item) => item.id === selectedId);

  useEffect(() => {
    if (!knowledgeBases.data?.length || selected) return;
    const fallback =
      knowledgeBases.data.find((knowledgeBase) => knowledgeBase.is_default) ??
      knowledgeBases.data[0];
    setSearchParams({ knowledge_base_id: fallback.id }, { replace: true });
  }, [knowledgeBases.data, selected, setSearchParams]);

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.kicker}>{t("documents:kicker")}</div>
          <h1>{t("documents:title")}</h1>
          <p>{t("documents:subtitle")}</p>
        </div>
      </header>

      {knowledgeBases.isLoading ? (
        <p className={styles.loading} aria-busy="true">{t("knowledgeBases:loading")}</p>
      ) : null}
      {knowledgeBases.isError ? (
        <OperationError
          error={knowledgeBases.error}
          onRetry={() => void knowledgeBases.refetch()}
        />
      ) : null}
      {knowledgeBases.data?.length === 0 ? (
        <EmptyState
          title={t("knowledgeBases:emptyTitle")}
          description={t("knowledgeBases:emptyDetail")}
          headingLevel={2}
        />
      ) : null}

      {knowledgeBases.data && knowledgeBases.data.length > 0 ? (
        <div className={styles.selector}>
          <label htmlFor="documents-kb">{t("documents:knowledgeBase")}</label>
          <select
            id="documents-kb"
            value={selected?.id ?? ""}
            onChange={(event) =>
              setSearchParams({ knowledge_base_id: event.target.value }, { replace: true })
            }
          >
            <option value="" disabled>{t("documents:chooseKnowledgeBase")}</option>
            {knowledgeBases.data.map((knowledgeBase) => (
              <option key={knowledgeBase.id} value={knowledgeBase.id}>
                {knowledgeBase.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {selected ? (
        <DocumentOperations
          knowledgeBase={selected}
          canEdit={canEditKnowledgeBase(identity, selected)}
        />
      ) : null}
    </div>
  );
}
