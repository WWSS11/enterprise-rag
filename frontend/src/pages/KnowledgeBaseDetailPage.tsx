import { useState, type FormEvent } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AppLocale } from "@/i18n";
import { formatDateTime } from "@/i18n/format";
import { useAuth } from "@/auth/useAuth";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/Button";
import { OperationError } from "@/components/OperationError";
import { StatusPill } from "@/components/StatusPill";
import { DocumentOperations } from "@/documents/DocumentOperations";
import styles from "./KnowledgeBaseOps.module.css";

export function KnowledgeBaseDetailPage() {
  const { knowledgeBaseId } = useParams<{ knowledgeBaseId: string }>();
  const location = useLocation();
  const { t, i18n } = useTranslation(["knowledgeBases", "documents", "common"]);
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const knowledgeBases = useQuery({
    queryKey: ["knowledge-bases"],
    queryFn: () => api.listKnowledgeBases(),
  });
  const knowledgeBase = knowledgeBases.data?.find((item) => item.id === knowledgeBaseId);
  const effectivePermission = useQuery({
    queryKey: ["knowledge-base-permission", knowledgeBaseId],
    queryFn: () => api.getKnowledgeBasePermission(knowledgeBaseId ?? ""),
    enabled: Boolean(knowledgeBaseId && knowledgeBase),
  });
  const canEdit = effectivePermission.data?.permission === "editor" || effectivePermission.data?.permission === "owner";
  const canManageMembers = effectivePermission.data?.permission === "owner";
  const members = useQuery({
    queryKey: ["knowledge-base-members", knowledgeBaseId],
    queryFn: () => api.listKnowledgeBaseMembers(knowledgeBaseId ?? ""),
    enabled: Boolean(knowledgeBaseId && canManageMembers),
  });
  const locale = i18n.language as AppLocale;
  const [principalType, setPrincipalType] = useState<"user" | "group">("user");
  const [principalId, setPrincipalId] = useState("");
  const [permission, setPermission] = useState<"reader" | "editor" | "owner">("reader");
  const [memberValidation, setMemberValidation] = useState<string | null>(null);
  const memberMutation = useMutation({
    mutationFn: () =>
      api.upsertKnowledgeBaseMember(knowledgeBaseId ?? "", {
        principal_type: principalType,
        principal_id: principalId.trim(),
        permission,
      }),
    onSuccess: async () => {
      setPrincipalId("");
      setMemberValidation(null);
      await queryClient.invalidateQueries({ queryKey: ["knowledge-base-members", knowledgeBaseId] });
    },
  });

  function submitMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    memberMutation.reset();
    const cleanPrincipalId = principalId.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(cleanPrincipalId)) {
      setMemberValidation(t("knowledgeBases:memberPrincipalValidation"));
      return;
    }
    setMemberValidation(null);
    memberMutation.mutate();
  }

  if (knowledgeBases.isLoading) {
    return <section className={styles.loading} aria-busy="true">{t("knowledgeBases:loading")}</section>;
  }

  if (knowledgeBases.isError) {
    return (
      <OperationError
        error={knowledgeBases.error}
        onRetry={() => void knowledgeBases.refetch()}
      />
    );
  }

  if (!knowledgeBase) {
    return (
      <EmptyState
        kicker={t("knowledgeBases:kicker")}
        title={t("knowledgeBases:notFoundTitle")}
        description={t("knowledgeBases:notFoundDetail")}
        actions={
          <Link className={styles.secondaryLink} to="/app/knowledge-bases">
            {t("knowledgeBases:backToList")}
          </Link>
        }
      />
    );
  }

  const permissionMessage = effectivePermission.data
    ? t("knowledgeBases:permissionEffective", {
        permission: effectivePermission.data.permission,
        source: effectivePermission.data.source,
      })
    : t("knowledgeBases:permissionLoading");
  const created = Boolean((location.state as { created?: boolean } | null)?.created);

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.kicker}>{t("knowledgeBases:detailTitle")}</div>
          <h1>{knowledgeBase.name}</h1>
          <p>{knowledgeBase.description || "—"}</p>
        </div>
        <Link className={styles.secondaryLink} to="/app/knowledge-bases">
          {t("knowledgeBases:backToList")}
        </Link>
      </header>

      {created ? (
        <p className={styles.successNotice} role="status">
          {t("knowledgeBases:createSuccess")}
        </p>
      ) : null}

      <section className={styles.detailPanel} aria-labelledby="knowledge-base-metadata-title">
        <div className={styles.detailHeading}>
          <h2 id="knowledge-base-metadata-title">{t("knowledgeBases:detailTitle")}</h2>
          <StatusPill
            tone={knowledgeBase.status === "active" ? "ok" : "unknown"}
            label={
              knowledgeBase.status === "active"
                ? t("knowledgeBases:activeStatus")
                : t("knowledgeBases:unknownStatus", { status: knowledgeBase.status })
            }
          />
        </div>
        <dl className={styles.metadata}>
          <div>
            <dt>{t("knowledgeBases:identifier")}</dt>
            <dd><code>{knowledgeBase.id}</code></dd>
          </div>
          <div>
            <dt>{t("knowledgeBases:slug")}</dt>
            <dd><code>{knowledgeBase.slug}</code></dd>
          </div>
          <div>
            <dt>{t("knowledgeBases:accessMode")}</dt>
            <dd>
              {knowledgeBase.access_mode === "tenant"
                ? t("knowledgeBases:tenantAccess")
                : knowledgeBase.access_mode === "restricted"
                  ? t("knowledgeBases:restrictedAccess")
                  : t("knowledgeBases:unknownAccessMode", {
                      accessMode: knowledgeBase.access_mode,
                    })}
            </dd>
          </div>
          <div>
            <dt>{t("knowledgeBases:createdBy")}</dt>
            <dd><code>{knowledgeBase.created_by}</code></dd>
          </div>
          <div>
            <dt>{t("knowledgeBases:createdAt")}</dt>
            <dd>{formatDateTime(locale, knowledgeBase.created_at)}</dd>
          </div>
          <div>
            <dt>{t("knowledgeBases:updatedAt")}</dt>
            <dd>{formatDateTime(locale, knowledgeBase.updated_at)}</dd>
          </div>
        </dl>
        <div className={styles.detailActions}>
          <Link
            className={styles.primaryLink}
            to={`/app/chat?knowledge_base_id=${encodeURIComponent(knowledgeBase.id)}`}
          >
            {t("knowledgeBases:openChat")}
          </Link>
          <Link
            className={styles.secondaryLink}
            to={`/app/documents?knowledge_base_id=${encodeURIComponent(knowledgeBase.id)}`}
          >
            {t("knowledgeBases:documents")}
          </Link>
        </div>
      </section>

      <section className={styles.permission} aria-labelledby="knowledge-base-permission-title">
        <h2 id="knowledge-base-permission-title">{t("knowledgeBases:permissionTitle")}</h2>
        <p>{permissionMessage}</p>
      </section>

      {canManageMembers ? (
        <section className={styles.permission} aria-labelledby="knowledge-base-member-title">
          <div>
            <h2 id="knowledge-base-member-title">{t("knowledgeBases:memberTitle")}</h2>
            <p>{t("knowledgeBases:memberDetail")}</p>
          </div>
          {members.isLoading ? <p>{t("knowledgeBases:memberLoading")}</p> : null}
          {members.isError ? <OperationError error={members.error} onRetry={() => void members.refetch()} /> : null}
          {members.data?.length === 0 ? <p>{t("knowledgeBases:memberEmpty")}</p> : null}
          {members.data?.length ? <ul className={styles.memberList}>{members.data.map((member) => <li key={member.id}><code>{member.principal_id}</code><span>{member.principal_type}</span><strong>{member.permission}</strong></li>)}</ul> : null}
          <form className={styles.memberForm} onSubmit={submitMember}>
            <div className={styles.formField}>
              <label htmlFor="member-principal-type">{t("knowledgeBases:memberPrincipalType")}</label>
              <select
                id="member-principal-type"
                value={principalType}
                onChange={(event) => setPrincipalType(event.target.value as "user" | "group")}
              >
                <option value="user">{t("knowledgeBases:memberUser")}</option>
                <option value="group">{t("knowledgeBases:memberGroup")}</option>
              </select>
            </div>
            <div className={styles.formField}>
              <label htmlFor="member-principal-id">{t("knowledgeBases:memberPrincipalId")}</label>
              <input
                id="member-principal-id"
                maxLength={128}
                value={principalId}
                onChange={(event) => setPrincipalId(event.target.value)}
              />
              <span className={styles.fieldHint}>{t("knowledgeBases:memberPrincipalHint")}</span>
            </div>
            <div className={styles.formField}>
              <label htmlFor="member-permission">{t("knowledgeBases:memberPermission")}</label>
              <select
                id="member-permission"
                value={permission}
                onChange={(event) =>
                  setPermission(event.target.value as "reader" | "editor" | "owner")
                }
              >
                <option value="reader">reader</option>
                <option value="editor">editor</option>
                <option value="owner">owner</option>
              </select>
            </div>
            {memberValidation ? (
              <p className={styles.validation} role="alert">{memberValidation}</p>
            ) : null}
            {memberMutation.isError ? <OperationError error={memberMutation.error} /> : null}
            {memberMutation.data ? (
              <p className={styles.successNotice} role="status">
                {t("knowledgeBases:memberSuccess", {
                  principal: memberMutation.data.principal_id,
                  permission: memberMutation.data.permission,
                })}
              </p>
            ) : null}
            <div className={styles.formActions}>
              <Button type="submit" disabled={memberMutation.isPending || !principalId.trim()}>
                {memberMutation.isPending
                  ? t("knowledgeBases:memberSaving")
                  : t("knowledgeBases:memberSave")}
              </Button>
            </div>
          </form>
          <p>{t("knowledgeBases:memberLimitation")}</p>
        </section>
      ) : null}

      <DocumentOperations knowledgeBase={knowledgeBase} canEdit={canEdit} />
    </div>
  );
}
