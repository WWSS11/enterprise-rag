import { expect, test, type Page, type Route } from "@playwright/test";
import {
  assertNoAccessTokenInLocalStorage,
  attachConsoleGuard,
  clearBrowserAuth,
  seedMockAuthenticatedSession,
} from "./helpers";

const knowledgeBaseId = "11111111-1111-4111-8111-111111111111";
const datasetId = "22222222-2222-4222-8222-222222222222";
const answerableCaseId = "33333333-3333-4333-8333-333333333333";
const refusalCaseId = "44444444-4444-4444-8444-444444444444";
const candidateRunId = "55555555-5555-4555-8555-555555555555";
const baselineRunId = "66666666-6666-4666-8666-666666666666";
const documentId = "77777777-7777-4777-8777-777777777777";
const answerableResultId = "88888888-8888-4888-8888-888888888888";
const refusalResultId = "99999999-9999-4999-8999-999999999999";
const timestamp = "2026-07-15T08:30:00+08:00";

const datasetName = "Release gate v1";
const datasetDescription = "Release-critical retention and refusal cases.";
const answerableQuestion = "What is the policy retention period?";
const answerableReference = "Policy records must be retained for seven years.";
const refusalQuestion = "What is the CEO's private phone number?";
const refusalReference = "Refuse because the available evidence does not contain private contact details.";

async function fulfillJson(
  route: Route,
  body: unknown,
  status = 200,
  contentType = "application/json",
  headers: Record<string, string> = {},
) {
  await route.fulfill({
    status,
    contentType,
    headers,
    body: JSON.stringify(body),
  });
}

async function expectNoHorizontalOverflow(page: Page, surface: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.html, `${surface}: documentElement must not overflow horizontally`).toBeLessThanOrEqual(1);
  expect(overflow.body, `${surface}: body must not overflow horizontally`).toBeLessThanOrEqual(1);
}

