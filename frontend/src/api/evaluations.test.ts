import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client";
import { ApiError } from "./errors";
import { DEFAULT_EVALUATION_QUALITY_GATE_THRESHOLDS } from "./types";

const knowledgeBaseId = "11111111-1111-4111-8111-111111111111";
const datasetId = "22222222-2222-4222-8222-222222222222";
const caseId = "33333333-3333-4333-8333-333333333333";
const baselineRunId = "44444444-4444-4444-8444-444444444444";
const candidateRunId = "55555555-5555-4555-8555-555555555555";
const resultId = "66666666-6666-4666-8666-666666666666";
const documentId = "77777777-7777-4777-8777-777777777777";
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

function evaluationDataset() {
  return {
    id: datasetId,
    tenant_id: "default",
    knowledge_base_id: knowledgeBaseId,
    name: "Release gate",
    description: null,
    status: "active",
    created_by: "user-1",
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function evaluationCase() {
  return {
    id: caseId,
    dataset_id: datasetId,
    question: "What is the retention period?",
    reference_answer: "Seven years.",
    expected_document_ids: [documentId],
    acceptable_citation_document_ids: [documentId],
    required_key_points: ["seven years"],
    required_key_point_groups: [["seven years", "7 years"]],
    should_refuse: false,
    tags: ["retention"],
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function evaluationRun(id = candidateRunId) {
  return {
    id,
    tenant_id: "default",
    knowledge_base_id: knowledgeBaseId,
    dataset_id: datasetId,
    created_by: "user-1",
    task_id: "task-1",
    status: "succeeded",
    progress: 100,
    total_cases: 1,
    completed_cases: 1,
    failed_cases: 0,
    config_snapshot: { retrieval: { top_k: 10 }, feature_flags: ["rerank"] },
    summary: { retrieval_recall_at_k: 1, evolving_metric: null },
    started_at: timestamp,
    completed_at: timestamp,
    error_message: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function comparison() {
  return {
    baseline_run_id: baselineRunId,
    candidate_run_id: candidateRunId,
    dataset_id: datasetId,
    metrics: [
      {
        metric: "retrieval_recall_at_k",
        baseline: 1,
        candidate: 1,
        delta: 0,
        relative_delta: 0,
      },
      {
        metric: "new_optional_metric",
        baseline: null,
      },
    ],
    config_differences: [
      {
        key: "retrieval",
        baseline: { top_k: 8 },
        candidate: { top_k: 10, future_option: true },
      },
    ],
  };
}

function qualityGateReport(passed: boolean) {
  return {
    passed,
    comparison: comparison(),
    checks: [
      {
        metric: "retrieval_recall_at_k",
        rule: "max_regression",
        threshold: 0,
        baseline: 1,
        candidate: 1,
        actual: 0,
        passed: true,
        reason: "within tolerance",
      },
      {
        metric: "new_optional_metric",
        rule: "minimum_candidate",
        threshold: 0.5,
        baseline: null,
        passed,
        reason: "metric is not available yet",
      },
    ],
  };
}

function evaluationReport() {
  return {
    run: evaluationRun(),
    dataset: evaluationDataset(),
    results: [
      {
        id: resultId,
        run_id: candidateRunId,
        case_id: caseId,
        status: "succeeded",
        rewritten_query: null,
        answer: "Seven years.",
        retrieved_documents: [
          { document_id: documentId, score: 0.99, future_payload: { ranker: "hybrid" } },
        ],
        reranked_documents: [{ document_id: documentId, rank: 1 }],
        citations: [{ document_id: documentId, chunk_ids: ["chunk-1"] }],
        citation_evidence: [{ quote: "retain for seven years", offsets: [4, 26] }],
        metrics: { retrieval_recall_at_k: 1, future_metric: null },
        first_token_ms: null,
        error_message: null,
        created_at: timestamp,
        updated_at: timestamp,
        question: "What is the retention period?",
        reference_answer: "Seven years.",
        expected_document_ids: [documentId],
        acceptable_citation_document_ids: [documentId],
        required_key_points: ["seven years"],
        required_key_point_groups: [["seven years", "7 years"]],
        should_refuse: false,
        tags: ["retention"],
      },
    ],
  };
}

function createClient(fetchImpl: ReturnType<typeof vi.fn>) {
  return createApiClient({
    baseUrl: "http://api.test",
    getAccessToken: async () => "token",
    renewAccessToken: async () => null,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
}

describe("Evaluation Console API client", () => {
  it("covers dataset, case, run, report, and comparison routes", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([evaluationDataset()]))
      .mockResolvedValueOnce(jsonResponse(evaluationDataset(), { status: 201 }))
      .mockResolvedValueOnce(jsonResponse(evaluationDataset()))
      .mockResolvedValueOnce(jsonResponse(evaluationCase(), { status: 201 }))
      .mockResolvedValueOnce(jsonResponse([evaluationCase()]))
      .mockResolvedValueOnce(jsonResponse(evaluationRun(), { status: 202 }))
      .mockResolvedValueOnce(jsonResponse(evaluationRun()))
      .mockResolvedValueOnce(jsonResponse(evaluationReport()))
      .mockResolvedValueOnce(jsonResponse(comparison()));
    const api = createClient(fetchImpl);

    await api.listEvaluationDatasets();
    await api.createEvaluationDataset({
      knowledge_base_id: knowledgeBaseId,
      name: "Release gate",
    });
    await api.getEvaluationDataset(datasetId);
    await api.createEvaluationCase(datasetId, {
      question: "What is the retention period?",
      reference_answer: "Seven years.",
      expected_document_ids: [documentId],
    });
    await api.listEvaluationCases(datasetId);
    await api.createEvaluationRun({ dataset_id: datasetId });
    await api.getEvaluationRun(candidateRunId);
    const report = await api.getEvaluationRunReport(candidateRunId);
    const compared = await api.compareEvaluationRuns(candidateRunId, {
      baseline_run_id: baselineRunId,
    });

    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      "http://api.test/api/v1/evaluations/datasets",
      "http://api.test/api/v1/evaluations/datasets",
      `http://api.test/api/v1/evaluations/datasets/${datasetId}`,
      `http://api.test/api/v1/evaluations/datasets/${datasetId}/cases`,
      `http://api.test/api/v1/evaluations/datasets/${datasetId}/cases`,
      "http://api.test/api/v1/evaluations/runs",
      `http://api.test/api/v1/evaluations/runs/${candidateRunId}`,
      `http://api.test/api/v1/evaluations/runs/${candidateRunId}/report`,
      `http://api.test/api/v1/evaluations/runs/${candidateRunId}/compare`,
    ]);
    expect(JSON.parse(String((fetchImpl.mock.calls[1][1] as RequestInit).body))).toEqual({
      knowledge_base_id: knowledgeBaseId,
      name: "Release gate",
    });
    expect(report.results[0].retrieved_documents[0]).toMatchObject({
      future_payload: { ranker: "hybrid" },
    });
    expect(report.results[0].total_latency_ms).toBeUndefined();
    expect(compared.metrics[1].candidate).toBeUndefined();
  });

  it("creates cases through the real bulk endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse([evaluationCase(), { ...evaluationCase(), id: resultId }], { status: 201 }),
    );
    const api = createClient(fetchImpl);
    const payload = {
      cases: [
        {
          question: "What is the retention period?",
          reference_answer: "Seven years.",
          expected_document_ids: [documentId],
        },
        {
          question: "Decline an unsupported request",
          reference_answer: "I cannot answer from the available evidence.",
          should_refuse: true,
        },
      ],
    };

    await expect(api.createEvaluationCasesBulk(datasetId, payload)).resolves.toHaveLength(2);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      `http://api.test/api/v1/evaluations/datasets/${datasetId}/cases/bulk`,
    );
    expect(JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body))).toEqual(payload);
  });

  it("returns a typed passing gate result and omits default thresholds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(qualityGateReport(true), {
        headers: { "x-request-id": "req-gate-200" },
      }),
    );
    const api = createClient(fetchImpl);

    const result = await api.gateEvaluationRun(candidateRunId, {
      baseline_run_id: baselineRunId,
    });

    expect(result).toMatchObject({
      report: { passed: true },
      request_id: "req-gate-200",
      conflict: false,
    });
    expect(JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body))).toEqual({
      baseline_run_id: baselineRunId,
    });
  });

  it("parses a 409 Problem Details gate report as a typed business result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          detail: "request rejected",
          request_id: "req-gate-409",
          data: qualityGateReport(false),
        },
        { status: 409, headers: { "Content-Type": "application/problem+json" } },
      ),
    );
    const api = createClient(fetchImpl);

    await expect(
      api.gateEvaluationRun(candidateRunId, { baseline_run_id: baselineRunId }),
    ).resolves.toMatchObject({
      report: { passed: false },
      request_id: "req-gate-409",
      conflict: true,
    });
  });

  it("keeps 422 gate responses as ApiError even when data resembles a report", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          type: "urn:rag-study-helper:validation-error",
          title: "Unprocessable Entity",
          status: 422,
          detail: "request validation failed",
          request_id: "req-gate-422",
          data: qualityGateReport(false),
        },
        { status: 422, headers: { "Content-Type": "application/problem+json" } },
      ),
    );
    const api = createClient(fetchImpl);

    await expect(
      api.gateEvaluationRun(candidateRunId, { baseline_run_id: baselineRunId }),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
      requestId: "req-gate-422",
    } satisfies Partial<ApiError>);
  });

  it("recalculates a run through the real endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(evaluationRun()));
    const api = createClient(fetchImpl);

    await expect(api.recalculateEvaluationRun(candidateRunId)).resolves.toMatchObject({
      id: candidateRunId,
      status: "succeeded",
    });
    expect(fetchImpl.mock.calls[0][0]).toBe(
      `http://api.test/api/v1/evaluations/runs/${candidateRunId}/recalculate`,
    );
    expect((fetchImpl.mock.calls[0][1] as RequestInit).method).toBe("POST");
  });

  it("exports the backend quality gate defaults for advanced controls", () => {
    expect(DEFAULT_EVALUATION_QUALITY_GATE_THRESHOLDS).toEqual({
      max_metric_regressions: {
        retrieval_recall_at_k: 0,
        rerank_recall_at_k: 0,
        citation_recall: 0,
        key_point_group_coverage: 0.02,
        citation_key_point_support_rate: 0.02,
        citation_required_point_support_precision: 0.02,
        refusal_accuracy: 0,
      },
      minimum_candidate_metrics: {
        retrieval_recall_at_k: 0.95,
        rerank_recall_at_k: 0.9,
        refusal_accuracy: 0.95,
      },
      max_latency_increase_ratios: {
        average_first_token_ms: 0.25,
        average_total_latency_ms: 0.2,
      },
      require_zero_failed_cases: true,
    });
  });
});
