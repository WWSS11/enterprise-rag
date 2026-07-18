import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthContext, type AuthContextValue } from "@/auth/authContext";
import { createApiClient } from "@/api/client";
import { changeAppLocale } from "@/i18n";
import { renderWithI18n, resetI18n } from "@/test/i18nTestUtils";
import { KnowledgeBasesPage } from "./KnowledgeBasesPage";
import { CreateKnowledgeBasePage } from "./CreateKnowledgeBasePage";
import { KnowledgeBaseDetailPage } from "./KnowledgeBaseDetailPage";

const kbId = "11111111-1111-4111-8111-111111111111";

function kb(overrides: Record<string, unknown> = {}) {
  return {
    id: kbId,
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
    ...overrides,
  };
}

function authValue(fetchImpl: typeof fetch, identityOverrides: Record<string, unknown> = {}): AuthContextValue {
  const api = createApiClient({
    baseUrl: "http://api.test",
    getAccessToken: async () => "token",
    renewAccessToken: async () => null,
    fetchImpl,
  });
  return {
    status: "authenticated",
    user: null,
    identity: {
      user_id: "user-1",
      tenant_id: "default",
      roles: ["rag-user"],
      groups: ["engineering"],
      auth_method: "oidc",
      is_admin: false,
      ...identityOverrides,
    },
    identityError: null,
    isAuthenticated: true,
    api,
    login: async () => undefined,
    logout: async () => undefined,
    completeLogin: async () => undefined,
    renewToken: async () => null,
    getAccessToken: async () => "token",
    refreshIdentity: async () => null,
    hasRole: () => true,
    hasAnyRole: () => true,
  };
}

