import { expect, test, type Page } from "@playwright/test";
import {
  assertNoAccessTokenInLocalStorage,
  attachConsoleGuard,
  clearBrowserAuth,
  seedMockAuthenticatedSession,
} from "./helpers";

const existingKbId = "11111111-1111-4111-8111-111111111111";
const createdKbId = "22222222-2222-4222-8222-222222222222";
const documentId = "33333333-3333-4333-8333-333333333333";
const jobId = "44444444-4444-4444-8444-444444444444";
const scanJobId = "55555555-5555-4555-8555-555555555555";
const reindexJobId = "66666666-6666-4666-8666-666666666666";
const deleteJobId = "77777777-7777-4777-8777-777777777777";

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.html).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
}

function knowledgeBase(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenant_id: "default",
    slug: "security",
    name: "安全知识库",
    description: "Security policy",
    access_mode: "restricted",
    status: "active",
    is_default: id === existingKbId,
    created_by: "owner-1",
    created_at: "2026-07-15T00:00:00Z",
    updated_at: "2026-07-15T00:00:00Z",
    ...overrides,
  };
}

function document(status = "queued") {
  return {
    id: documentId,
    tenant_id: "default",
    knowledge_base_id: createdKbId,
    name: "policy.pdf",
    source_type: "upload",
    source_key: null,
    source_uri: "data/uploads/policy.pdf",
    source_updated_at: null,
    content_type: "application/pdf",
    size_bytes: 1024,
    status,
    chunk_count: status === "ready" ? 4 : 0,
    index_version: status === "ready" ? "index-v1" : null,
    indexed_at: status === "ready" ? "2026-07-15T00:00:05Z" : null,
    error_message: null,
    extra_metadata: {},
    created_at: "2026-07-15T00:00:00Z",
    updated_at: "2026-07-15T00:00:05Z",
  };
}

function job(
  status = "succeeded",
  overrides: Record<string, unknown> = {},
) {
  return {
    id: jobId,
    document_id: documentId,
    task_id: "task-upload-1",
    job_type: "document_ingestion",
    status,
    progress: status === "succeeded" ? 100 : 20,
    result: status === "succeeded" ? { document_id: documentId, chunk_count: 4 } : {},
    error_message: null,
    created_at: "2026-07-15T00:00:00Z",
    updated_at: "2026-07-15T00:00:05Z",
    ...overrides,
  };
}

