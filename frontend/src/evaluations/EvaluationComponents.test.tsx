import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createApiClient } from "@/api/client";
import type { EvaluationRun } from "@/api/types";
import { AuthContext, type AuthContextValue } from "@/auth/authContext";
import { changeAppLocale } from "@/i18n";
import { renderWithI18n, resetI18n } from "@/test/i18nTestUtils";
import { ComparisonGatePanel } from "./ComparisonGatePanel";
import { EvaluationReport } from "./EvaluationReport";
import { EvaluationRunPanel } from "./EvaluationRunPanel";

const knowledgeBaseId = "11111111-1111-4111-8111-111111111111";
const datasetId = "22222222-2222-4222-8222-222222222222";
const caseId = "33333333-3333-4333-8333-333333333333";
const baselineRunId = "44444444-4444-4444-8444-444444444444";
const candidateRunId = "55555555-5555-4555-8555-555555555555";
const resultId = "66666666-6666-4666-8666-666666666666";
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

function evaluationRun(
  id = candidateRunId,
  overrides: Partial<EvaluationRun> = {},
): EvaluationRun {
  return {
    id,
    tenant_id: "default",
    knowledge_base_id: knowledgeBaseId,
    dataset_id: datasetId,
    retry_of_run_id: null,
    created_by: "qa-user",
    task_id: "task-evaluation-1",
    status: "succeeded",
    progress: 100,
    total_cases: 1,
    completed_cases: 1,
    failed_cases: 0,
    config_snapshot: { retrieval: { top_k: 10 }, rerank: { enabled: true } },
    summary: { retrieval_recall_at_k: 0.92 },
    started_at: timestamp,
    completed_at: timestamp,
    error_message: null,
    cancelled_at: null,
    cancelled_by: null,
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

function comparisonFixture() {
  return {
    baseline_run_id: baselineRunId,
    candidate_run_id: candidateRunId,
    dataset_id: datasetId,
    metrics: [
      {
        metric: "retrieval_recall_at_k",
        baseline: 0.8,
        candidate: 0.9,
        delta: 0.1,
        relative_delta: 0.125,
      },
      {
        metric: "citation_precision",
        baseline: 0.95,
        candidate: 0.85,
        delta: -0.1,
        relative_delta: -0.105263,
      },
      {
        metric: "average_total_latency_ms",
        baseline: null,
        candidate: 1250,
        delta: null,
        relative_delta: null,
      },
    ],
    config_differences: [
      {
        key: "retrieval.top_k",
        baseline: 8,
        candidate: 10,
      },
    ],
  };
}

function qualityGateFixture(passed: boolean) {
  return {
    passed,
    comparison: comparisonFixture(),
    checks: [
      {
        metric: "citation_precision",
        rule: "minimum_candidate",
        threshold: 0.9,
        baseline: 0.95,
        candidate: 0.85,
        actual: 0.85,
        passed,
        reason: passed ? "candidate meets release floor" : "candidate below release floor",
      },
    ],
  };
}

function reportFixture() {
  return {
    run: evaluationRun(candidateRunId, {
      summary: {
        retrieval_recall_at_k: null,
        average_total_latency_ms: 1840,
        // citation_precision is intentionally absent in the backend report.
      },
    }),
    dataset: {
      id: datasetId,
      tenant_id: "default",
      knowledge_base_id: knowledgeBaseId,
      name: "Release evidence set",
      description: "Stable release questions",
      status: "active",
      created_by: "qa-user",
      created_at: timestamp,
      updated_at: timestamp,
    },
    results: [
      {
        id: resultId,
        run_id: candidateRunId,
        case_id: caseId,
        status: "succeeded",
        rewritten_query: null,
        answer:
          "Policy is retained [来源:Policy.pdf#chunk-a]. <script>window.compromised = true</script>",
        retrieved_documents: [{ content: "Retrieval record without IDs" }],
        reranked_documents: [{}],
        citations: [
          {
            document_name: "Policy.pdf",
            chunk_ids: ["chunk-a"],
            evidence_content: "Retention evidence from a sparse citation record",
          },
        ],
        citation_evidence: [{ quote: "Evidence quote without document or chunk identifiers" }],
        metrics: {
          citation_precision: null,
          expected_refusal: false,
          rerank_fallback_reason: "",
        },
        first_token_ms: null,
        total_latency_ms: null,
        error_message: null,
        created_at: timestamp,
        updated_at: timestamp,
        question: "How long is the policy retained?",
        reference_answer: "The policy is retained for seven years.",
        expected_document_ids: [],
        acceptable_citation_document_ids: [],
        required_key_points: ["seven years"],
        required_key_point_groups: [["seven years", "7 years"]],
        should_refuse: false,
        tags: ["retention"],
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
      user_id: "qa-user",
      tenant_id: "default",
      roles: ["rag-user"],
      groups: ["quality"],
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

function renderEvaluation(ui: React.ReactNode, fetchImpl: typeof fetch = vi.fn() as unknown as typeof fetch) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderWithI18n(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={authValue(fetchImpl)}>
        <MemoryRouter>{ui}</MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

function metricRow(rawMetricTitle: string): HTMLTableRowElement {
  const row = screen
    .getAllByTitle(rawMetricTitle)
    .map((element) => element.closest("tr"))
    .find((element): element is HTMLTableRowElement => element instanceof HTMLTableRowElement);
  if (!row) {
    throw new Error(`Metric row not found for ${rawMetricTitle}`);
  }
  return row;
}

function routeFetch(
  endpoint: "compare" | "gate",
  response: Response,
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === `http://api.test/api/v1/evaluations/runs/${baselineRunId}`) {
      return jsonResponse(evaluationRun(baselineRunId));
    }
    if (url === `http://api.test/api/v1/evaluations/runs/${candidateRunId}/${endpoint}`) {
      return response;
    }
    throw new Error(`Unexpected evaluation request: ${url}`);
  }) as unknown as typeof fetch;
}

describe("Evaluation components", () => {
  beforeEach(async () => {
    await resetI18n("zh-CN");
  });

  it("renders null and missing report metrics as localized unavailable values and safely handles sparse evidence records", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(reportFixture())) as unknown as typeof fetch;
    const { container } = renderEvaluation(<EvaluationReport runId={candidateRunId} />, fetchImpl);

    const summary = await screen.findByRole("region", { name: "汇总指标" });
    const nullSummaryMetric = within(summary).getByText("检索召回率 @ k").closest("div");
    const missingSummaryMetric = within(summary).getByText("引用精确率").closest("div");
    expect(nullSummaryMetric).toHaveTextContent("不可用");
    expect(nullSummaryMetric).not.toHaveTextContent("0%");
    expect(missingSummaryMetric).toHaveTextContent("不可用");
    expect(missingSummaryMetric).not.toHaveTextContent("0%");

    const nullCaseMetric = metricRow("原始指标键：citation_precision");
    expect(nullCaseMetric).toHaveTextContent("不可用");
    expect(nullCaseMetric).not.toHaveTextContent("0%");
    expect(metricRow("原始指标键：expected_refusal")).toHaveTextContent("false");
    expect(metricRow("原始指标键：rerank_fallback_reason")).toHaveTextContent("不可用");

    expect(screen.getByRole("button", { name: "引用 1" })).toBeVisible();
    expect(screen.getByText("初始检索文档 1")).toBeInTheDocument();
    expect(screen.getByText("重排后文档 1")).toBeInTheDocument();
    expect(screen.getByText("答案引用 1")).toBeInTheDocument();
    expect(screen.getByText("引用证据 1")).toBeInTheDocument();
    expect(screen.getByText("Retention evidence from a sparse citation record")).toBeInTheDocument();
    expect(screen.getByText("Evidence quote without document or chunk identifiers")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();

    await act(async () => {
      await changeAppLocale("en-US");
    });
    const englishSummary = await screen.findByRole("region", { name: "Summary metrics" });
    expect(within(englishSummary).getByText("Retrieval recall @ k").closest("div")).toHaveTextContent(
      "Unavailable",
    );
    expect(metricRow("Raw metric key: citation_precision")).toHaveTextContent("Unavailable");
  });

  it("reports active run progress honestly while polling is paused", () => {
    renderEvaluation(
      <EvaluationRunPanel
        run={evaluationRun(candidateRunId, {
          status: "running",
          progress: 75,
          total_cases: 4,
          completed_cases: 3,
          completed_at: null,
        })}
        visible={false}
        canRecalculate={false}
        recalculating={false}
        onRecalculate={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "评测运行" })).toBeVisible();
    expect(screen.getByText("运行中")).toBeVisible();
    expect(screen.getByText("页面隐藏时已暂停运行轮询。")).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "75");
    expect(screen.getByText("已处理 3 / 4，失败 0")).toBeVisible();
    expect(screen.queryByRole("button", { name: "重算指标" })).not.toBeInTheDocument();
  });

  it("offers safe queued cancellation but never force-cancels a running evaluation", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { rerender } = renderEvaluation(
      <EvaluationRunPanel
        run={evaluationRun(candidateRunId, {
          status: "queued",
          progress: 0,
          completed_cases: 0,
          started_at: null,
          completed_at: null,
        })}
        visible
        canRecalculate={false}
        recalculating={false}
        onRecalculate={vi.fn()}
        canControl
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole("button", { name: "取消排队运行" }));
    expect(onCancel).toHaveBeenCalledOnce();

    rerender(
      <EvaluationRunPanel
        run={evaluationRun(candidateRunId, {
          status: "running",
          progress: 50,
          completed_cases: 1,
          completed_at: null,
        })}
        visible
        canRecalculate={false}
        recalculating={false}
        onRecalculate={vi.fn()}
        canControl
        onCancel={onCancel}
      />,
    );
    expect(screen.queryByRole("button", { name: "取消排队运行" })).not.toBeInTheDocument();
    expect(
      screen.getByText("运行已经开始；为保留逐用例结果一致性，不执行强制终止。"),
    ).toBeVisible();
  });

  it("shows cancellation lineage and allows a linked evaluation retry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderEvaluation(
      <EvaluationRunPanel
        run={evaluationRun(candidateRunId, {
          status: "cancelled",
          progress: 0,
          completed_cases: 0,
          retry_of_run_id: baselineRunId,
          cancelled_at: timestamp,
          cancelled_by: "operator-a",
        })}
        visible
        canRecalculate={false}
        recalculating={false}
        onRecalculate={vi.fn()}
        canControl
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("已取消")).toBeVisible();
    expect(screen.getByText("取消操作者：operator-a")).toBeVisible();
    expect(screen.getByText(baselineRunId)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重试运行" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("classifies comparison metrics and preserves comparison, baseline, and threshold state across locale changes", async () => {
    const user = userEvent.setup();
    const fetchImpl = routeFetch("compare", jsonResponse(comparisonFixture()));
    renderEvaluation(<ComparisonGatePanel candidateRun={evaluationRun()} />, fetchImpl);

    const baselineInput = screen.getByLabelText("基线运行 UUID");
    await user.type(baselineInput, baselineRunId);
    await user.click(screen.getByText("高级阈值"));
    const thresholdEditor = screen.getByLabelText("高级阈值");
    const customThresholds = JSON.stringify(
      { minimum_candidate_metrics: { citation_precision: 0.88 } },
      null,
      2,
    );
    fireEvent.change(thresholdEditor, { target: { value: customThresholds } });
    await user.click(screen.getByRole("button", { name: "对比" }));

    expect(await screen.findByText("retrieval.top_k")).toBeVisible();
    expect(metricRow("原始指标键：retrieval_recall_at_k")).toHaveTextContent("改善");
    expect(metricRow("原始指标键：citation_precision")).toHaveTextContent("回退");
    const notComparable = metricRow("原始指标键：average_total_latency_ms");
    expect(notComparable).toHaveTextContent("不可比较");
    expect(notComparable).toHaveTextContent("基线或候选缺少可计算值");

    await act(async () => {
      await changeAppLocale("en-US");
    });

    expect(await screen.findByRole("heading", { name: "Compare runs", level: 2 })).toBeVisible();
    expect(screen.getByLabelText("Baseline run UUID")).toHaveValue(baselineRunId);
    expect(screen.getByLabelText("Advanced thresholds")).toHaveValue(customThresholds);
    expect(metricRow("Raw metric key: retrieval_recall_at_k")).toHaveTextContent("Improvement");
    expect(metricRow("Raw metric key: citation_precision")).toHaveTextContent("Regression");
    expect(metricRow("Raw metric key: average_total_latency_ms")).toHaveTextContent("Not comparable");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("renders a passing HTTP 200 quality-gate report and preserves it with advanced thresholds after a locale change", async () => {
    const user = userEvent.setup();
    const fetchImpl = routeFetch(
      "gate",
      jsonResponse(qualityGateFixture(true), {
        headers: { "x-request-id": "req-gate-200-component" },
      }),
    );
    renderEvaluation(<ComparisonGatePanel candidateRun={evaluationRun()} />, fetchImpl);

    await user.type(screen.getByLabelText("基线运行 UUID"), baselineRunId);
    await user.click(screen.getByText("高级阈值"));
    const thresholdEditor = screen.getByLabelText("高级阈值");
    const customThresholds = JSON.stringify(
      { minimum_candidate_metrics: { citation_precision: 0.84 } },
      null,
      2,
    );
    fireEvent.change(thresholdEditor, { target: { value: customThresholds } });
    const gateButtons = screen.getAllByRole("button", { name: "执行质量门禁" });
    await user.click(gateButtons[gateButtons.length - 1]);

    expect(await screen.findByRole("heading", { name: "门禁通过" })).toBeVisible();
    expect(screen.getAllByText("candidate meets release floor")).toHaveLength(2);
    expect(screen.getByText("req-gate-200-component")).toBeVisible();
    const fetchMock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({
      baseline_run_id: baselineRunId,
      thresholds: { minimum_candidate_metrics: { citation_precision: 0.84 } },
    });

    await act(async () => {
      await changeAppLocale("en-US");
    });

    expect(await screen.findByRole("heading", { name: "Gate passed" })).toBeVisible();
    expect(screen.getByLabelText("Baseline run UUID")).toHaveValue(baselineRunId);
    expect(screen.getByLabelText("Advanced thresholds")).toHaveValue(customThresholds);
    expect(screen.getAllByText("candidate meets release floor")).toHaveLength(2);
  });

  it("retries an advanced gate with the exact failed thresholds even after the editor changes", async () => {
    const user = userEvent.setup();
    let gateRequests = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `http://api.test/api/v1/evaluations/runs/${baselineRunId}`) {
        return jsonResponse(evaluationRun(baselineRunId));
      }
      if (url === `http://api.test/api/v1/evaluations/runs/${candidateRunId}/gate`) {
        gateRequests += 1;
        return gateRequests === 1
          ? jsonResponse(
              {
                type: "about:blank",
                title: "Service Unavailable",
                status: 503,
                detail: "quality gate service is unavailable",
                request_id: "req-gate-retry-503",
              },
              { status: 503, headers: { "Content-Type": "application/problem+json" } },
            )
          : jsonResponse(qualityGateFixture(true));
      }
      throw new Error(`Unexpected evaluation request: ${url} ${init?.method ?? "GET"}`);
    }) as unknown as typeof fetch;
    renderEvaluation(<ComparisonGatePanel candidateRun={evaluationRun()} />, fetchImpl);

    await user.type(screen.getByLabelText("基线运行 UUID"), baselineRunId);
    await user.click(screen.getByText("高级阈值"));
    const originalThresholds = {
      minimum_candidate_metrics: { citation_precision: 0.84 },
      require_zero_failed_cases: false,
    };
    fireEvent.change(screen.getByLabelText("高级阈值"), {
      target: { value: JSON.stringify(originalThresholds, null, 2) },
    });
    const gateButtons = screen.getAllByRole("button", { name: "执行质量门禁" });
    await user.click(gateButtons[gateButtons.length - 1]);

    const error = await screen.findByRole("alert");
    fireEvent.change(screen.getByLabelText("高级阈值"), {
      target: {
        value: JSON.stringify(
          { minimum_candidate_metrics: { citation_precision: 0.99 } },
          null,
          2,
        ),
      },
    });
    await user.click(within(error).getByRole("button", { name: "重试" }));

    expect(await screen.findByRole("heading", { name: "门禁通过" })).toBeVisible();
    const gateCalls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([input]) => String(input).endsWith(`/evaluations/runs/${candidateRunId}/gate`),
    );
    expect(gateCalls).toHaveLength(2);
    for (const call of gateCalls) {
      expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
        baseline_run_id: baselineRunId,
        thresholds: originalThresholds,
      });
    }
  });

  it("keeps a default gate retry on the default request contract", async () => {
    const user = userEvent.setup();
    let gateRequests = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `http://api.test/api/v1/evaluations/runs/${baselineRunId}`) {
        return jsonResponse(evaluationRun(baselineRunId));
      }
      if (url === `http://api.test/api/v1/evaluations/runs/${candidateRunId}/gate`) {
        gateRequests += 1;
        return gateRequests === 1
          ? jsonResponse(
              {
                type: "about:blank",
                title: "Service Unavailable",
                status: 503,
                detail: "quality gate service is unavailable",
                request_id: "req-default-gate-retry-503",
              },
              { status: 503, headers: { "Content-Type": "application/problem+json" } },
            )
          : jsonResponse(qualityGateFixture(true));
      }
      throw new Error(`Unexpected evaluation request: ${url}`);
    }) as unknown as typeof fetch;
    renderEvaluation(<ComparisonGatePanel candidateRun={evaluationRun()} />, fetchImpl);

    await user.type(screen.getByLabelText("基线运行 UUID"), baselineRunId);
    await user.click(screen.getAllByRole("button", { name: "执行质量门禁" })[0]);
    const error = await screen.findByRole("alert");
    await user.click(within(error).getByRole("button", { name: "重试" }));

    expect(await screen.findByRole("heading", { name: "门禁通过" })).toBeVisible();
    const gateCalls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([input]) => String(input).endsWith(`/evaluations/runs/${candidateRunId}/gate`),
    );
    expect(gateCalls).toHaveLength(2);
    for (const call of gateCalls) {
      expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
        baseline_run_id: baselineRunId,
      });
    }
  });

  it("formats max increase ratio thresholds and actuals as percentages without changing latency units", async () => {
    const user = userEvent.setup();
    const report = qualityGateFixture(false);
    report.checks = [
      {
        metric: "average_total_latency_ms",
        rule: "max_increase_ratio",
        threshold: 0.2,
        baseline: 500,
        candidate: 600,
        actual: 0.25,
        passed: false,
        reason: "candidate latency increased too much",
      },
    ];
    const fetchImpl = routeFetch("gate", jsonResponse(report));
    renderEvaluation(<ComparisonGatePanel candidateRun={evaluationRun()} />, fetchImpl);

    await user.type(screen.getByLabelText("基线运行 UUID"), baselineRunId);
    await user.click(screen.getAllByRole("button", { name: "执行质量门禁" })[0]);

    expect(await screen.findByRole("heading", { name: "门禁未通过" })).toBeVisible();
    const ratioRow = screen
      .getAllByText("average_total_latency_ms")
      .map((element) => element.closest("tr"))
      .find((row): row is HTMLTableRowElement =>
        Boolean(row?.textContent?.includes("最大增幅")),
      );
    expect(ratioRow).toBeDefined();
    expect(within(ratioRow!).getByText("20%")).toBeVisible();
    expect(within(ratioRow!).getByText("500 ms")).toBeVisible();
    expect(within(ratioRow!).getByText("600 ms")).toBeVisible();
    expect(within(ratioRow!).getByText("25%")).toBeVisible();
  });

  it("renders the parsed failed report from an HTTP 409 conflict instead of an operation error", async () => {
    const user = userEvent.setup();
    const fetchImpl = routeFetch(
      "gate",
      jsonResponse(
        {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          detail: "quality gate rejected the candidate",
          request_id: "req-gate-409-component",
          data: qualityGateFixture(false),
        },
        { status: 409, headers: { "Content-Type": "application/problem+json" } },
      ),
    );
    renderEvaluation(<ComparisonGatePanel candidateRun={evaluationRun()} />, fetchImpl);

    await user.type(screen.getByLabelText("基线运行 UUID"), baselineRunId);
    await user.click(screen.getAllByRole("button", { name: "执行质量门禁" })[0]);

    expect(await screen.findByRole("heading", { name: "门禁未通过" })).toBeVisible();
    expect(screen.getByText("候选未通过门禁。服务端返回的检查明细仍应完整展示。")).toBeVisible();
    expect(screen.getAllByText("candidate below release floor")).toHaveLength(2);
    expect(screen.getByText("req-gate-409-component")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "请求冲突" })).not.toBeInTheDocument();
  });

  it("keeps an HTTP 422 gate response in OperationError even when problem data resembles a failed report", async () => {
    const user = userEvent.setup();
    const fetchImpl = routeFetch(
      "gate",
      jsonResponse(
        {
          type: "urn:rag-study-helper:validation-error",
          title: "Unprocessable Entity",
          status: 422,
          detail: "threshold configuration is invalid",
          request_id: "req-gate-422-component",
          data: qualityGateFixture(false),
        },
        { status: 422, headers: { "Content-Type": "application/problem+json" } },
      ),
    );
    renderEvaluation(<ComparisonGatePanel candidateRun={evaluationRun()} />, fetchImpl);

    await user.type(screen.getByLabelText("基线运行 UUID"), baselineRunId);
    await user.click(screen.getAllByRole("button", { name: "执行质量门禁" })[0]);

    const error = await screen.findByRole("alert");
    expect(within(error).getByRole("heading", { name: "请求无效" })).toBeVisible();
    expect(within(error).getByText("req-gate-422-component")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "门禁未通过" })).not.toBeInTheDocument();
    await user.click(within(error).getByRole("button", { name: "技术详情" }));
    expect(within(error).getByText("threshold configuration is invalid")).toBeVisible();
  });
});
