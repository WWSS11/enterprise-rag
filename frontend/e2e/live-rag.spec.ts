import { expect, test, type Page } from "@playwright/test";
import {
  accessTokenFromSessionStorage,
  apiBaseUrl,
  assertNoAccessTokenInLocalStorage,
  attachConsoleGuard,
  clearBrowserAuth,
  loginThroughKeycloak,
} from "./helpers";

type JobResponse = {
  id: string;
  status: string;
};

async function waitForTerminalJob(page: Page, token: string, jobId: string): Promise<string> {
  let status = "unknown";
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${apiBaseUrl()}/api/v1/jobs/${jobId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok()) return `http-${response.status()}`;
        status = ((await response.json()) as JobResponse).status;
        return status;
      },
      { timeout: 90_000, intervals: [500, 1_000, 2_500] },
    )
    .toMatch(/^(succeeded|failed)$/);
  return status;
}

async function cleanupLiveFixture(
  page: Page,
  knowledgeBaseId: string | null,
  documentId: string | null,
  pendingJobId: string | null,
): Promise<void> {
  if (!knowledgeBaseId) return;
  if (!new URL(page.url()).pathname.startsWith("/app/")) {
    await page.goto(`/app/knowledge-bases/${knowledgeBaseId}`).catch(() => undefined);
  }
  const token = await accessTokenFromSessionStorage(page).catch(() => null);
  if (!token) return;

  if (pendingJobId) {
    await waitForTerminalJob(page, token, pendingJobId).catch(() => undefined);
  }
  if (documentId) {
    const deletion = await page.request.delete(
      `${apiBaseUrl()}/api/v1/documents/${documentId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (deletion.status() === 202) {
      const job = (await deletion.json()) as JobResponse;
      await waitForTerminalJob(page, token, job.id).catch(() => undefined);
    }
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const archive = await page.request.post(
      `${apiBaseUrl()}/api/v1/knowledge-bases/${knowledgeBaseId}/archive`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (archive.ok() || archive.status() === 404) return;
    if (archive.status() !== 409) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

test.describe("live RAG backend", () => {
  test("covers permissions, RAG, document lifecycle, and archival", async ({ page }) => {
    test.setTimeout(180_000);
    const guard = attachConsoleGuard(page);
    const stamp = Date.now();
    const slug = `e2e-live-${stamp}`;
    const name = `E2E 实时验证 ${stamp}`;
    const filename = `e2e-live-${stamp}.md`;
    const readerGroup = `e2e-live-readers-${stamp}`;
    const factOwner = `星河委员会-${stamp}`;
    const factDuration = "37个月";
    let knowledgeBaseId: string | null = null;
    let documentId: string | null = null;
    let pendingJobId: string | null = null;
    let fixtureArchived = false;

    try {
      await clearBrowserAuth(page);
      await loginThroughKeycloak(page, "/app/knowledge-bases");
      await page.goto("/app/knowledge-bases");
      await expect(
        page.getByRole("heading", { level: 1, name: "知识库", exact: true }),
      ).toBeVisible();

      await page.getByRole("link", { name: "创建知识库" }).click();
      await page.getByLabel("Slug").fill(slug);
      await page.getByLabel("名称").fill(name);
      await page.getByLabel("描述（可选）").fill("由真实浏览器 E2E 创建的隔离测试数据");

      const createResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/knowledge-bases") &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "创建并进入详情" }).click();
      const created = await createResponse;
      expect(created.status()).toBe(201);
      knowledgeBaseId = ((await created.json()) as { id: string }).id;
      await expect(page.getByText("知识库已创建")).toBeVisible();
      await expect(page.getByRole("heading", { name: "上传文档" })).toBeVisible();

      const grantToken = await accessTokenFromSessionStorage(page);
      expect(grantToken).not.toBeNull();
      const grantResponse = await page.request.put(
        `${apiBaseUrl()}/api/v1/knowledge-bases/${knowledgeBaseId}/members`,
        {
          headers: { Authorization: `Bearer ${grantToken}` },
          data: {
            principal_type: "group",
            principal_id: readerGroup,
            permission: "reader",
          },
        },
      );
      expect(grantResponse.status()).toBe(200);
      await page.reload();
      const memberItem = page.getByRole("listitem").filter({ hasText: readerGroup });
      await expect(memberItem).toContainText("reader");

      await page.getByLabel("选择文件").setInputFiles({
        name: filename,
        mimeType: "text/markdown",
        buffer: Buffer.from(
          [
            "# 蓝晶协议审批规则",
            "",
            `蓝晶协议的唯一审批负责人是${factOwner}。`,
            `蓝晶协议批准后的资料保留期限是${factDuration}。`,
            "本文件仅用于 Enterprise RAG 端到端验证。",
          ].join("\n"),
          "utf8",
        ),
      });

      const uploadResponse = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/documents") &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "上传并创建入库任务" }).click();
      const uploaded = await uploadResponse;
      expect(uploaded.status()).toBe(202);
      const upload = (await uploaded.json()) as {
        document: { id: string };
        job_id: string;
      };
      documentId = upload.document.id;
      pendingJobId = upload.job_id;
      await expect(page.getByText("文件已接收，真实入库任务已创建。")).toBeVisible();
      await expect(page.getByLabel("文档入库").getByText("已完成")).toBeVisible({
        timeout: 90_000,
      });

      const documentItem = page.getByRole("listitem").filter({ hasText: filename });
      await expect(documentItem).toContainText("已完成", { timeout: 20_000 });

      await page.getByRole("link", { name: "在问答中使用" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "智能问答" })).toBeVisible();
      await expect(page.getByLabel("知识库").locator("option:checked")).toHaveText(name);

      await page
        .getByLabel("问题")
        .fill(`蓝晶协议的审批负责人是谁，批准后的资料需要保留多久？请依据知识库回答。`);
      const chatResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/chat/stream") &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "发送问题" }).click();
      expect((await chatResponse).status()).toBe(200);
      await expect(page.getByText("回答已完成")).toBeVisible({ timeout: 90_000 });
      await expect(page.getByText(new RegExp(factOwner)).first()).toBeVisible();
      await expect(page.getByText(new RegExp(factDuration)).first()).toBeVisible();

      const citation = page.getByRole("button", { name: "证据 1" });
      await expect(citation).toBeVisible();
      await citation.click();
      await expect(page.getByText(filename).first()).toBeVisible();
      await expect(page.getByText(new RegExp(factOwner)).last()).toBeVisible();

      await page.goto(`/app/knowledge-bases/${knowledgeBaseId}`);
      const reindexResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/documents/${documentId}/reindex`) &&
          response.request().method() === "POST",
      );
      await documentItem.getByRole("button", { name: "重新入库" }).click();
      const reindexed = await reindexResponse;
      expect(reindexed.status()).toBe(202);
      pendingJobId = ((await reindexed.json()) as JobResponse).id;
      const reindexJob = documentItem.getByLabel("文档重新入库");
      await expect(reindexJob.getByRole("heading", { name: "文档重新入库" })).toBeVisible();
      await expect(reindexJob.getByText("已完成", { exact: true })).toBeVisible({
        timeout: 90_000,
      });

      page.once("dialog", (dialog) => dialog.accept());
      const deleteResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/documents/${documentId}`) &&
          response.request().method() === "DELETE",
      );
      await documentItem.getByRole("button", { name: "删除文档" }).click();
      const deleted = await deleteResponse;
      expect(deleted.status()).toBe(202);
      pendingJobId = ((await deleted.json()) as JobResponse).id;
      const token = await accessTokenFromSessionStorage(page);
      expect(token).not.toBeNull();
      expect(await waitForTerminalJob(page, token!, pendingJobId)).toBe("succeeded");
      await expect(documentItem).toHaveCount(0, { timeout: 20_000 });
      documentId = null;
      pendingJobId = null;

      page.once("dialog", (dialog) => dialog.accept());
      const revokeResponse = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/knowledge-bases/${knowledgeBaseId}/members/`) &&
          response.request().method() === "DELETE",
      );
      await memberItem.getByRole("button", { name: "撤销授权" }).click();
      expect((await revokeResponse).status()).toBe(204);
      await expect(memberItem).toHaveCount(0);

      page.once("dialog", (dialog) => dialog.accept());
      const archiveResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/knowledge-bases/${knowledgeBaseId}/archive`) &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "归档知识库" }).click();
      expect((await archiveResponse).status()).toBe(200);
      await expect(page.getByText("已归档", { exact: true })).toBeVisible();
      fixtureArchived = true;

      await assertNoAccessTokenInLocalStorage(page);
      guard.assertClean();
    } finally {
      if (!fixtureArchived) {
        await cleanupLiveFixture(page, knowledgeBaseId, documentId, pendingJobId).catch(
          () => undefined,
        );
      }
      guard.dispose();
    }
  });
});