test.describe("Knowledge Base Ops mocked API", () => {
  test.beforeEach(async ({ page }) => {
    await clearBrowserAuth(page);
    await page.route("**/api/v1/auth/me", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user_id: "mock-e2e-user",
          tenant_id: "default",
          roles: ["rag-user"],
          groups: ["engineering"],
          auth_method: "oidc",
          is_admin: false,
        }),
      }),
    );
    await page.route("**/health/*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ok", service: "rag-api", version: "test", dependencies: {} }),
      }),
    );
    await seedMockAuthenticatedSession(page);
  });

  test("creates a base, deep-links Chat, uploads a document, tracks its job, and fits 390px", async ({ page }) => {
    const guard = attachConsoleGuard(page);
    const bases = [knowledgeBase(existingKbId)];
    let uploaded = false;
    try {
      await page.route("**/api/v1/knowledge-bases", async (route) => {
        if (route.request().method() === "POST") {
          const payload = route.request().postDataJSON() as Record<string, unknown>;
          expect(payload).toEqual({
            slug: "policy",
            name: "政策知识库",
            description: "公司政策",
            access_mode: "restricted",
          });
          const created = knowledgeBase(createdKbId, {
            slug: "policy",
            name: "政策知识库",
            description: "公司政策",
            is_default: false,
            created_by: "mock-e2e-user",
          });
          bases.push(created);
          await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(created) });
          return;
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(bases) });
      });
      await page.route("**/api/v1/documents**", async (route) => {
        if (route.request().method() === "POST") {
          const multipart = route.request().postDataBuffer()?.toString("utf8") ?? "";
          expect(multipart).toContain('filename="policy.pdf"');
          expect(multipart).toContain("knowledge_base_id");
          expect(multipart).toContain(createdKbId);
          expect(route.request().headers().authorization).toBe("Bearer mock-access-token-for-e2e");
          uploaded = true;
          await route.fulfill({
            status: 202,
            contentType: "application/json",
            body: JSON.stringify({ document: document("queued"), job_id: jobId, task_id: "task-upload-1" }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(uploaded ? [document("ready")] : []),
        });
      });
      await page.route(`**/api/v1/jobs/${jobId}`, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(job()) }),
      );
      await page.route(/\/api\/v1\/jobs(?:\?.*)?$/, (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: [job("succeeded")], total: 1, limit: 50, offset: 0 }),
        }),
      );
      await page.route("**/api/v1/conversations**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: [], total: 0, limit: 50, offset: 0 }),
        }),
      );
      await page.route(`**/api/v1/knowledge-bases/${createdKbId}/permissions/me`, (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            knowledge_base_id: createdKbId,
            permission: "owner",
            source: "creator",
          }),
        }),
      );
      await page.route(`**/api/v1/knowledge-bases/${createdKbId}/members`, async (route) => {
        if (route.request().method() === "GET") {
          await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
          return;
        }
        expect(route.request().method()).toBe("PUT");
        expect(route.request().postDataJSON()).toEqual({
          principal_type: "group",
          principal_id: "engineering",
          permission: "editor",
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "88888888-8888-4888-8888-888888888888",
            knowledge_base_id: createdKbId,
            principal_type: "group",
            principal_id: "engineering",
            permission: "editor",
            created_at: "2026-07-15T00:00:00Z",
            updated_at: "2026-07-15T00:00:00Z",
          }),
        });
      });
      await page.route("**/api/v1/documents/scan", async (route) => {
        expect(route.request().method()).toBe("POST");
        expect(route.request().postDataJSON()).toEqual({
          root_alias: "default",
          knowledge_base_id: createdKbId,
        });
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify(
            job("succeeded", {
              id: scanJobId,
              document_id: null,
              job_type: "local_document_scan",
            }),
          ),
        });
      });
      await page.route(`**/api/v1/documents/${documentId}/reindex`, async (route) => {
        expect(route.request().method()).toBe("POST");
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify(
            job("succeeded", { id: reindexJobId, job_type: "document_reindex" }),
          ),
        });
      });
      await page.route(`**/api/v1/documents/${documentId}`, async (route) => {
        expect(route.request().method()).toBe("DELETE");
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify(
            job("succeeded", { id: deleteJobId, job_type: "document_deletion" }),
          ),
        });
      });
      for (const [id, type] of [
        [scanJobId, "local_document_scan"],
        [reindexJobId, "document_reindex"],
        [deleteJobId, "document_deletion"],
      ] as const) {
        await page.route(`**/api/v1/jobs/${id}`, (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(
              job("succeeded", {
                id,
                document_id: type === "local_document_scan" ? null : documentId,
                job_type: type,
              }),
            ),
          }),
        );
      }

      await page.goto("/app/knowledge-bases");
      await expect(
        page.getByRole("heading", { level: 1, name: "知识库", exact: true }),
      ).toBeVisible();
      await expect(page.getByText("安全知识库")).toBeVisible();
      await page.getByRole("link", { name: "创建知识库" }).click();
      await expect(page).toHaveURL(/knowledge-bases\/new/);
      await page.setViewportSize({ width: 390, height: 844 });
      await expectNoHorizontalOverflow(page);
      await page.setViewportSize({ width: 1280, height: 720 });

      await page.getByLabel("Slug").fill("policy");
      await page.getByLabel("名称").fill("政策知识库");
      await page.getByLabel("描述（可选）").fill("公司政策");
      await page.getByRole("button", { name: "English" }).click();
      await expect(page.getByLabel("Name")).toHaveValue("政策知识库");
      await expect(page).toHaveURL(/knowledge-bases\/new/);
      await page.getByRole("button", { name: "中文" }).click();
      await page.getByRole("button", { name: "创建并进入详情" }).click();

      await expect(page).toHaveURL(new RegExp(`/knowledge-bases/${createdKbId}$`));
      await expect(page.getByText("知识库已创建")).toBeVisible();
      await expect(page.getByRole("heading", { name: "上传文档" })).toBeVisible();

      await page.getByLabel("主体类型").selectOption("group");
      await page.getByLabel("主体标识").fill("engineering");
      await page.getByLabel("权限").selectOption("editor");
      await page.getByRole("button", { name: "保存授权" }).click();
      await expect(page.getByText("已将 engineering 的权限设置为 editor。")).toBeVisible();

      await page.getByRole("button", { name: "开始目录扫描" }).click();
      await expect(page.getByRole("heading", { name: "本地目录扫描" })).toBeVisible();

      await page.getByRole("link", { name: "在问答中使用" }).click();
      await expect(page).toHaveURL(new RegExp(`/app/chat\\?knowledge_base_id=${createdKbId}`));
      await expect(page.getByRole("heading", { level: 1, name: "智能问答" })).toBeVisible();
      await expect(page.getByRole("combobox", { name: "知识库" })).toHaveValue(createdKbId);
      await page.goBack();

      await page.getByLabel("选择文件").setInputFiles({
        name: "policy.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("policy"),
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await expectNoHorizontalOverflow(page);
      await page.getByRole("button", { name: "上传并创建入库任务" }).click();
      await expect(page.getByText("文件已接收，真实入库任务已创建。")).toBeVisible();
      await expect(page.getByLabel("文档入库").getByText("已完成")).toBeVisible();

      await page.getByRole("button", { name: "重新入库" }).click();
      await expect(page.getByRole("heading", { name: "文档重新入库" })).toBeVisible();

      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "删除文档" }).click();
      await expect(page.getByRole("heading", { name: "文档删除" })).toBeVisible();

      await page.goto("/app/jobs");
      await expect(page.getByText(jobId)).toBeVisible();
      await expect(page.getByLabel("文档入库").getByText("已完成")).toBeVisible();

      await page.setViewportSize({ width: 390, height: 844 });
      await expectNoHorizontalOverflow(page);
      await assertNoAccessTokenInLocalStorage(page);
      guard.assertClean();
    } finally {
      guard.dispose();
    }
  });

  test("shows RFC7807 request_id when creation conflicts", async ({ page }) => {
    await page.route("**/api/v1/knowledge-bases", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 409,
          contentType: "application/problem+json",
          headers: { "x-request-id": "req-e2e-kb-409" },
          body: JSON.stringify({
            type: "about:blank",
            title: "Conflict",
            status: 409,
            detail: "knowledge-base slug already exists",
            request_id: "req-e2e-kb-409",
          }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });

    await page.goto("/app/knowledge-bases/new");
    await page.getByLabel("Slug").fill("policy");
    await page.getByLabel("名称").fill("政策知识库");
    await page.getByRole("button", { name: "创建并进入详情" }).click();

    await expect(page.getByRole("heading", { name: "请求冲突" })).toBeVisible();
    await expect(page.getByText("req-e2e-kb-409")).toBeVisible();
    await page.getByRole("button", { name: "技术详情" }).click();
    await expect(page.getByText("knowledge-base slug already exists")).toBeVisible();
  });
});
