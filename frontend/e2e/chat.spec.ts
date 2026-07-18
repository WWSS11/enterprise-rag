import { test, expect } from "@playwright/test";
import {
  assertNoAccessTokenInLocalStorage,
  assertSessionStorageHasOidcUser,
  attachConsoleGuard,
  clearBrowserAuth,
  seedMockAuthenticatedSession,
} from "./helpers";

const kbId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";

const sse = [
  `event: metadata\ndata: {"conversation_id":"${conversationId}"}\n\n`,
  'event: stage\ndata: {"name":"rewrite_query","status":"completed"}\n\n',
  'event: stage\ndata: {"name":"retrieve","status":"completed"}\n\n',
  'event: stage\ndata: {"name":"rerank","status":"completed"}\n\n',
  'event: stage\ndata: {"name":"expand_context","status":"completed"}\n\n',
  'event: token\ndata: {"token":"根据制度，访问需要审批 "}\n\n',
  'event: token\ndata: {"token":"[来源:安全制度.md#chunk-7]"}\n\n',
  `event: metadata\ndata: ${JSON.stringify({
    conversation_id: conversationId,
    rewritten_query: "访问审批制度",
    citations: [
      {
        document_id: "doc-1",
        document_name: "安全制度.md",
        chunk_id: "chunk-7",
        score: 0.93,
        content_preview: "所有受限访问必须由知识库负责人审批。",
      },
    ],
    retrieved_count: 12,
    reranked_count: 4,
  })}\n\n`,
  'event: done\ndata: {"status":"completed"}\n\n',
].join("");

test.describe("Chat + Evidence Desk mocked SSE", () => {
  test.beforeEach(async ({ page }) => {
    await clearBrowserAuth(page);
    await page.route("**/api/v1/auth/me", async (route) => {
      await route.fulfill({
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
      });
    });
    await page.route("**/health/*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "ok",
          service: "enterprise-rag",
          version: "test",
          dependencies: {},
        }),
      });
    });
    await page.route("**/api/v1/knowledge-bases", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: kbId,
            tenant_id: "default",
            slug: "security",
            name: "安全知识库",
            description: "Security policy",
            access_mode: "restricted",
            status: "active",
            is_default: true,
            created_by: "user-1",
            created_at: "2026-07-14T00:00:00Z",
            updated_at: "2026-07-14T00:00:00Z",
          },
        ]),
      });
    });
    await page.route("**/api/v1/chat/stream", async (route) => {
      const request = route.request();
      const body = request.postDataJSON() as Record<string, unknown>;
      expect(body.question).toBe("访问需要什么审批？");
      expect(body.knowledge_base_id).toBe(kbId);
      expect(body).not.toHaveProperty("fake_metric");
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: { "Cache-Control": "no-cache" },
        body: sse,
      });
    });
    await page.route("**/api/v1/conversations**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: conversationId,
              knowledge_base_id: kbId,
              title: "访问需要什么审批？",
              status: "active",
              created_at: "2026-07-14T00:00:00Z",
              updated_at: "2026-07-14T00:00:00Z",
            },
          ],
          total: 1,
          limit: 50,
          offset: 0,
        }),
      }),
    );
    await seedMockAuthenticatedSession(page);
  });

  test("streams answer, stages, citations, localization, and mobile layout", async ({ page }) => {
    const guard = attachConsoleGuard(page);
    try {
      await page.goto("/app/chat");
      await expect(page.getByRole("heading", { name: "智能问答" })).toBeVisible();
      await expect(page.getByLabel("知识库")).toHaveValue(kbId);

      await page.getByLabel("问题").fill("访问需要什么审批？");
      await page.getByRole("button", { name: "发送问题" }).click();

      await expect(page.getByText("回答已完成")).toBeVisible();
      for (const stage of ["问题改写", "混合检索", "候选重排", "上下文扩展", "回答生成"]) {
        await expect(page.getByText(stage, { exact: true })).toBeVisible();
      }
      await expect(page.getByText(/根据制度，访问需要审批/)).toBeVisible();
      const answerCitation = page.getByRole("button", { name: "引用 1" });
      await expect(answerCitation).toBeVisible();
      await answerCitation.click();
      const evidenceCitation = page.getByRole("button", { name: "证据 1" });
      await expect(evidenceCitation).toBeVisible();
      await expect(page.getByText("所有受限访问必须由知识库负责人审批。")).toBeVisible();
      await evidenceCitation.click();
      await expect(answerCitation).toHaveAttribute("aria-pressed", "true");

      const storedConversation = await page.evaluate((id) =>
        window.sessionStorage.getItem(`evidence-desk:conversation-id:${id}`), kbId);
      expect(storedConversation).toBe(conversationId);
      await assertNoAccessTokenInLocalStorage(page);
      await assertSessionStorageHasOidcUser(page);

      await page.getByRole("button", { name: "English" }).click();
      await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible();
      await expect(page.getByText(/根据制度，访问需要审批/)).toBeVisible();
      expect(page.url()).toMatch(/\/app\/chat/);

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByRole("button", { name: /Open citation evidence/ })).toBeVisible();
      const overflow = await page.evaluate(() => ({
        html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth,
      }));
      expect(overflow.html).toBeLessThanOrEqual(1);
      expect(overflow.body).toBeLessThanOrEqual(1);

      const evidenceDialog = page.getByRole("dialog", { name: "Citation evidence" });
      if (!(await evidenceDialog.isVisible().catch(() => false))) {
        await page.getByRole("button", { name: /Open citation evidence/ }).click();
      }
      await expect(evidenceDialog).toBeVisible();

      guard.assertClean();
    } finally {
      guard.dispose();
    }
  });
});
