import type { CurrentIdentity, KnowledgeBase } from "@/api/types";

export type ConfirmedKnowledgeBaseAccess =
  | "admin"
  | "creator"
  | "tenant-editor"
  | "restricted-unknown";

export function confirmedKnowledgeBaseAccess(
  identity: CurrentIdentity | null,
  knowledgeBase: KnowledgeBase,
): ConfirmedKnowledgeBaseAccess {
  if (identity?.is_admin) return "admin";
  if (identity?.user_id === knowledgeBase.created_by) return "creator";
  if (knowledgeBase.access_mode === "tenant") return "tenant-editor";
  return "restricted-unknown";
}

export function canEditKnowledgeBase(
  identity: CurrentIdentity | null,
  knowledgeBase: KnowledgeBase,
): boolean {
  return confirmedKnowledgeBaseAccess(identity, knowledgeBase) !== "restricted-unknown";
}
