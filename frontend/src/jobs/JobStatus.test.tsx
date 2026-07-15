import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthContext, type AuthContextValue } from "@/auth/authContext";
import { createApiClient } from "@/api/client";
import { renderWithI18n, resetI18n } from "@/test/i18nTestUtils";
import { JobStatus } from "./JobStatus";

const jobId = "33333333-3333-4333-8333-333333333333";

function job(status: string) {
  return {
    id: jobId,
    document_id: "22222222-2222-4222-8222-222222222222",
    task_id: "task-1",
    job_type: "document_ingestion",
    status,
    progress: status === "succeeded" ? 100 : 20,
    result: {},
    error_message: status === "failed" ? "parser failed" : null,
    created_at: "2026-07-15T00:00:00Z",
    updated_at: "2026-07-15T00:00:01Z",
  };
}

function renderJob(fetchImpl: typeof fetch) {
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
      user_id: "user-1",
      tenant_id: "default",
      roles: ["rag-user"],
      groups: [],
      auth_method: "oidc",
      is_admin: false,
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
  return renderWithI18n(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter>
          <JobStatus jobId={jobId} />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

function setVisibility(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("JobStatus polling", () => {
  beforeEach(async () => {
    vi.useRealTimers();
    setVisibility("visible");
    await resetI18n("zh-CN");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls running jobs and stops after the real succeeded terminal state", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(job("running")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValue(
        new Response(JSON.stringify(job("succeeded")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ) as unknown as typeof fetch;
    renderJob(fetchImpl);

    expect(await screen.findByText("处理中")).toBeVisible();
    await act(async () => setVisibility("hidden"));
    vi.useFakeTimers();
    await act(async () => setVisibility("visible"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });
    expect(screen.getByText("已完成")).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("treats failed jobs as terminal and shows the real failure without a retry action", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(job("failed")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    renderJob(fetchImpl);

    expect(await screen.findByText("失败")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("parser failed");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "后端没有任务重试接口。失败任务仅展示原因，不提供虚构的重试操作。",
    );
    expect(screen.queryByRole("button", { name: /重试/ })).not.toBeInTheDocument();
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("pauses polling while hidden and resumes after becoming visible", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(job("running")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    renderJob(fetchImpl);

    expect(await screen.findByText("处理中")).toBeVisible();
    await act(async () => setVisibility("hidden"));
    expect(await screen.findByText("页面隐藏时已暂停轮询。")).toBeVisible();
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await act(async () => setVisibility("visible"));
    expect(screen.queryByText("页面隐藏时已暂停轮询。")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
