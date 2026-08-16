import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthContext, type AuthContextValue } from "@/auth/authContext";
import { createApiClient } from "@/api/client";
import { changeAppLocale } from "@/i18n";
import { renderWithI18n, resetI18n } from "@/test/i18nTestUtils";
import { CreateEvaluationDatasetPage } from "./CreateEvaluationDatasetPage";
import { EvaluationDatasetPage } from "./EvaluationDatasetPage";
import { EvaluationRunPage } from "./EvaluationRunPage";
import { EvaluationsPage } from "./EvaluationsPage";

const knowledgeBaseId = "11111111-1111-4111-8111-111111111111";
const datasetId = "22222222-2222-4222-8222-222222222222";
const candidateRunId = "33333333-3333-4333-8333-333333333333";
const baselineRunId = "44444444-4444-4444-8444-444444444444";
const timestamp = "2026-07-15T08:30:00+08:00";

function jsonResponse(
  body: unknown,
  init: ResponseInit & { headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

function problemResponse(
  status: number,
  detail: string,
  requestId: string,
  headers: Record<string, string> = {},
): Response {
  return jsonResponse(
    {
      type: "about:blank",
      title: status === 409 ? "Conflict" : "Service Unavailable",
      status,
      detail,
      request_id: requestId,
    },
    {
      status,
      headers: {
        "Content-Type": "application/problem+json",
        "x-request-id": requestId,
        ...headers,
      },
    },
  );
}

function knowledgeBase(overrides: Record<string, unknown> = {}) {
  return {
    id: knowledgeBaseId,
    tenant_id: "default",
    slug: "support-policy",
    name: "Support Policy KB",
    description: "Customer support policy source",
    access_mode: "tenant",
    status: "active",
    is_default: false,
    created_by: "owner-1",
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

function evaluationDataset(overrides: Record<string, unknown> = {}) {
  return {
    id: datasetId,
    tenant_id: "default",
    knowledge_base_id: knowledgeBaseId,
    name: "Support policy release gate",
    description: "Stable regression cases for support answers",
    status: "active",
    created_by: "user-1",
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

function evaluationRun(status: string, overrides: Record<string, unknown> = {}) {
  const terminal = status === "succeeded" || status === "failed";
  const running = status === "running" || terminal;
  return {
    id: candidateRunId,
    tenant_id: "default",
    knowledge_base_id: knowledgeBaseId,
    dataset_id: datasetId,
    created_by: "user-1",
    task_id: "celery-task-42",
    status,
    progress: status === "queued" ? 0 : status === "running" ? 50 : 100,
    total_cases: 2,
    completed_cases: status === "queued" ? 0 : status === "running" ? 1 : 2,
    failed_cases: status === "failed" ? 1 : 0,
    config_snapshot: { retrieval: { top_k: 10 }, rerank: { enabled: true } },
    summary: terminal ? { retrieval_recall_at_k: 1, failed_cases: status === "failed" ? 1 : 0 } : {},
    started_at: running ? timestamp : null,
    completed_at: terminal ? "2026-07-15T08:31:00+08:00" : null,
    error_message: status === "failed" ? "worker lost access to the model endpoint" : null,
    created_at: timestamp,
    updated_at: terminal ? "2026-07-15T08:31:00+08:00" : timestamp,
    ...overrides,
  };
}

function evaluationReport(run = evaluationRun("succeeded")) {
  return {
    run,
    dataset: evaluationDataset(),
    results: [],
  };
}

function runComparison() {
  return {
    baseline_run_id: baselineRunId,
    candidate_run_id: candidateRunId,
    dataset_id: datasetId,
    metrics: [
      {
        metric: "citation_precision",
        baseline: 0.9,
        candidate: 0.92,
        delta: 0.02,
        relative_delta: 0.022222,
      },
    ],
    config_differences: [{ key: "retrieval.top_k", baseline: 8, candidate: 10 }],
  };
}

function qualityGateReport() {
  return {
    passed: true,
    comparison: runComparison(),
    checks: [
      {
        metric: "citation_precision",
        rule: "minimum_candidate",
        threshold: 0.9,
        baseline: 0.9,
        candidate: 0.92,
        actual: 0.92,
        passed: true,
        reason: "candidate meets release floor",
      },
    ],
  };
}

function authValue(fetchImpl: typeof fetch): AuthContextValue {
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
      groups: ["support"],
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
}

function renderConsole(
  children: ReactNode,
  fetchImpl: ReturnType<typeof vi.fn>,
  route = "/app/evaluations",
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return renderWithI18n(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={authValue(fetchImpl as unknown as typeof fetch)}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
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

function callsContaining(fetchImpl: ReturnType<typeof vi.fn>, fragment: string) {
  return fetchImpl.mock.calls.filter(([input]) => String(input).includes(fragment));
}

function NavigationProbe() {
  const location = useLocation();
  return (
    <div>
      <h1>dataset landing</h1>
      <output aria-label="navigation pathname">{location.pathname}</output>
      <output aria-label="navigation state">{JSON.stringify(location.state)}</output>
    </div>
  );
}

describe("Evaluation Console pages", () => {
  beforeEach(async () => {
    vi.useRealTimers();
    window.sessionStorage.clear();
    setVisibility("visible");
    await resetI18n("zh-CN");
  });

  afterEach(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    vi.useRealTimers();
  });

  it("shows dataset loading before rendering backend datasets with their knowledge-base names", async () => {
    let resolveDatasets!: (response: Response) => void;
    const pendingDatasets = new Promise<Response>((resolve) => {
      resolveDatasets = resolve;
    });
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/evaluations/datasets")) return pendingDatasets;
      if (url.endsWith("/api/v1/knowledge-bases")) {
        return Promise.resolve(jsonResponse([knowledgeBase()]));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderConsole(<EvaluationsPage />, fetchImpl);

    expect(screen.getByText("正在加载评测数据集…")).toHaveAttribute("aria-busy", "true");
    await act(async () => {
      resolveDatasets(jsonResponse([evaluationDataset()]));
    });

    expect(await screen.findByRole("heading", { name: "评测数据集", level: 2 })).toBeVisible();
    expect(screen.getByRole("link", { name: "Support policy release gate" })).toHaveAttribute(
      "href",
      `/app/evaluations/datasets/${datasetId}`,
    );
    expect(screen.getByText("Stable regression cases for support answers")).toBeVisible();
    expect(screen.getByText("Support Policy KB")).toBeVisible();
    expect(screen.getByText("正常")).toBeVisible();
  });

  it("renders the actionable empty dataset state when an editable knowledge base exists", async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/evaluations/datasets")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/v1/knowledge-bases")) {
        return Promise.resolve(jsonResponse([knowledgeBase()]));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderConsole(<EvaluationsPage />, fetchImpl);

    expect(await screen.findByRole("heading", { name: "暂无可访问的评测数据集" })).toBeVisible();
    expect(screen.getAllByRole("link", { name: "创建数据集" })).not.toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "没有可确认的可编辑知识库" })).not.toBeInTheDocument();
  });

  it("surfaces a dataset-list Problem Details response and retries the real list request", async () => {
    const user = userEvent.setup();
    let datasetRequests = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/evaluations/datasets")) {
        datasetRequests += 1;
        return Promise.resolve(
          datasetRequests === 1
            ? problemResponse(
                503,
                "evaluation database is unavailable",
                "req-evaluation-list-503",
              )
            : jsonResponse([]),
        );
      }
      if (url.endsWith("/api/v1/knowledge-bases")) {
        return Promise.resolve(jsonResponse([knowledgeBase()]));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderConsole(<EvaluationsPage />, fetchImpl);

    expect(await screen.findByRole("heading", { name: "服务暂不可用" })).toBeVisible();
    expect(screen.getByText("req-evaluation-list-503")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "技术详情" }));
    expect(screen.getByText("evaluation database is unavailable")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByRole("heading", { name: "暂无可访问的评测数据集" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "服务暂不可用" })).not.toBeInTheDocument();
    expect(datasetRequests).toBe(2);
  });

  it("creates a dataset with the exact backend payload and navigates with created state", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/knowledge-bases")) {
        return Promise.resolve(jsonResponse([knowledgeBase()]));
      }
      if (url.endsWith("/api/v1/evaluations/datasets") && init?.method === "POST") {
        return Promise.resolve(jsonResponse(evaluationDataset(), { status: 201 }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderConsole(
      <Routes>
        <Route path="/app/evaluations/new" element={<CreateEvaluationDatasetPage />} />
        <Route path="/app/evaluations/datasets/:datasetId" element={<NavigationProbe />} />
      </Routes>,
      fetchImpl,
      "/app/evaluations/new",
    );

    await user.selectOptions(await screen.findByLabelText("知识库"), knowledgeBaseId);
    await user.type(screen.getByLabelText("数据集名称"), "  Support policy release gate  ");
    await user.type(screen.getByLabelText("描述（可选）"), "  Stable release evidence  ");
    await user.click(screen.getByRole("button", { name: "创建并录入用例" }));

    expect(await screen.findByRole("heading", { name: "dataset landing" })).toBeVisible();
    expect(screen.getByLabelText("navigation pathname")).toHaveTextContent(
      `/app/evaluations/datasets/${datasetId}`,
    );
    expect(screen.getByLabelText("navigation state")).toHaveTextContent('{"created":true}');

    const createCall = fetchImpl.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/api/v1/evaluations/datasets") && init?.method === "POST",
    );
    expect(createCall).toBeDefined();
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      knowledge_base_id: knowledgeBaseId,
      name: "Support policy release gate",
      description: "Stable release evidence",
    });
  });

  it("keeps the create form in place and renders OperationError on create failure", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/knowledge-bases")) {
        return Promise.resolve(jsonResponse([knowledgeBase()]));
      }
      if (url.endsWith("/api/v1/evaluations/datasets") && init?.method === "POST") {
        return Promise.resolve(
          problemResponse(
            409,
            "dataset name already exists in this knowledge base",
            "req-evaluation-create-409",
          ),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderConsole(<CreateEvaluationDatasetPage />, fetchImpl, "/app/evaluations/new");

    await user.selectOptions(await screen.findByLabelText("知识库"), knowledgeBaseId);
    await user.type(screen.getByLabelText("数据集名称"), "Release gate");
    await user.click(screen.getByRole("button", { name: "创建并录入用例" }));

    expect(await screen.findByRole("heading", { name: "请求冲突" })).toBeVisible();
    expect(screen.getByText("req-evaluation-create-409")).toBeVisible();
    expect(screen.getByLabelText("数据集名称")).toHaveValue("Release gate");
    await user.click(screen.getByRole("button", { name: "技术详情" }));
    expect(screen.getByText("dataset name already exists in this knowledge base")).toBeVisible();
  });

  it("does not claim dataset read-only access while permission resolution loads or fails, and retries it", async () => {
    const user = userEvent.setup();
    let resolveKnowledgeBases!: (response: Response) => void;
    const firstKnowledgeBaseRequest = new Promise<Response>((resolve) => {
      resolveKnowledgeBases = resolve;
    });
    let knowledgeBaseRequests = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/api/v1/evaluations/datasets/${datasetId}`)) {
        return Promise.resolve(jsonResponse(evaluationDataset()));
      }
      if (url.endsWith("/api/v1/knowledge-bases")) {
        knowledgeBaseRequests += 1;
        return knowledgeBaseRequests === 1
          ? firstKnowledgeBaseRequest
          : Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith(`/api/v1/evaluations/datasets/${datasetId}/cases`)) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents`)) {
        return Promise.resolve(jsonResponse([]));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderConsole(
      <Routes>
        <Route path="/app/evaluations/datasets/:datasetId" element={<EvaluationDatasetPage />} />
      </Routes>,
      fetchImpl,
      `/app/evaluations/datasets/${datasetId}`,
    );

    expect(await screen.findByText("正在加载评测数据集…")).toHaveAttribute("aria-busy", "true");
    expect(
      screen.queryByText("当前仅提供查看入口；写操作仍由后端按关联知识库权限校验。"),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolveKnowledgeBases(
        problemResponse(503, "knowledge-base permissions unavailable", "req-kb-permission-503"),
      );
    });
    expect(await screen.findByRole("heading", { name: "服务暂不可用" })).toBeVisible();
    expect(screen.getByText("req-kb-permission-503")).toBeVisible();
    expect(
      screen.queryByText("当前仅提供查看入口；写操作仍由后端按关联知识库权限校验。"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(
      await screen.findByText("当前仅提供查看入口；写操作仍由后端按关联知识库权限校验。"),
    ).toBeVisible();
    expect(knowledgeBaseRequests).toBe(2);
  });

  it("does not claim run recalculation is read-only while permission resolution loads or fails, and retries it", async () => {
    const user = userEvent.setup();
    let resolveKnowledgeBases!: (response: Response) => void;
    const firstKnowledgeBaseRequest = new Promise<Response>((resolve) => {
      resolveKnowledgeBases = resolve;
    });
    let knowledgeBaseRequests = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/api/v1/evaluations/runs/${candidateRunId}/report`)) {
        return Promise.resolve(jsonResponse(evaluationReport()));
      }
      if (url.endsWith(`/api/v1/evaluations/runs/${candidateRunId}`)) {
        return Promise.resolve(jsonResponse(evaluationRun("succeeded")));
      }
      if (url.endsWith("/api/v1/knowledge-bases")) {
        knowledgeBaseRequests += 1;
        return knowledgeBaseRequests === 1
          ? firstKnowledgeBaseRequest
          : Promise.resolve(jsonResponse([]));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderConsole(
      <Routes>
        <Route path="/app/evaluations/runs/:runId" element={<EvaluationRunPage />} />
      </Routes>,
      fetchImpl,
      `/app/evaluations/runs/${candidateRunId}`,
    );

    expect(await screen.findByText("正在加载评测数据集…")).toHaveAttribute("aria-busy", "true");
    expect(
      screen.queryByText("重算需要数据集关联知识库的 editor 权限。"),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolveKnowledgeBases(
        problemResponse(503, "knowledge-base permissions unavailable", "req-run-kb-503"),
      );
    });
    expect(await screen.findByRole("heading", { name: "服务暂不可用" })).toBeVisible();
    expect(screen.getByText("req-run-kb-503")).toBeVisible();
    expect(
      screen.queryByText("重算需要数据集关联知识库的 editor 权限。"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(
      await screen.findByText("重算需要数据集关联知识库的 editor 权限。"),
    ).toBeVisible();
    expect(knowledgeBaseRequests).toBe(2);
  });

  it("polls queued and running runs, renders the succeeded report, then stops polling", async () => {
    const statuses = ["queued", "running", "succeeded"];
    let runRequests = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/api/v1/evaluations/runs/${candidateRunId}/report`)) {
        return Promise.resolve(jsonResponse(evaluationReport()));
      }
      if (url.endsWith(`/api/v1/evaluations/runs/${candidateRunId}`)) {
        const status = statuses[Math.min(runRequests, statuses.length - 1)];
        runRequests += 1;
        return Promise.resolve(jsonResponse(evaluationRun(status)));
      }
      if (url.endsWith("/api/v1/knowledge-bases")) {
        return Promise.resolve(jsonResponse([knowledgeBase()]));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderConsole(
      <Routes>
        <Route path="/app/evaluations/runs/:runId" element={<EvaluationRunPage />} />
      </Routes>,
      fetchImpl,
      `/app/evaluations/runs/${candidateRunId}`,
    );

    expect(await screen.findByText("排队中")).toBeVisible();
    await act(async () => setVisibility("hidden"));
    vi.useFakeTimers();
    await act(async () => setVisibility("visible"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_600);
    });
    expect(screen.getByText("运行中")).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_600);
    });
    expect(screen.getByText("已完成")).toBeVisible();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { name: "汇总指标" })).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(runRequests).toBe(3);
  });

  it("pauses active-run polling while hidden and resumes on visibility", async () => {
    let runRequests = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/api/v1/evaluations/runs/${candidateRunId}`)) {
        runRequests += 1;
        return Promise.resolve(jsonResponse(evaluationRun("running")));
      }
      if (url.endsWith("/api/v1/knowledge-bases")) {
        return Promise.resolve(jsonResponse([knowledgeBase()]));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderConsole(
      <Routes>
        <Route path="/app/evaluations/runs/:runId" element={<EvaluationRunPage />} />
      </Routes>,
      fetchImpl,
      `/app/evaluations/runs/${candidateRunId}`,
    );

    expect(await screen.findByText("运行中")).toBeVisible();
    await act(async () => setVisibility("hidden"));
    expect(screen.getByText("页面隐藏时已暂停运行轮询。")).toBeVisible();

    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_500);
    });
    expect(runRequests).toBe(1);

    await act(async () => setVisibility("visible"));
    expect(screen.queryByText("页面隐藏时已暂停运行轮询。")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_600);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(runRequests).toBe(2);
    expect(screen.getByText("运行中")).toBeVisible();
  });

  it("recalculates through the real client method and refetches both run and report", async () => {
    const user = userEvent.setup();
    let runGets = 0;
    let reportGets = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/api/v1/evaluations/runs/${candidateRunId}/recalculate`)) {
        return Promise.resolve(
          jsonResponse(
            evaluationRun("succeeded", { updated_at: "2026-07-15T08:32:00+08:00" }),
          ),
        );
      }
      if (url.endsWith(`/api/v1/evaluations/runs/${candidateRunId}/report`)) {
        reportGets += 1;
        return Promise.resolve(jsonResponse(evaluationReport()));
      }
      if (url.endsWith(`/api/v1/evaluations/runs/${candidateRunId}`) && init?.method === "GET") {
        runGets += 1;
        return Promise.resolve(
          jsonResponse(
            evaluationRun("succeeded", {
              updated_at:
                runGets === 1 ? "2026-07-15T08:31:00+08:00" : "2026-07-15T08:32:00+08:00",
            }),
          ),
        );
      }
      if (url.endsWith("/api/v1/knowledge-bases")) {
        return Promise.resolve(jsonResponse([knowledgeBase()]));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderConsole(
      <Routes>
        <Route path="/app/evaluations/runs/:runId" element={<EvaluationRunPage />} />
      </Routes>,
      fetchImpl,
      `/app/evaluations/runs/${candidateRunId}`,
    );

    expect(await screen.findByRole("heading", { name: "汇总指标" })).toBeVisible();
    await user.click(await screen.findByRole("button", { name: "重算指标" }));

    await waitFor(() => {
      expect(
        callsContaining(
          fetchImpl,
          `/api/v1/evaluations/runs/${candidateRunId}/recalculate`,
        ),
      ).toHaveLength(1);
      expect(runGets).toBeGreaterThan(1);
      expect(reportGets).toBeGreaterThan(1);
    });
    const recalculateCall = callsContaining(
      fetchImpl,
      `/api/v1/evaluations/runs/${candidateRunId}/recalculate`,
    )[0];
    expect(recalculateCall[1]?.method).toBe("POST");
  });

  it("preserves comparison inputs while hiding results associated with the pre-recalculation run version", async () => {
    const user = userEvent.setup();
    let candidateRunGets = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/api/v1/evaluations/runs/${baselineRunId}`)) {
        return Promise.resolve(
          jsonResponse(
            evaluationRun("succeeded", {
              id: baselineRunId,
              updated_at: "2026-07-15T08:30:00+08:00",
            }),
          ),
        );
      }
      if (url.endsWith(`/api/v1/evaluations/runs/${candidateRunId}/compare`)) {
        return Promise.resolve(jsonResponse(runComparison()));
      }
      if (url.endsWith(`/api/v1/evaluations/runs/${candidateRunId}/gate`)) {
        return Promise.resolve(jsonResponse(qualityGateReport()));
      }
      if (url.endsWith(`/api/v1/evaluations/runs/${candidateRunId}/recalculate`)) {
        return Promise.resolve(
          jsonResponse(
            evaluationRun("succeeded", { updated_at: "2026-07-15T08:32:00+08:00" }),
          ),
        );
      }
      if (url.endsWith(`/api/v1/evaluations/runs/${candidateRunId}/report`)) {
        return Promise.resolve(jsonResponse(evaluationReport()));
      }
      if (url.endsWith(`/api/v1/evaluations/runs/${candidateRunId}`) && init?.method === "GET") {
        candidateRunGets += 1;
        return Promise.resolve(
          jsonResponse(
            evaluationRun("succeeded", {
              updated_at:
                candidateRunGets === 1
                  ? "2026-07-15T08:31:00+08:00"
                  : "2026-07-15T08:32:00+08:00",
            }),
          ),
        );
      }
      if (url.endsWith("/api/v1/knowledge-bases")) {
        return Promise.resolve(jsonResponse([knowledgeBase()]));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderConsole(
      <Routes>
        <Route path="/app/evaluations/runs/:runId" element={<EvaluationRunPage />} />
      </Routes>,
      fetchImpl,
      `/app/evaluations/runs/${candidateRunId}`,
    );

    expect(await screen.findByRole("heading", { name: "汇总指标" })).toBeVisible();
    const baselineInput = await screen.findByLabelText("基线运行 UUID");
    await user.type(baselineInput, baselineRunId);
    await user.click(screen.getByText("高级阈值"));
    const thresholds = '{\n  "require_zero_failed_cases": false\n}';
    fireEvent.change(screen.getByLabelText("高级阈值"), { target: { value: thresholds } });
    await user.click(screen.getByRole("button", { name: "对比" }));
    expect(await screen.findByText("retrieval.top_k")).toBeVisible();
    await user.click(screen.getAllByRole("button", { name: "执行质量门禁" })[0]);
    expect(await screen.findByRole("heading", { name: "门禁通过" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "重算指标" }));

    await waitFor(() => {
      expect(screen.queryAllByText("retrieval.top_k")).toHaveLength(0);
      expect(screen.queryByRole("heading", { name: "门禁通过" })).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText("基线运行 UUID")).toHaveValue(baselineRunId);
    expect(screen.getByLabelText("高级阈值")).toHaveValue(thresholds);
  });

  it("preserves dataset-create form state across a zh-CN to en-US locale switch", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/knowledge-bases")) {
        return Promise.resolve(jsonResponse([knowledgeBase()]));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderConsole(<CreateEvaluationDatasetPage />, fetchImpl, "/app/evaluations/new");

    await user.selectOptions(await screen.findByLabelText("知识库"), knowledgeBaseId);
    await user.type(screen.getByLabelText("数据集名称"), "发布门禁 v2");
    await user.type(screen.getByLabelText("描述（可选）"), "保留中文输入");
    await act(async () => {
      await changeAppLocale("en-US");
    });

    expect(await screen.findByRole("heading", { name: "Create evaluation dataset" })).toBeVisible();
    expect(screen.getByLabelText("Knowledge base")).toHaveValue(knowledgeBaseId);
    expect(screen.getByLabelText("Dataset name")).toHaveValue("发布门禁 v2");
    expect(screen.getByLabelText("Description (optional)")).toHaveValue("保留中文输入");
  });

  it("preserves baseline and advanced gate inputs across a zh-CN to en-US locale switch", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/api/v1/evaluations/runs/${candidateRunId}/report`)) {
        return Promise.resolve(jsonResponse(evaluationReport()));
      }
      if (url.endsWith(`/api/v1/evaluations/runs/${candidateRunId}`)) {
        return Promise.resolve(jsonResponse(evaluationRun("succeeded")));
      }
      if (url.endsWith("/api/v1/knowledge-bases")) {
        return Promise.resolve(jsonResponse([knowledgeBase()]));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderConsole(
      <Routes>
        <Route path="/app/evaluations/runs/:runId" element={<EvaluationRunPage />} />
      </Routes>,
      fetchImpl,
      `/app/evaluations/runs/${candidateRunId}`,
    );

    expect(await screen.findByRole("heading", { name: "汇总指标" })).toBeVisible();
    const baselineInput = await screen.findByLabelText("基线运行 UUID");
    await user.type(baselineInput, baselineRunId);
    await user.click(screen.getByText("高级阈值"));
    const thresholds = '{\n  "require_zero_failed_cases": false\n}';
    fireEvent.change(screen.getByLabelText("高级阈值"), { target: { value: thresholds } });

    await act(async () => {
      await changeAppLocale("en-US");
    });

    expect(await screen.findByRole("heading", { name: "Evaluation runs" })).toBeVisible();
    expect(screen.getByLabelText("Baseline run UUID")).toHaveValue(baselineRunId);
    expect(screen.getByLabelText("Advanced thresholds")).toHaveValue(thresholds);
    expect(screen.getByText("Compare runs")).toBeVisible();
  });
});
