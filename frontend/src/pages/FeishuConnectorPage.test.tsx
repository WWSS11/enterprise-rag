import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { createApiClient } from "@/api/client";
import { AuthContext, type AuthContextValue } from "@/auth/authContext";
import { renderWithI18n, resetI18n } from "@/test/i18nTestUtils";
import { FeishuConnectorPage } from "./FeishuConnectorPage";

const jobId = "33333333-3333-4333-8333-333333333333";
const failedJobId = "44444444-4444-4444-8444-444444444444";
const kbId = "11111111-1111-4111-8111-111111111111";

function job(id: string, status: "queued" | "succeeded" | "failed") {
  return {
    id,
    knowledge_base_id: kbId,
    document_id: null,
    retry_of_job_id: null,
    task_id: `task-${id}`,
    job_type: "feishu_sync",
    status,
    progress: status === "queued" ? 0 : 100,
    result: status === "failed"
      ? {
          failure: {
            category: "upstream",
            message: "Wiki permission denied",
            operation: "wiki.nodes.list",
            error_code: 131006,
            log_id: "trace-history",
            retryable: false,
          },
        }
      : { remote: 12, enqueued: 3, unchanged: 9, ingestion_jobs: 3 },
    error_message: status === "failed" ? "Wiki permission denied" : null,
    cancelled_at: null,
    cancelled_by: null,
    created_at: "2026-08-08T00:00:00Z",
    updated_at: "2026-08-08T00:00:01Z",
  };
}

function auth(fetchMock: typeof fetch, isAdmin = true): AuthContextValue {
  const api = createApiClient({
    baseUrl: "http://api.test",
    getAccessToken: async () => "token",
    renewAccessToken: async () => null,
    fetchImpl: fetchMock,
  });
  return {
    status: "authenticated",
    user: null,
    identity: {
      user_id: "admin-1",
      tenant_id: "default",
      roles: isAdmin ? ["rag-admin"] : ["rag-user"],
      groups: [],
      auth_method: "oidc",
      is_admin: isAdmin,
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
    hasRole: () => isAdmin,
    hasAnyRole: () => isAdmin,
  };
}

function renderPage(fetchMock: typeof fetch, isAdmin = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderWithI18n(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth(fetchMock, isAdmin)}>
        <MemoryRouter initialEntries={["/app/connectors/feishu"]}>
          <Routes>
            <Route path="/app/connectors/feishu" element={<FeishuConnectorPage />} />
            <Route path="/403" element={<div>forbidden-page</div>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe("FeishuConnectorPage", () => {
  beforeEach(async () => {
    await resetI18n("zh-CN");
  });

  it("runs diagnostics, starts a persisted sync, and renders safe failures and statistics", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/connectors/feishu/diagnose")) {
        return new Response(JSON.stringify({
          provider: "feishu",
          status: "failed",
          checked_at: "2026-08-08T00:00:02Z",
          checks: [{
            key: "connectivity",
            status: "failed",
            message: "Wiki permission denied",
            error_code: 131006,
            log_id: "trace-diagnostic",
            details: { operation: "wiki.nodes.list", retryable: false },
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/v1/connectors/feishu/sync")) {
        return new Response(JSON.stringify(job(jobId, "queued")), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith(`/api/v1/jobs/${jobId}`)) {
        return new Response(JSON.stringify(job(jobId, "succeeded")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith(`/api/v1/jobs/${failedJobId}`)) {
        return new Response(JSON.stringify(job(failedJobId, "failed")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/v1/jobs?job_type=feishu_sync")) {
        return new Response(JSON.stringify({
          items: [job(failedJobId, "failed"), job(jobId, "succeeded")],
          total: 2,
          limit: 10,
          offset: 0,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/v1/connectors/feishu")) {
        return new Response(JSON.stringify({
          provider: "feishu",
          enabled: true,
          ready: true,
          tenant_id: "default",
          space_id: "space-safe",
          run_as_user: "connector-bot",
          app_id_configured: true,
          app_secret_configured: true,
          knowledge_base_id: kbId,
          knowledge_base_name: "飞书知识库",
          checks: [
            { key: "enabled", status: "passed", message: "enabled", error_code: null, log_id: null, details: {} },
            { key: "credentials", status: "passed", message: "configured", error_code: null, log_id: null, details: {} },
          ],
          active_job: null,
          latest_job: job(jobId, "succeeded"),
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(null, { status: 404 });
    });
    const user = userEvent.setup();
    renderPage(fetchMock as unknown as typeof fetch);

    expect(await screen.findByText("配置就绪")).toBeVisible();
    expect(screen.getAllByText("已配置", { selector: "dd" })).toHaveLength(2);
    expect(screen.getByText("trace-history")).toBeVisible();
    expect(screen.getByText("12")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "运行配置诊断" }));
    expect(await screen.findByText("trace-diagnostic")).toBeVisible();
    expect(screen.getAllByText("131006").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("wiki.nodes.list").length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole("button", { name: "立即同步" }));
    expect((await screen.findAllByText(jobId)).length).toBeGreaterThanOrEqual(1);
    const syncCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/v1/connectors/feishu/sync"),
    );
    expect((syncCall?.[1] as RequestInit).method).toBe("POST");
  });

  it("redirects non-administrators without requesting connector data", async () => {
    const fetchMock = vi.fn();
    renderPage(fetchMock as unknown as typeof fetch, false);

    expect(await screen.findByText("forbidden-page")).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