function renderOps(
  element: React.ReactNode,
  fetchImpl: typeof fetch,
  options?: { route?: string; identity?: Record<string, unknown> },
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithI18n(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={authValue(fetchImpl, options?.identity)}>
        <MemoryRouter initialEntries={[options?.route ?? "/app/knowledge-bases"]}>
          {element}
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe("Knowledge Base Ops pages", () => {
  beforeEach(async () => {
    window.sessionStorage.clear();
    await resetI18n("zh-CN");
  });

  it("renders the honest empty knowledge-base state", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
    ) as unknown as typeof fetch;
    renderOps(<KnowledgeBasesPage />, fetchImpl);

    expect(await screen.findByRole("heading", { name: "暂无可访问的知识库" })).toBeVisible();
    expect(screen.getAllByRole("link", { name: "创建知识库" }).length).toBeGreaterThan(0);
  });

  it("maps a rate-limited RFC7807 list error and recovers to the empty state", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: "about:blank",
            title: "Too Many Requests",
            status: 429,
            detail: "knowledge-base listing rate limit exceeded",
            request_id: "req-kb-list-429",
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/problem+json",
              "Retry-After": "12",
              "x-request-id": "req-kb-list-429",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
      ) as unknown as typeof fetch;
    renderOps(<KnowledgeBasesPage />, fetchImpl);

    expect(await screen.findByRole("heading", { name: "请求过于频繁" })).toBeVisible();
    expect(screen.getByText("请稍后再试。建议等待约 12 秒。")).toBeVisible();
    expect(screen.getByText("req-kb-list-429")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "技术详情" }));
    expect(screen.getByText("knowledge-base listing rate limit exceeded")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "刷新列表" }));

    expect(await screen.findByRole("heading", { name: "暂无可访问的知识库" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "请求过于频繁" })).not.toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("creates with the exact backend fields and navigates to details", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(kb()), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    renderOps(
      <Routes>
        <Route path="/app/knowledge-bases/new" element={<CreateKnowledgeBasePage />} />
        <Route path="/app/knowledge-bases/:knowledgeBaseId" element={<h1>detail landing</h1>} />
      </Routes>,
      fetchImpl,
      { route: "/app/knowledge-bases/new" },
    );

    await user.type(screen.getByLabelText("Slug"), "security");
    await user.type(screen.getByLabelText("名称"), "Security KB");
    await user.type(screen.getByLabelText("描述（可选）"), "Security policy");
    await user.click(screen.getByLabelText(/受限访问/));
    await user.click(screen.getByRole("button", { name: "创建并进入详情" }));

    expect(await screen.findByRole("heading", { name: "detail landing" })).toBeVisible();
    const body = JSON.parse(String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body));
    expect(body).toEqual({
      slug: "security",
      name: "Security KB",
      description: "Security policy",
      access_mode: "restricted",
    });
  });

  it("shows RFC7807 detail and request_id on create failure", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "about:blank",
          title: "Conflict",
          status: 409,
          detail: "knowledge-base slug already exists",
          request_id: "req-kb-409",
        }),
        {
          status: 409,
          headers: {
            "Content-Type": "application/problem+json",
            "x-request-id": "req-kb-409",
          },
        },
      ),
    ) as unknown as typeof fetch;
    renderOps(<CreateKnowledgeBasePage />, fetchImpl, { route: "/app/knowledge-bases/new" });

    await user.type(screen.getByLabelText("Slug"), "security");
    await user.type(screen.getByLabelText("名称"), "Security KB");
    await user.click(screen.getByRole("button", { name: "创建并进入详情" }));

    expect(await screen.findByRole("heading", { name: "请求冲突" })).toBeVisible();
    expect(screen.getByText("req-kb-409")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "技术详情" }));
    expect(screen.getByText("knowledge-base slug already exists")).toBeVisible();
  });

  it("uses the server-confirmed restricted membership permission", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith("/permissions/me")
        ? { knowledge_base_id: kbId, permission: "reader", source: "membership" }
        : url.includes("/documents") ? [] : [kb()];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    renderOps(
      <Routes>
        <Route path="/app/knowledge-bases/:knowledgeBaseId" element={<KnowledgeBaseDetailPage />} />
      </Routes>,
      fetchImpl,
      { route: `/app/knowledge-bases/${kbId}` },
    );

    expect(await screen.findByText(/reader/)).toBeVisible();
    expect(screen.getByRole("heading", { name: "当前仅可查看" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "上传并创建入库任务" })).toBeNull();
  });

  it("lets a confirmed owner upsert a real user or group grant", async () => {
    const user = userEvent.setup();
    const memberId = "77777777-7777-4777-8777-777777777777";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/permissions/me")) {
        return new Response(
          JSON.stringify({ knowledge_base_id: kbId, permission: "owner", source: "creator" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith(`/knowledge-bases/${kbId}/members`) && init?.method === "PUT") {
        return new Response(
          JSON.stringify({
            id: memberId,
            knowledge_base_id: kbId,
            principal_type: "group",
            principal_id: "engineering",
            permission: "editor",
            created_at: "2026-07-15T00:00:00Z",
            updated_at: "2026-07-15T00:00:00Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith(`/knowledge-bases/${kbId}/members`)) {
        return new Response("[]", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      const body = url.includes("/documents") ? [] : [kb()];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;
    renderOps(
      <Routes>
        <Route path="/app/knowledge-bases/:knowledgeBaseId" element={<KnowledgeBaseDetailPage />} />
      </Routes>,
      fetchImpl,
      {
        route: `/app/knowledge-bases/${kbId}`,
        identity: { user_id: "owner-1" },
      },
    );

    expect(await screen.findByRole("heading", { name: "授权用户或群组" })).toBeVisible();
    await user.selectOptions(screen.getByLabelText("主体类型"), "group");
    await user.type(screen.getByLabelText("主体标识"), "engineering");
    await user.selectOptions(screen.getByLabelText("权限"), "editor");
    await user.click(screen.getByRole("button", { name: "保存授权" }));

    expect(await screen.findByText("已将 engineering 的权限设置为 editor。")).toBeVisible();
    const memberCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).endsWith(`/knowledge-bases/${kbId}/members`) && init?.method === "PUT",
    );
    expect(memberCall).toBeDefined();
    expect((memberCall?.[1] as RequestInit).method).toBe("PUT");
    expect(JSON.parse(String((memberCall?.[1] as RequestInit).body))).toEqual({
      principal_type: "group",
      principal_id: "engineering",
      permission: "editor",
    });
  });

  it("preserves create form state across locale changes", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    renderOps(<CreateKnowledgeBasePage />, fetchImpl, { route: "/app/knowledge-bases/new" });

    await user.type(screen.getByLabelText("Slug"), "policy");
    await user.type(screen.getByLabelText("名称"), "政策库");
    await act(async () => {
      await changeAppLocale("en-US");
    });

    expect(await screen.findByRole("heading", { name: "Create knowledge base" })).toBeVisible();
    expect(screen.getByLabelText("Slug")).toHaveValue("policy");
    expect(screen.getByLabelText("Name")).toHaveValue("政策库");
  });
});
