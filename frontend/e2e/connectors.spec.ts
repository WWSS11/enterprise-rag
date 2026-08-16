import { expect, test, type Route } from "@playwright/test";
import {
  assertNoAccessTokenInLocalStorage,
  attachConsoleGuard,
  clearBrowserAuth,
  seedMockAuthenticatedSession,
} from "./helpers";

const knowledgeBaseId = "11111111-1111-4111-8111-111111111111";
const jobId = "33333333-3333-4333-8333-333333333333";
const timestamp = "2026-08-08T08:00:00Z";

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function syncJob(status: "queued" | "succeeded") {
  return {
    id: jobId,
    knowledge_base_id: knowledgeBaseId,
    document_id: null,
    retry_of_job_id: null,
    task_id: "task-feishu-sync",
    job_type: "feishu_sync",
    status,
    progress: status === "succeeded" ? 100 : 0,
    result: status === "succeeded"
      ? {
          trigger: "manual",
          remote: 16,
          enqueued: 4,
          unchanged: 12,
          busy: 0,
          deleted: 0,
          unsupported: 1,
          ingestion_jobs: 4,
          deletion_jobs: 0,
        }
      : { trigger: "manual" },
    error_message: null,
    cancelled_at: null,
    cancelled_by: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

test("administrator diagnoses Feishu and completes a persisted manual sync", async ({ page }) => {
  const guard = attachConsoleGuard(page);
  let started = false;
  let jobReads = 0;

  await clearBrowserAuth(page);
  await page.route("**/api/v1/auth/me", (route) =>
    fulfillJson(route, {
      user_id: "mock-e2e-admin",
      tenant_id: "default",
      roles: ["rag-admin"],
      groups: [],
      auth_method: "oidc",
      is_admin: true,
    }),
  );
  await page.route("**/health/*", (route) =>
    fulfillJson(route, { status: "ok", service: "rag-api", version: "test", dependencies: {} }),
  );
  await page.route("**/api/v1/connectors/feishu/diagnose", async (route) => {
    expect(route.request().method()).toBe("POST");
    await fulfillJson(route, {
      provider: "feishu",
      status: "passed",
      checked_at: timestamp,
      checks: [
        { key: "credentials", status: "passed", message: "credentials accepted", error_code: null, log_id: null, details: {} },
        { key: "connectivity", status: "passed", message: "Wiki space is readable", error_code: null, log_id: "trace-e03-safe", details: { operation: "wiki.nodes.list", retryable: false } },
      ],
    });
  });
  await page.route("**/api/v1/connectors/feishu/sync", async (route) => {
    expect(route.request().method()).toBe("POST");
    started = true;
    await fulfillJson(route, syncJob("queued"), 202);
  });
  await page.route("**/api/v1/connectors/feishu", (route) =>
    fulfillJson(route, {
      provider: "feishu",
      enabled: true,
      ready: true,
      tenant_id: "default",
      space_id: "wiki-space-e03",
      run_as_user: "connector-bot",
      app_id_configured: true,
      app_secret_configured: true,
      knowledge_base_id: knowledgeBaseId,
      knowledge_base_name: "飞书业务知识库",
      checks: [
        { key: "enabled", status: "passed", message: "enabled", error_code: null, log_id: null, details: {} },
        { key: "credentials", status: "passed", message: "configured", error_code: null, log_id: null, details: {} },
        { key: "space", status: "passed", message: "configured", error_code: null, log_id: null, details: {} },
        { key: "knowledge_base", status: "passed", message: "writable", error_code: null, log_id: null, details: {} },
      ],
      active_job: null,
      latest_job: started ? syncJob("succeeded") : null,
    }),
  );
  await page.route(`**/api/v1/jobs/${jobId}`, async (route) => {
    jobReads += 1;
    await fulfillJson(route, syncJob("succeeded"));
  });
  await page.route(/\/api\/v1\/jobs\?job_type=feishu_sync.*/, (route) =>
    fulfillJson(route, {
      items: started ? [syncJob("succeeded")] : [],
      total: started ? 1 : 0,
      limit: 10,
      offset: 0,
    }),
  );

  await seedMockAuthenticatedSession(page);
  await page.goto("/app/connectors/feishu");

  await expect(page.getByRole("heading", { name: "飞书连接器" })).toBeVisible();
  await expect(page.getByText("配置就绪")).toBeVisible();
  await expect(page.getByText("App Secret")).toBeVisible();
  await expect(page.getByText("已配置")).toHaveCount(2);
  await expect(page.getByText(/mock-secret|app-secret-value/i)).toHaveCount(0);

  await page.getByRole("button", { name: "运行配置诊断" }).click();
  await expect(page.getByText("诊断通过，应用凭据有效且 Wiki 空间可读取。")).toBeVisible();
  await expect(page.getByText("trace-e03-safe")).toBeVisible();

  await page.getByRole("button", { name: "立即同步" }).click();
  await expect.poll(() => jobReads).toBeGreaterThan(0);
  await expect(page.getByText("远端文档")).toBeVisible();
  await expect(page.getByText("16", { exact: true })).toBeVisible();
  await expect(page.getByText("入库子任务")).toBeVisible();

  await assertNoAccessTokenInLocalStorage(page);
  guard.assertClean();
});
