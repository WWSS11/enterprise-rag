import { expect, test, type Route } from "@playwright/test";
import {
  assertNoAccessTokenInLocalStorage,
  attachConsoleGuard,
  clearBrowserAuth,
  seedMockAuthenticatedSession,
} from "./helpers";

const knowledgeBaseId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";
const retryJobId = "44444444-4444-4444-8444-444444444444";
const datasetId = "55555555-5555-4555-8555-555555555555";
const runId = "66666666-6666-4666-8666-666666666666";
const retryRunId = "77777777-7777-4777-8777-777777777777";
const timestamp = "2026-08-08T08:00:00Z";

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function knowledgeBase() {
  return {
    id: knowledgeBaseId,
    tenant_id: "default",
    slug: "e01-controls",
    name: "E01 controls",
    description: "Task control fixture",
    access_mode: "restricted",
    status: "active",
    is_default: false,
    created_by: "mock-e2e-user",
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function job(status: "queued" | "cancelled", overrides: Record<string, unknown> = {}) {
  return {
    id: jobId,
    knowledge_base_id: knowledgeBaseId,
    document_id: documentId,
    retry_of_job_id: null,
    task_id: "task-e01-job",
    job_type: "document_reindex",
    status,
    progress: 0,
    result: {},
    error_message: null,
    cancelled_at: status === "cancelled" ? timestamp : null,
    cancelled_by: status === "cancelled" ? "mock-e2e-user" : null,
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

function run(
  id: string,
  status: "queued" | "cancelled",
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    tenant_id: "default",
    knowledge_base_id: knowledgeBaseId,
    dataset_id: datasetId,
    retry_of_run_id: null,
    created_by: "mock-e2e-user",
    task_id: `task-${id}`,
    status,
    progress: 0,
    total_cases: 2,
    completed_cases: 0,
    failed_cases: 0,
    config_snapshot: { retrieval_top_k: 10 },
    summary: {},
    started_at: null,
    completed_at: status === "cancelled" ? timestamp : null,
    error_message: null,
    cancelled_at: status === "cancelled" ? timestamp : null,
    cancelled_by: status === "cancelled" ? "mock-e2e-user" : null,
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

test("cancels and retries persisted jobs and evaluation runs", async ({ page }) => {
  const guard = attachConsoleGuard(page);
  let jobState = job("queued");
  let runState = run(runId, "queued");

  await clearBrowserAuth(page);
  await page.route("**/api/v1/auth/me", (route) =>
    fulfillJson(route, {
      user_id: "mock-e2e-user",
      tenant_id: "default",
      roles: ["rag-user"],
      groups: [],
      auth_method: "oidc",
      is_admin: false,
    }),
  );
  await page.route("**/health/*", (route) =>
    fulfillJson(route, {
      status: "ok",
      service: "rag-api",
      version: "test",
      dependencies: {},
    }),
  );
  await page.route(/\/api\/v1\/knowledge-bases(?:\?.*)?$/, (route) =>
    fulfillJson(route, [knowledgeBase()]),
  );
  await page.route(/\/api\/v1\/jobs(?:\?.*)?$/, (route) =>
    fulfillJson(route, { items: [jobState], total: 1, limit: 10, offset: 0 }),
  );
  await page.route(`**/api/v1/jobs/${jobId}`, (route) => fulfillJson(route, jobState));
  await page.route(`**/api/v1/jobs/${jobId}/cancel`, async (route) => {
    expect(route.request().method()).toBe("POST");
    jobState = job("cancelled");
    await fulfillJson(route, jobState);
  });
  await page.route(`**/api/v1/jobs/${jobId}/retry`, async (route) => {
    expect(route.request().method()).toBe("POST");
    await fulfillJson(
      route,
      job("queued", {
        id: retryJobId,
        retry_of_job_id: jobId,
        task_id: "task-e01-job-retry",
      }),
      202,
    );
  });

  await page.route(`**/api/v1/evaluations/runs/${runId}`, (route) =>
    fulfillJson(route, runState),
  );
  await page.route(`**/api/v1/evaluations/runs/${runId}/cancel`, async (route) => {
    expect(route.request().method()).toBe("POST");
    runState = run(runId, "cancelled");
    await fulfillJson(route, runState);
  });
  await page.route(`**/api/v1/evaluations/runs/${runId}/retry`, async (route) => {
    expect(route.request().method()).toBe("POST");
    await fulfillJson(
      route,
      run(retryRunId, "queued", { retry_of_run_id: runId }),
      202,
    );
  });
  await page.route(`**/api/v1/evaluations/runs/${retryRunId}`, (route) =>
    fulfillJson(route, run(retryRunId, "queued", { retry_of_run_id: runId })),
  );

  await seedMockAuthenticatedSession(page);
  await page.goto("/app/jobs");
  await page.getByRole("button", { name: "取消排队任务" }).click();
  await expect(page.getByRole("article").getByText("已取消", { exact: true })).toBeVisible();
  await expect(page.getByText("操作者：mock-e2e-user")).toBeVisible();
  await page.getByRole("button", { name: "重试任务" }).click();
  await expect(page.getByText(`已创建重试任务 ${retryJobId}。`)).toBeVisible();

  await page.goto(`/app/evaluations/runs/${runId}`);
  await page.getByRole("button", { name: "取消排队运行" }).click();
  await expect(page.getByText("已取消", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重试运行" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/evaluations/runs/${retryRunId}$`));
  await expect(page.getByText(runId, { exact: true })).toBeVisible();

  await assertNoAccessTokenInLocalStorage(page);
  guard.assertClean();
});