function knowledgeBase() {
  return {
    id: knowledgeBaseId,
    tenant_id: "default",
    slug: "policy",
    name: "Policy knowledge base",
    description: "Approved company policies",
    access_mode: "restricted",
    status: "active",
    is_default: true,
    created_by: "mock-e2e-user",
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function readyDocument() {
  return {
    id: documentId,
    tenant_id: "default",
    knowledge_base_id: knowledgeBaseId,
    name: "Retention policy.pdf",
    source_type: "upload",
    source_key: null,
    source_uri: "data/uploads/retention-policy.pdf",
    source_updated_at: null,
    content_type: "application/pdf",
    size_bytes: 2048,
    status: "ready",
    chunk_count: 3,
    index_version: "index-v1",
    indexed_at: timestamp,
    error_message: null,
    extra_metadata: { owner: "Legal" },
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function evaluationDataset() {
  return {
    id: datasetId,
    tenant_id: "default",
    knowledge_base_id: knowledgeBaseId,
    name: datasetName,
    description: datasetDescription,
    status: "active",
    created_by: "mock-e2e-user",
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function answerableCase() {
  return {
    id: answerableCaseId,
    dataset_id: datasetId,
    question: answerableQuestion,
    reference_answer: answerableReference,
    expected_document_ids: [documentId],
    acceptable_citation_document_ids: [documentId],
    required_key_points: ["seven years"],
    required_key_point_groups: [["seven years", "7 years"]],
    should_refuse: false,
    tags: ["retention", "policy"],
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function refusalCase() {
  return {
    id: refusalCaseId,
    dataset_id: datasetId,
    question: refusalQuestion,
    reference_answer: refusalReference,
    expected_document_ids: [],
    acceptable_citation_document_ids: [],
    required_key_points: [],
    required_key_point_groups: [],
    should_refuse: true,
    tags: [],
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function evaluationRun(
  id: string,
  status: "queued" | "running" | "succeeded",
) {
  const running = status === "running";
  const succeeded = status === "succeeded";
  return {
    id,
    tenant_id: "default",
    knowledge_base_id: knowledgeBaseId,
    dataset_id: datasetId,
    created_by: "mock-e2e-user",
    task_id: `task-${id.slice(0, 8)}`,
    status,
    progress: succeeded ? 100 : running ? 50 : 0,
    total_cases: 2,
    completed_cases: succeeded ? 2 : running ? 1 : 0,
    failed_cases: 0,
    config_snapshot: {
      retrieval: { top_k: id === baselineRunId ? 8 : 10 },
      rerank: { enabled: true },
    },
    summary: succeeded
      ? {
          retrieval_recall_at_k: 1,
          retrieval_mrr: 0.95,
          rerank_recall_at_k: 1,
          rerank_mrr: 0.95,
          citation_precision: null,
          citation_recall: 1,
          key_point_coverage: 1,
          key_point_group_coverage: 1,
          citation_grounded_key_point_coverage: 1,
          citation_key_point_support_rate: 1,
          citation_required_point_support_precision: 1,
          refusal_accuracy: 1,
          average_first_token_ms: 420,
          average_total_latency_ms: 980,
          succeeded_cases: 2,
          failed_cases: 0,
        }
      : {},
    started_at: status === "queued" ? null : timestamp,
    completed_at: succeeded ? timestamp : null,
    error_message: null,
    created_at: timestamp,
    updated_at: succeeded
      ? "2026-07-15T08:31:00+08:00"
      : running
        ? "2026-07-15T08:30:30+08:00"
        : timestamp,
  };
}

function comparison(candidateRecall = 1) {
  return {
    baseline_run_id: baselineRunId,
    candidate_run_id: candidateRunId,
    dataset_id: datasetId,
    metrics: [
      {
        metric: "retrieval_recall_at_k",
        baseline: 0.8,
        candidate: candidateRecall,
        delta: candidateRecall - 0.8,
        relative_delta: (candidateRecall - 0.8) / 0.8,
      },
      {
        metric: "average_total_latency_ms",
        baseline: 900,
        candidate: 980,
        delta: 80,
        relative_delta: 80 / 900,
      },
      {
        metric: "citation_recall",
        baseline: 1,
        candidate: 1,
        delta: 0,
        relative_delta: 0,
      },
      {
        metric: "citation_precision",
        baseline: null,
        candidate: null,
        delta: null,
        relative_delta: null,
      },
    ],
    config_differences: [
      {
        key: "retrieval",
        baseline: { top_k: 8 },
        candidate: { top_k: 10 },
      },
    ],
  };
}

function qualityGateReport(passed: boolean) {
  const candidateRecall = passed ? 1 : 0.7;
  return {
    passed,
    comparison: comparison(candidateRecall),
    checks: [
      {
        metric: "retrieval_recall_at_k",
        rule: "max_regression",
        threshold: 0,
        baseline: 0.8,
        candidate: candidateRecall,
        actual: Math.max(0, 0.8 - candidateRecall),
        passed,
        reason: passed
          ? "retrieval recall is within release tolerance"
          : "retrieval recall regressed below release threshold",
      },
      {
        metric: "citation_precision",
        rule: "minimum_candidate",
        threshold: 0.95,
        baseline: null,
        candidate: null,
        actual: null,
        passed,
        reason: passed
          ? "optional citation precision check accepted"
          : "citation precision is unavailable for the candidate",
      },
    ],
  };
}

function evaluationReport() {
  return {
    run: evaluationRun(candidateRunId, "succeeded"),
    dataset: evaluationDataset(),
    results: [
      {
        id: answerableResultId,
        run_id: candidateRunId,
        case_id: answerableCaseId,
        status: "succeeded",
        rewritten_query: "policy record retention period",
        answer: "Policy records must be retained for seven years. [来源:Retention policy.pdf#chunk-retention]",
        retrieved_documents: [
          {
            document_id: documentId,
            document_name: "Retention policy.pdf",
            chunk_id: "chunk-retention",
            score: 0.98,
            content_preview: "Policy records must be retained for seven years.",
          },
        ],
        reranked_documents: [
          {
            document_id: documentId,
            document_name: "Retention policy.pdf",
            chunk_id: "chunk-retention",
            rank: 1,
            score: 0.99,
          },
        ],
        citations: [
          {
            document_id: documentId,
            document_name: "Retention policy.pdf",
            chunk_id: "chunk-retention",
            chunk_ids: ["chunk-retention"],
            score: 0.99,
            content_preview: "Policy records must be retained for seven years.",
          },
        ],
        citation_evidence: [
          {
            document_id: documentId,
            document_name: "Retention policy.pdf",
            chunk_id: "chunk-retention",
            quote: "Policy records must be retained for seven years.",
            evidence_content: "Policy records must be retained for seven years.",
            offsets: [0, 54],
          },
        ],
        metrics: {
          retrieval_recall_at_k: 1,
          matched_key_points: ["seven years"],
          citation_key_point_support: { "seven years": ["chunk-retention"] },
          future_metric: null,
        },
        first_token_ms: 420,
        total_latency_ms: 980,
        error_message: null,
        created_at: timestamp,
        updated_at: timestamp,
        question: answerableQuestion,
        reference_answer: answerableReference,
        expected_document_ids: [documentId],
        acceptable_citation_document_ids: [documentId],
        required_key_points: ["seven years"],
        required_key_point_groups: [["seven years", "7 years"]],
        should_refuse: false,
        tags: ["retention", "policy"],
      },
      {
        id: refusalResultId,
        run_id: candidateRunId,
        case_id: refusalCaseId,
        status: "succeeded",
        rewritten_query: null,
        answer: "I cannot answer that from the available evidence.",
        retrieved_documents: [],
        reranked_documents: [],
        citations: [],
        citation_evidence: [],
        metrics: {
          expected_refusal: true,
          actual_refusal: true,
          refusal_correct: true,
        },
        first_token_ms: null,
        total_latency_ms: 250,
        error_message: null,
        created_at: timestamp,
        updated_at: timestamp,
        question: refusalQuestion,
        reference_answer: refusalReference,
        expected_document_ids: [],
        acceptable_citation_document_ids: [],
        required_key_points: [],
        required_key_point_groups: [],
        should_refuse: true,
        tags: [],
      },
    ],
  };
}

async function installRunSurfaceMocks(page: Page, gatePassed: boolean) {
  await page.route(`**/api/v1/evaluations/runs/${candidateRunId}`, (route) =>
    fulfillJson(route, evaluationRun(candidateRunId, "succeeded")),
  );
  await page.route(`**/api/v1/evaluations/runs/${baselineRunId}`, (route) =>
    fulfillJson(route, evaluationRun(baselineRunId, "succeeded")),
  );
  await page.route(`**/api/v1/evaluations/runs/${candidateRunId}/report`, (route) =>
    fulfillJson(route, evaluationReport()),
  );
  await page.route(`**/api/v1/evaluations/runs/${candidateRunId}/gate`, async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ baseline_run_id: baselineRunId });
    if (gatePassed) {
      await fulfillJson(
        route,
        qualityGateReport(true),
        200,
        "application/json",
        {
          "x-request-id": "req-e2e-gate-200",
          "access-control-expose-headers": "x-request-id",
        },
      );
      return;
    }
    await fulfillJson(
      route,
      {
        type: "about:blank",
        title: "Conflict",
        status: 409,
        detail: "candidate run failed the quality gate",
        request_id: "req-e2e-gate-409",
        data: qualityGateReport(false),
      },
      409,
      "application/problem+json",
      { "x-request-id": "req-e2e-gate-409" },
    );
  });
}

test.describe("Evaluation Console mocked API", () => {
  test.beforeEach(async ({ page }) => {
    await clearBrowserAuth(page);
    await page.route("**/api/v1/auth/me", (route) =>
      fulfillJson(route, {
        user_id: "mock-e2e-user",
        tenant_id: "default",
        roles: ["rag-user"],
        groups: ["engineering"],
        auth_method: "oidc",
        is_admin: false,
      }),
    );
    await page.route("**/health/*", (route) =>
      fulfillJson(route, {
        status: "ok",
        service: "enterprise-rag",
        version: "test",
        dependencies: {},
      }),
    );
    await page.route("**/api/v1/knowledge-bases", (route) =>
      fulfillJson(route, [knowledgeBase()]),
    );
    await seedMockAuthenticatedSession(page);
  });

  test("creates cases, runs queued to succeeded, reports, compares, gates, localizes, and fits 390px", async ({ page }) => {
    const guard = attachConsoleGuard(page);
    const datasets: ReturnType<typeof evaluationDataset>[] = [];
    const cases: Array<ReturnType<typeof answerableCase> | ReturnType<typeof refusalCase>> = [];
    const candidateRunGetStatuses: string[] = [];
    const modelApiRequests: string[] = [];
    let blockNextCaseRefresh = false;
    let releaseFirstCaseRefresh!: () => void;
    const firstCaseRefreshBlocked = new Promise<void>((resolve) => {
      releaseFirstCaseRefresh = resolve;
    });
    let markFirstCaseRefreshStarted!: () => void;
    const firstCaseRefreshStarted = new Promise<void>((resolve) => {
      markFirstCaseRefreshStarted = resolve;
    });
    const onRequest = (request: { url: () => string }) => {
      if (/\/api\/v1\/chat|anthropic|openai|generativelanguage/i.test(request.url())) {
        modelApiRequests.push(request.url());
      }
    };
    page.on("request", onRequest);

    try {
      await page.route("**/api/v1/evaluations/datasets", async (route) => {
        if (route.request().method() === "POST") {
          expect(route.request().headers().authorization).toBe("Bearer mock-access-token-for-e2e");
          expect(route.request().postDataJSON()).toEqual({
            knowledge_base_id: knowledgeBaseId,
            name: datasetName,
            description: datasetDescription,
          });
          const created = evaluationDataset();
          datasets.push(created);
          await fulfillJson(route, created, 201);
          return;
        }
        expect(route.request().method()).toBe("GET");
        await fulfillJson(route, datasets);
      });
      await page.route(`**/api/v1/evaluations/datasets/${datasetId}`, (route) =>
        fulfillJson(route, evaluationDataset()),
      );
      await page.route(`**/api/v1/evaluations/datasets/${datasetId}/cases**`, async (route) => {
        const url = new URL(route.request().url());
        const casePrefix = `/api/v1/evaluations/datasets/${datasetId}/cases/`;
        if (url.pathname.startsWith(casePrefix)) {
          const requestedCaseId = url.pathname.slice(casePrefix.length);
          const index = cases.findIndex((item) => item.id === requestedCaseId);
          expect(index).toBeGreaterThanOrEqual(0);
          if (route.request().method() === "PUT") {
            const updated = { ...cases[index], ...route.request().postDataJSON() };
            cases[index] = updated;
            await fulfillJson(route, updated);
            return;
          }
          expect(route.request().method()).toBe("DELETE");
          cases.splice(index, 1);
          await route.fulfill({ status: 204, body: "" });
          return;
        }
        if (route.request().method() === "POST") {
          expect(route.request().headers().authorization).toBe("Bearer mock-access-token-for-e2e");
          const body = route.request().postDataJSON();
          if (body.should_refuse) {
            expect(body).toEqual({
              question: refusalQuestion,
              reference_answer: refusalReference,
              expected_document_ids: [],
              acceptable_citation_document_ids: [],
              required_key_points: [],
              required_key_point_groups: [],
              should_refuse: true,
              tags: [],
            });
            const created = refusalCase();
            cases.push(created);
            await fulfillJson(route, created, 201);
            return;
          }
          expect(body).toEqual({
            question: answerableQuestion,
            reference_answer: answerableReference,
            expected_document_ids: [documentId],
            acceptable_citation_document_ids: [documentId],
            required_key_points: ["seven years"],
            required_key_point_groups: [["seven years", "7 years"]],
            should_refuse: false,
            tags: ["retention", "policy"],
          });
          const created = answerableCase();
          cases.push(created);
          blockNextCaseRefresh = true;
          await fulfillJson(route, created, 201);
          return;
        }
        expect(route.request().method()).toBe("GET");
        if (blockNextCaseRefresh) {
          blockNextCaseRefresh = false;
          markFirstCaseRefreshStarted();
          await firstCaseRefreshBlocked;
        }
        await fulfillJson(route, { items: [...cases].reverse(), total: cases.length, limit: 10, offset: 0 });
      });
      await page.route("**/api/v1/documents**", (route) =>
        fulfillJson(route, [readyDocument()]),
      );
      await page.route(/\/api\/v1\/evaluations\/runs(?:\?.*)?$/, async (route) => {
        if (route.request().method() === "GET") {
          await fulfillJson(route, {
            items: [evaluationRun(candidateRunId, "succeeded"), evaluationRun(baselineRunId, "succeeded")],
            total: 2,
            limit: 50,
            offset: 0,
          });
          return;
        }
        expect(route.request().method()).toBe("POST");
        expect(route.request().headers().authorization).toBe("Bearer mock-access-token-for-e2e");
        expect(route.request().postDataJSON()).toEqual({ dataset_id: datasetId });
        await fulfillJson(route, evaluationRun(candidateRunId, "queued"), 202);
      });
      await page.route(`**/api/v1/evaluations/runs/${candidateRunId}`, async (route) => {
        expect(route.request().method()).toBe("GET");
        const statuses = ["queued", "running", "succeeded"] as const;
        const status = statuses[Math.min(candidateRunGetStatuses.length, statuses.length - 1)];
        candidateRunGetStatuses.push(status);
        await fulfillJson(route, evaluationRun(candidateRunId, status));
      });
      await page.route(`**/api/v1/evaluations/runs/${baselineRunId}`, (route) =>
        fulfillJson(route, evaluationRun(baselineRunId, "succeeded")),
      );
      await page.route(`**/api/v1/evaluations/runs/${candidateRunId}/report`, (route) =>
        fulfillJson(route, evaluationReport()),
      );
      await page.route(`**/api/v1/evaluations/runs/${candidateRunId}/compare`, async (route) => {
        expect(route.request().method()).toBe("POST");
        expect(route.request().postDataJSON()).toEqual({ baseline_run_id: baselineRunId });
        await fulfillJson(route, comparison());
      });
      await page.route(`**/api/v1/evaluations/runs/${candidateRunId}/gate`, async (route) => {
        expect(route.request().method()).toBe("POST");
        expect(route.request().postDataJSON()).toEqual({ baseline_run_id: baselineRunId });
        await fulfillJson(
          route,
          qualityGateReport(true),
          200,
          "application/json",
          {
          "x-request-id": "req-e2e-gate-200",
          "access-control-expose-headers": "x-request-id",
        },
        );
      });

      await page.goto("/app/evaluations");
      await expect(page.getByRole("heading", { level: 1, name: /质量评测|Evaluations/ })).toBeVisible();
      await expectNoHorizontalOverflow(page, "evaluation home");

      await page.getByRole("link", { name: /创建数据集|Create dataset/ }).first().click();
      await expect(page).toHaveURL(/\/app\/evaluations\/new$/);
      await expectNoHorizontalOverflow(page, "create dataset");
      await page.setViewportSize({ width: 1280, height: 900 });

      await page.getByLabel(/知识库|Knowledge base/).selectOption(knowledgeBaseId);
      await page.getByLabel(/数据集名称|Dataset name/).fill(datasetName);
      await page.getByLabel(/描述（可选）|Description \(optional\)/).fill(datasetDescription);
      await page.getByRole("button", { name: "English" }).click();
      await expect(page).toHaveURL(/\/app\/evaluations\/new$/);
      await expect(page.getByLabel("Knowledge base")).toHaveValue(knowledgeBaseId);
      await expect(page.getByLabel("Dataset name")).toHaveValue(datasetName);
      await expect(page.getByLabel("Description (optional)")).toHaveValue(datasetDescription);

      await page.getByRole("button", { name: "Create and add cases" }).click();
      await expect(page).toHaveURL(new RegExp(`/app/evaluations/datasets/${datasetId}$`));
      await expect(page.getByText("Evaluation dataset created")).toBeVisible();
      await expectNoHorizontalOverflow(page, "dataset detail");
      await page.setViewportSize({ width: 1280, height: 1000 });

      await page.getByRole("button", { name: "Add case" }).click();
      await page.getByLabel("Question", { exact: true }).fill(answerableQuestion);
      await page.getByLabel("Reference answer", { exact: true }).fill(answerableReference);
      const expectedDocuments = page.getByRole("group", { name: "Expected retrieval documents" });
      const acceptableDocuments = page.getByRole("group", { name: "Acceptable citation documents" });
      await expectedDocuments.getByRole("checkbox", { name: /Retention policy\.pdf/ }).check();
      const autoIncludedCitation = acceptableDocuments.getByRole("checkbox", { name: /Retention policy\.pdf/ });
      await expect(autoIncludedCitation).toBeChecked();
      await expect(autoIncludedCitation).toBeDisabled();
      await page.getByLabel("Required key points").fill("seven years");
      await page.getByLabel("Key-point alias groups").fill("seven years | 7 years");
      await page.getByLabel("Tags").fill("retention\npolicy");
      const firstCaseCreated = page.waitForResponse((response) =>
        response.url().endsWith(`/api/v1/evaluations/datasets/${datasetId}/cases`) &&
        response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Save case" }).click();
      expect((await firstCaseCreated).status()).toBe(201);
      await firstCaseRefreshStarted;
      releaseFirstCaseRefresh();
      await expect(page.getByText(answerableQuestion)).toBeVisible();
      await page.getByRole("button", { name: "Add case" }).click();
      await page.getByLabel("Question", { exact: true }).fill(refusalQuestion);
      await page.getByLabel("Reference answer", { exact: true }).fill(refusalReference);
      await page.getByRole("radio", { name: /Should refuse/ }).check();
      await expect(page.getByRole("group", { name: "Expected retrieval documents" })).toHaveCount(0);
      await expect(page.getByLabel("Question", { exact: true })).toHaveValue(refusalQuestion);
      await expect(page.getByLabel("Reference answer", { exact: true })).toHaveValue(refusalReference);
      await expect(page.getByRole("radio", { name: /Should refuse/ })).toBeChecked();
      await page.getByRole("button", { name: "Save case" }).click();
      await expect(page.getByText(refusalQuestion)).toBeVisible();

      await page.setViewportSize({ width: 390, height: 844 });
      await expectNoHorizontalOverflow(page, "evaluation case table");
      await expect(page.getByRole("button", { name: answerableQuestion })).toBeVisible();
      await page.setViewportSize({ width: 1280, height: 1000 });

      const answerableRow = page.getByRole("row").filter({ hasText: answerableQuestion });
      await answerableRow.getByRole("button", { name: "Edit" }).click();
      await page.getByLabel("Reference answer", { exact: true }).fill(`${answerableReference} Confirmed.`);
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByRole("row").filter({ hasText: answerableQuestion })).toBeVisible();

      const refusalRow = page.getByRole("row").filter({ hasText: refusalQuestion });
      await refusalRow.getByRole("button", { name: "Delete" }).click();
      await refusalRow.getByRole("button", { name: "Delete case" }).click();
      await expect(page.getByRole("row").filter({ hasText: refusalQuestion })).toHaveCount(0);

      const startResponse = page.waitForResponse((response) =>
        response.url().endsWith("/api/v1/evaluations/runs") &&
        response.request().method() === "POST",
      );
      const startButton = page.getByRole("button", { name: "Start run" });
      await expect(startButton).toBeEnabled();
      await startButton.click();
      expect((await startResponse).status()).toBe(202);
      await expect(page).toHaveURL(new RegExp(`/app/evaluations/runs/${candidateRunId}$`));
      await expect(page.getByText("Queued", { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page, "queued run");
      await page.setViewportSize({ width: 1280, height: 1000 });

      await expect(page.getByText("Running", { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Processed 1 / 2; 0 failed", { exact: true })).toBeVisible();
      await expect(page.getByText("Succeeded", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
      expect(candidateRunGetStatuses.slice(0, 3)).toEqual(["queued", "running", "succeeded"]);

      const rememberedRun = await page.evaluate(
        ({ id }) => {
          const key = [
            "evidence-desk:evaluation-run-ids:v2",
            encodeURIComponent("default"),
            encodeURIComponent("mock-e2e-user"),
            encodeURIComponent(id),
          ].join(":");
          return {
            session: window.sessionStorage.getItem(key),
            local: window.localStorage.getItem(key),
          };
        },
        { id: datasetId },
      );
      expect(rememberedRun.session).toBeNull();
      expect(rememberedRun.local).toBeNull();

      await expect(page.getByRole("heading", { name: "Summary metrics" })).toBeVisible();
      const citationPrecisionMetric = page.getByText("Citation precision", { exact: true }).locator("..");
      await expect(citationPrecisionMetric.getByText("Unavailable", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: answerableQuestion })).toBeVisible();
      await expect(page.getByRole("heading", { name: refusalQuestion })).toBeVisible();
      const evidenceSection = page.getByRole("heading", { name: "Citation evidence" }).locator("..");
      await evidenceSection.getByText("chunk-retention", { exact: true }).click();
      await expect(evidenceSection.getByText(answerableReference, { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page, "evaluation report");
      await page.setViewportSize({ width: 1280, height: 1000 });

      await page.getByLabel("Baseline run UUID").fill(baselineRunId);
      await page.getByRole("button", { name: "Compare", exact: true }).click();
      await expect(page.getByRole("row", { name: /retrieval_recall_at_k.*Improvement/ })).toBeVisible();
      await expect(page.getByRole("row", { name: /average_total_latency_ms.*Regression/ })).toBeVisible();
      await expect(page.getByRole("row", { name: /citation_recall.*No change/ })).toBeVisible();
      await expect(page.getByRole("row", { name: /citation_precision.*Not comparable/ })).toBeVisible();

      await page.getByRole("button", { name: "Run quality gate", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Gate passed" })).toBeVisible();
      await expect(page.getByText("req-e2e-gate-200")).toBeVisible();
      await expect(page.getByText("retrieval recall is within release tolerance").first()).toBeVisible();
      await expectNoHorizontalOverflow(page, "quality gate result");

      expect(modelApiRequests, "The mocked deterministic evaluation flow must not call model APIs").toEqual([]);
      await assertNoAccessTokenInLocalStorage(page);
      guard.assertClean();
    } finally {
      page.off("request", onRequest);
      guard.dispose();
    }
  });

  test("renders a 409 Problem Details gate report as a failed business result", async ({ page }) => {
    const guard = attachConsoleGuard(page);
    try {
      await installRunSurfaceMocks(page, false);
      await page.goto(`/app/evaluations/runs/${candidateRunId}`);
      await expect(page.getByText(/已完成|Succeeded/, { exact: true }).first()).toBeVisible();

      await page.getByLabel(/基线运行 UUID|Baseline run UUID/).fill(baselineRunId);
      await page.getByRole("button", { name: /执行质量门禁|Run quality gate/, exact: true }).click();

      await expect(page.getByRole("heading", { name: /门禁未通过|Gate failed/ })).toBeVisible();
      await expect(page.getByText("req-e2e-gate-409")).toBeVisible();
      await expect(page.getByText(/完整展示|complete check details/)).toBeVisible();
      await expect(page.getByText("retrieval recall regressed below release threshold").first()).toBeVisible();
      await expect(page.getByText("retrieval_recall_at_k", { exact: true }).first()).toBeVisible();
      await expect(
        page.getByRole("row", { name: /retrieval_recall_at_k.*(回退|Regression)/ }).last(),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page, "failed quality gate result");
      await assertNoAccessTokenInLocalStorage(page);

      const unexpectedConsoleErrors = guard.errors.filter(
        (message) => !/Failed to load resource.*409|status of 409/i.test(message),
      );
      expect(unexpectedConsoleErrors).toEqual([]);
    } finally {
      guard.dispose();
    }
  });
});
