import { describe, expect, it } from "vitest";
import type { CurrentIdentity, KnowledgeBase } from "@/api/types";
import { canEditKnowledgeBase } from "./permissions";

const baseIdentity: CurrentIdentity = {
  user_id: "user-1",
  tenant_id: "default",
  roles: ["rag-user"],
  groups: ["engineering"],
  auth_method: "oidc",
  is_admin: false,
};

const restrictedKnowledgeBase: KnowledgeBase = {
  id: "11111111-1111-4111-8111-111111111111",
  tenant_id: "default",
  slug: "security",
  name: "Security KB",
  description: "Security policy",
  access_mode: "restricted",
  status: "active",
  is_default: false,
  created_by: "owner-1",
  created_at: "2026-07-15T00:00:00Z",
  updated_at: "2026-07-15T00:00:00Z",
};

type PermissionCase = {
  name: string;
  identity: CurrentIdentity;
  knowledgeBase: KnowledgeBase;
  expected: boolean;
};

const permissionCases: PermissionCase[] = [
  {
    name: "admin can edit a restricted knowledge base",
    identity: { ...baseIdentity, user_id: "admin-1", is_admin: true },
    knowledgeBase: restrictedKnowledgeBase,
    expected: true,
  },
  {
    name: "creator can edit their restricted knowledge base",
    identity: { ...baseIdentity, user_id: "owner-1" },
    knowledgeBase: restrictedKnowledgeBase,
    expected: true,
  },
  {
    name: "tenant-mode user can edit a listed tenant knowledge base",
    identity: baseIdentity,
    knowledgeBase: { ...restrictedKnowledgeBase, access_mode: "tenant" },
    expected: true,
  },
  {
    name: "non-creator cannot edit when restricted membership is unknown",
    identity: baseIdentity,
    knowledgeBase: restrictedKnowledgeBase,
    expected: false,
  },
];

describe("canEditKnowledgeBase", () => {
  it.each(permissionCases)("$name", ({ identity, knowledgeBase, expected }) => {
    expect(canEditKnowledgeBase(identity, knowledgeBase)).toBe(expected);
  });
});
