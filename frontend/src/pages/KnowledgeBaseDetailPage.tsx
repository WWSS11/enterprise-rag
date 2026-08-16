import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AppLocale } from "@/i18n";
import { formatDateTime } from "@/i18n/format";
import { useAuth } from "@/auth/useAuth";
import { knowledgeBaseMemberUpsertSchema, type DirectoryPrincipal } from "@/api/types";
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
    queryKey: ["knowledge-bases", "all"],
    queryFn: () => api.listKnowledgeBases({ includeArchived: true }),
  });
  const knowledgeBase = knowledgeBases.data?.find((item) => item.id === knowledgeBaseId);
  const effectivePermission = useQuery({
    queryKey: ["knowledge-base-permission", knowledgeBaseId],
    queryFn: () => api.getKnowledgeBasePermission(knowledgeBaseId ?? ""),
    enabled: Boolean(knowledgeBaseId && knowledgeBase),
  });
  const isActive = knowledgeBase?.status === "active";
  const canEdit = Boolean(isActive && (effectivePermission.data?.permission === "editor" || effectivePermission.data?.permission === "owner"));
  const canManageLifecycle = effectivePermission.data?.permission === "owner";
  const canManageMembers = Boolean(isActive && effectivePermission.data?.permission === "owner");
  const members = useQuery({
    queryKey: ["knowledge-base-members", knowledgeBaseId],
    queryFn: () => api.listKnowledgeBaseMembers(knowledgeBaseId ?? ""),
    enabled: Boolean(knowledgeBaseId && canManageMembers),
  });
  const locale = i18n.language as AppLocale;
  const [principalType, setPrincipalType] = useState<"user" | "group">("user");
  const [principalId, setPrincipalId] = useState("");
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [debouncedDirectoryQuery, setDebouncedDirectoryQuery] = useState("");
  const [directoryOffset, setDirectoryOffset] = useState(0);
  const [selectedPrincipal, setSelectedPrincipal] = useState<DirectoryPrincipal | null>(null);
  const [permission, setPermission] = useState<"reader" | "editor" | "owner">("reader");
  const [memberValidation, setMemberValidation] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedDirectoryQuery(directoryQuery.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [directoryQuery]);
  const directorySearch = useQuery({
    queryKey: [
      "knowledge-base-directory",
      knowledgeBaseId,
      principalType,
      debouncedDirectoryQuery,
      directoryOffset,
    ],
    queryFn: () =>
      api.searchKnowledgeBaseDirectory(knowledgeBaseId ?? "", {
        principalType,
        query: debouncedDirectoryQuery,
        limit: 20,
        offset: directoryOffset,
      }),
    enabled: Boolean(
      knowledgeBaseId && canManageMembers && debouncedDirectoryQuery.length >= 2,
    ),
    staleTime: 30_000,
  });
  const memberMutation = useMutation({
    mutationFn: () =>
      api.upsertKnowledgeBaseMember(knowledgeBaseId ?? "", {
        principal_type: principalType,
        principal_id: principalId.trim(),
        permission,
      }),
    onSuccess: async () => {
      setPrincipalId("");
      setDirectoryQuery("");
      setDebouncedDirectoryQuery("");
      setDirectoryOffset(0);
      setSelectedPrincipal(null);
      setMemberValidation(null);
      await queryClient.invalidateQueries({ queryKey: ["knowledge-base-members", knowledgeBaseId] });
    },
  });
  const updateMutation = useMutation({
    mutationFn: (payload: { name: string; description: string | null; access_mode: "tenant" | "restricted" }) =>
      api.updateKnowledgeBase(knowledgeBaseId ?? "", payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
    },
  });
  const archiveMutation = useMutation({
    mutationFn: () => api.archiveKnowledgeBase(knowledgeBaseId ?? ""),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      await queryClient.invalidateQueries({ queryKey: ["knowledge-base-permission", knowledgeBaseId] });
    },
  });
  const restoreMutation = useMutation({
    mutationFn: () => api.restoreKnowledgeBase(knowledgeBaseId ?? ""),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      await queryClient.invalidateQueries({ queryKey: ["knowledge-base-permission", knowledgeBaseId] });
    },
  });
  const deleteMemberMutation = useMutation({
    mutationFn: (memberId: string) => api.deleteKnowledgeBaseMember(knowledgeBaseId ?? "", memberId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["knowledge-base-members", knowledgeBaseId] });
    },
  });

  function submitMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    memberMutation.reset();
    const cleanPrincipalId = principalId.trim();
    const validPrincipalId = knowledgeBaseMemberUpsertSchema.safeParse({
      principal_type: principalType,
      principal_id: cleanPrincipalId,
      permission,
    }).success;
    if (
      selectedPrincipal === null
      || selectedPrincipal.principal_type !== principalType
      || selectedPrincipal.principal_id !== cleanPrincipalId
      || !validPrincipalId
    ) {
      setMemberValidation(t("knowledgeBases:memberPrincipalValidation"));
      return;
    }
    setMemberValidation(null);
    memberMutation.mutate();
  }

  function submitUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    updateMutation.mutate({
      name: String(form.get("name") ?? "").trim(),
      description: String(form.get("description") ?? "").trim() || null,
      access_mode: form.get("access_mode") === "tenant" ? "tenant" : "restricted",
    });
  }

  function requestArchive() {
    if (window.confirm(t("knowledgeBases:archiveConfirm"))) archiveMutation.mutate();
  }

  function requestMemberRemoval(memberId: string, principalId: string) {
    if (window.confirm(t("knowledgeBases:memberRemoveConfirm", { principal: principalId }))) {
      deleteMemberMutation.mutate(memberId);
    }
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
                : knowledgeBase.status === "archived"
                  ? t("knowledgeBases:archivedStatus")
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

      {canManageLifecycle ? (
        <section className={styles.permission} aria-labelledby="knowledge-base-lifecycle-title">
          <div>
            <h2 id="knowledge-base-lifecycle-title">{t("knowledgeBases:lifecycleTitle")}</h2>
            <p>{t("knowledgeBases:lifecycleDetail")}</p>
          </div>
          {isActive ? (
            <form className={styles.memberForm} key={knowledgeBase.updated_at} onSubmit={submitUpdate}>
              <div className={styles.formField}>
                <label htmlFor="knowledge-base-edit-name">{t("knowledgeBases:name")}</label>
                <input id="knowledge-base-edit-name" name="name" required maxLength={255} defaultValue={knowledgeBase.name} />
              </div>
              <div className={styles.formField}>
                <label htmlFor="knowledge-base-edit-description">{t("knowledgeBases:description")}</label>
                <textarea id="knowledge-base-edit-description" name="description" maxLength={4000} defaultValue={knowledgeBase.description ?? ""} />
              </div>
              <div className={styles.formField}>
                <label htmlFor="knowledge-base-edit-access">{t("knowledgeBases:accessMode")}</label>
                <select id="knowledge-base-edit-access" name="access_mode" defaultValue={knowledgeBase.access_mode}>
                  <option value="restricted">{t("knowledgeBases:restrictedAccess")}</option>
                  <option value="tenant">{t("knowledgeBases:tenantAccess")}</option>
                </select>
              </div>
              {updateMutation.isError ? <OperationError error={updateMutation.error} /> : null}
              {updateMutation.isSuccess ? <p className={styles.successNotice} role="status">{t("knowledgeBases:updateSuccess")}</p> : null}
              <div className={styles.formActions}>
                <Button type="submit" disabled={updateMutation.isPending}>{updateMutation.isPending ? t("knowledgeBases:updating") : t("knowledgeBases:update")}</Button>
                <Button type="button" variant="danger" disabled={knowledgeBase.is_default || archiveMutation.isPending} onClick={requestArchive}>{archiveMutation.isPending ? t("knowledgeBases:archiving") : t("knowledgeBases:archive")}</Button>
              </div>
              {knowledgeBase.is_default ? <p>{t("knowledgeBases:defaultArchiveBlocked")}</p> : null}
              {archiveMutation.isError ? <OperationError error={archiveMutation.error} onRetry={requestArchive} /> : null}
            </form>
          ) : (
            <div className={styles.formActions}>
              <Button type="button" disabled={restoreMutation.isPending} onClick={() => restoreMutation.mutate()}>{restoreMutation.isPending ? t("knowledgeBases:restoring") : t("knowledgeBases:restore")}</Button>
              {restoreMutation.isError ? <OperationError error={restoreMutation.error} onRetry={() => restoreMutation.mutate()} /> : null}
            </div>
          )}
        </section>
      ) : null}

      {canManageMembers ? (
        <section className={styles.permission} aria-labelledby="knowledge-base-member-title">
          <div>
            <h2 id="knowledge-base-member-title">{t("knowledgeBases:memberTitle")}</h2>
            <p>{t("knowledgeBases:memberDetail")}</p>
          </div>
          {members.isLoading ? <p>{t("knowledgeBases:memberLoading")}</p> : null}
          {members.isError ? <OperationError error={members.error} onRetry={() => void members.refetch()} /> : null}
          {members.data?.length === 0 ? <p>{t("knowledgeBases:memberEmpty")}</p> : null}
          {members.data?.length ? <ul className={styles.memberList}>{members.data.map((member) => <li key={member.id}><code>{member.principal_id}</code><span>{member.principal_type}</span><strong>{member.permission}</strong>{member.principal_type === "user" && member.principal_id === knowledgeBase.created_by ? <span>{t("knowledgeBases:creatorGrant")}</span> : <Button type="button" variant="ghost" disabled={deleteMemberMutation.isPending} onClick={() => requestMemberRemoval(member.id, member.principal_id)}>{t("knowledgeBases:memberRemove")}</Button>}</li>)}</ul> : null}
          {deleteMemberMutation.isError ? <OperationError error={deleteMemberMutation.error} /> : null}
          <form className={styles.memberForm} onSubmit={submitMember}>
            <div className={styles.formField}>
              <label htmlFor="member-principal-type">{t("knowledgeBases:memberPrincipalType")}</label>
              <select
                id="member-principal-type"
                value={principalType}
                onChange={(event) => {
                  setPrincipalType(event.target.value as "user" | "group");
                  setPrincipalId("");
                  setDirectoryQuery("");
                  setDebouncedDirectoryQuery("");
                  setDirectoryOffset(0);
                  setSelectedPrincipal(null);
                  setMemberValidation(null);
                  memberMutation.reset();
                }}
              >
                <option value="user">{t("knowledgeBases:memberUser")}</option>
                <option value="group">{t("knowledgeBases:memberGroup")}</option>
              </select>
            </div>
            <div className={styles.formField}>
              <label htmlFor="member-directory-query">
                {principalType === "user"
                  ? t("knowledgeBases:directoryUserSearchLabel")
                  : t("knowledgeBases:directoryGroupSearchLabel")}
              </label>
              <input
                id="member-directory-query"
                type="search"
                maxLength={200}
                autoComplete="off"
                value={directoryQuery}
                aria-describedby="member-directory-hint"
                onChange={(event) => {
                  setDirectoryQuery(event.target.value);
                  setDirectoryOffset(0);
                  setPrincipalId("");
                  setSelectedPrincipal(null);
                  setMemberValidation(null);
                  memberMutation.reset();
                }}
              />
              <span id="member-directory-hint" className={styles.fieldHint}>
                {t("knowledgeBases:directorySearchHint")}
              </span>
            </div>
            {debouncedDirectoryQuery.length >= 2 && directorySearch.isLoading ? (
              <p aria-live="polite">{t("knowledgeBases:directorySearching")}</p>
            ) : null}
            {directorySearch.isError ? (
              <OperationError
                error={directorySearch.error}
                onRetry={() => void directorySearch.refetch()}
              />
            ) : null}
            {directorySearch.isSuccess && directorySearch.data.length === 0 ? (
              <p>{t("knowledgeBases:directoryEmpty")}</p>
            ) : null}
            {directorySearch.data?.length ? (
              <ul className={styles.directoryResults} aria-label={t("knowledgeBases:directoryResults")}>
                {directorySearch.data.map((principal) => (
                  <li key={`${principal.principal_type}:${principal.principal_id}`}>
                    <button
                      type="button"
                      aria-pressed={selectedPrincipal?.principal_id === principal.principal_id}
                      onClick={() => {
                        setSelectedPrincipal(principal);
                        setPrincipalId(principal.principal_id);
                        setMemberValidation(null);
                      }}
                    >
                      <span>
                        <strong>{principal.display_name}</strong>
                        {principal.secondary_text ? <small>{principal.secondary_text}</small> : null}
                        <code>{principal.principal_id}</code>
                      </span>
                      <b>{t("knowledgeBases:directorySelect")}</b>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {directorySearch.isSuccess && (directoryOffset > 0 || directorySearch.data.length === 20) ? (
              <div className={styles.directoryPagination}>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={directoryOffset === 0 || directorySearch.isFetching}
                  onClick={() => {
                    setDirectoryOffset((current) => Math.max(0, current - 20));
                    setPrincipalId("");
                    setSelectedPrincipal(null);
                  }}
                >
                  {t("knowledgeBases:directoryPrevious")}
                </Button>
                <span>
                  {t("knowledgeBases:directoryPage", {
                    page: Math.floor(directoryOffset / 20) + 1,
                  })}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={directorySearch.data.length < 20 || directorySearch.isFetching}
                  onClick={() => {
                    setDirectoryOffset((current) => current + 20);
                    setPrincipalId("");
                    setSelectedPrincipal(null);
                  }}
                >
                  {t("knowledgeBases:directoryNext")}
                </Button>
              </div>
            ) : null}
            {selectedPrincipal ? (
              <div className={styles.selectedPrincipal} role="status">
                <span>{t("knowledgeBases:directorySelected")}</span>
                <strong>{selectedPrincipal.display_name}</strong>
                <code>{selectedPrincipal.principal_id}</code>
              </div>
            ) : null}
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
              <Button type="submit" disabled={memberMutation.isPending || !selectedPrincipal}>
                {memberMutation.isPending
                  ? t("knowledgeBases:memberSaving")
                  : t("knowledgeBases:memberSave")}
              </Button>
            </div>
          </form>
          <p>{t("knowledgeBases:memberLimitation")}</p>
        </section>
      ) : null}

      {isActive ? <DocumentOperations knowledgeBase={knowledgeBase} canEdit={canEdit} /> : null}
    </div>
  );
}
