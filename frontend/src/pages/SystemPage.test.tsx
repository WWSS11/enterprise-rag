import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { createApiClient } from "@/api/client";
import { AuthContext, type AuthContextValue } from "@/auth/authContext";
import { renderWithI18n, resetI18n } from "@/test/i18nTestUtils";
import { SystemPage } from "./SystemPage";

const jobId = "77777777-7777-4777-8777-777777777777";

describe("SystemPage index operations", () => {
  beforeEach(async () => {
    window.sessionStorage.clear();
    await resetI18n("zh-CN");
  });

  it("creates and tracks the real administrator rebuild job", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/jobs/rebuild-index")) {
        return new Response(
          JSON.stringify({
            id: jobId,
            document_id: null,
            task_id: "task-rebuild",
            job_type: "vector_index_rebuild",
            status: "queued",
            progress: 0,
            result: {},
            error_message: null,
            created_at: "2026-07-15T00:00:00Z",
            updated_at: "2026-07-15T00:00:00Z",
          }),
          { status: 202, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith(`/api/v1/jobs/${jobId}`)) {
        return new Response(
          JSON.stringify({
            id: jobId,
            document_id: null,
            task_id: "task-rebuild",
            job_type: "vector_index_rebuild",
            status: "succeeded",
            progress: 100,
            result: { switched: true },
            error_message: null,
            created_at: "2026-07-15T00:00:00Z",
            updated_at: "2026-07-15T00:00:01Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "enterprise-rag",
          version: "test",
          dependencies: {},
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const api = createApiClient({
      baseUrl: "http://api.test",
      getAccessToken: async () => "token",
      renewAccessToken: async () => null,
      fetchImpl,
    });
    const auth: AuthContextValue = {
      status: "authenticated",
      user: null,
      identity: {
        user_id: "admin-1",
        tenant_id: "default",
        roles: ["rag-admin"],
        groups: [],
        auth_method: "oidc",
        is_admin: true,
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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithI18n(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={auth}>
          <MemoryRouter>
            <SystemPage />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "全量重建向量索引" }));

    expect(window.confirm).toHaveBeenCalled();
    expect(await screen.findByText(jobId)).toBeVisible();
    expect(await screen.findByText("已完成")).toBeVisible();
    const rebuildCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/v1/jobs/rebuild-index"),
    );
    expect((rebuildCall?.[1] as RequestInit).method).toBe("POST");
    expect(window.sessionStorage.getItem("evidence-desk:known-job-ids")).toContain(jobId);
  });
});
