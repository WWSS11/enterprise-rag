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
const citedDocumentId = "33333333-3333-4333-8333-333333333333";
const citedChunkId = "44444444-4444-4444-8444-444444444444";

const sse = [
  `event: metadata\ndata: {"conversation_id":"${conversationId}"}\n\n`,
  'event: stage\ndata: {"name":"rewrite_query","status":"completed"}\n\n',
  'event: stage\ndata: {"name":"retrieve","status":"completed"}\n\n',
  'event: stage\ndata: {"name":"rerank","status":"completed"}\n\n',
  'event: stage\ndata: {"name":"expand_context","status":"completed"}\n\n',
  'event: token\ndata: {"token":"根据制度，访问需要审批 "}\n\n',
  `event: token\ndata: {"token":"[来源:安全制度.md#${citedChunkId}]"}\n\n`,
  `event: metadata\ndata: ${JSON.stringify({
    conversation_id: conversationId,
    rewritten_query: "访问审批制度",
    citations: [
      {
        document_id: citedDocumentId,
        document_name: "安全制度.md",
        chunk_id: citedChunkId,
        score: 0.93,
        content_preview: "所有受限访问必须由知识库负责人审批。",
        location: {
          kind: "paragraph",
          page: null,
          slide: null,
          paragraph_start: 7,
          paragraph_end: 8,
          sheet: null,
          table: null,
          cell_range: null,
          section_index: 3,
          heading_path: ["访问审批"],
        },
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
    await page.route(
      `**/api/v1/documents/${citedDocumentId}/preview?chunk_id=${citedChunkId}`,
      async (route) => {
        expect(route.request().headers().authorization).toBe("Bearer mock-access-token-for-e2e");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            document_id: citedDocumentId,
            name: "安全制度.md",
            content_type: "text/markdown",
            source_type: "upload",
            target_chunk_id: citedChunkId,
            target_location: {
              kind: "paragraph",
              page: null,
              slide: null,
              paragraph_start: 7,
              paragraph_end: 8,
              sheet: null,
              table: null,
              cell_range: null,
              section_index: 3,
              heading_path: ["访问审批"],
            },
            sections: [
              {
                section_index: 3,
                title: "访问审批",
                heading_path: ["访问审批"],
                content: "所有受限访问必须由知识库负责人审批。",
                location: {
                  kind: "paragraph",
                  page: null,
                  slide: null,
                  paragraph_start: 7,
                  paragraph_end: 8,
                  sheet: null,
                  table: null,
                  cell_range: null,
                  section_index: 3,
                  heading_path: ["访问审批"],
                },
                is_target: true,
              },
            ],
            truncated: false,
            download_available: true,
          }),
        });
      },
    );
    let storedTitle = "访问需要什么审批？";
    let storedStatus = "active";
    await page.route("**/api/v1/conversations**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const conversation = {
        id: conversationId,
        knowledge_base_id: kbId,
        title: storedTitle,
        status: storedStatus,
        created_at: "2026-07-14T00:00:00Z",
        updated_at: "2026-07-14T00:00:00Z",
      };
      if (url.pathname.endsWith("/messages")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [
              {
                id: "33333333-3333-4333-8333-333333333333",
                conversation_id: conversationId,
                role: "user",
                content: "访问需要什么审批？",
                citations: [],
                token_usage: {},
                created_at: "2026-07-14T00:00:00Z",
              },
              {
                id: "44444444-4444-4444-8444-444444444444",
                conversation_id: conversationId,
                role: "assistant",
                content: "根据制度，访问需要审批。",
                citations: [],
                token_usage: {},
                created_at: "2026-07-14T00:00:01Z",
              },
            ],
            total: 2,
            limit: 50,
            offset: 0,
            has_more: false,
          }),
        });
        return;
      }
      if (request.method() === "PATCH") {
        storedTitle = (request.postDataJSON() as { title: string }).title;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...conversation, title: storedTitle }) });
        return;
      }
      if (url.pathname.endsWith("/archive")) {
        storedStatus = "archived";
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...conversation, status: storedStatus }) });
        return;
      }
      if (url.pathname.endsWith("/restore")) {
        storedStatus = "active";
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...conversation, status: storedStatus }) });
        return;
      }
      const requestedStatus = url.searchParams.get("status") ?? "active";
      const items = requestedStatus === storedStatus ? [{ ...conversation, title: storedTitle, status: storedStatus }] : [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items, total: items.length, limit: 50, offset: 0 }),
      });
    });
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
      await expect(page.getByText("第 7～8 段")).toBeVisible();
      await page.getByRole("button", { name: "查看原文" }).click();
      const sourceDialog = page.getByRole("dialog", { name: "安全制度.md" });
      await expect(sourceDialog).toBeVisible();
      await expect(sourceDialog.getByText("第 7～8 段").first()).toBeVisible();
      await sourceDialog.getByRole("button", { name: "关闭原文预览" }).first().click();

      const storedConversation = await page.evaluate((id) =>
        window.sessionStorage.getItem(`evidence-desk:conversation-id:${id}`), kbId);
      expect(storedConversation).toBe(conversationId);
      await page.reload();
      await expect(page.getByRole("heading", { name: "完整会话记录" })).toBeVisible();
      await expect(page.getByText("根据制度，访问需要审批。", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "重命名" }).click();
      await page.getByLabel("会话标题").fill("访问审批复核");
      await page.getByRole("button", { name: "保存标题" }).click();
      await expect(page.getByLabel("会话历史").locator("option:checked")).toHaveText("访问审批复核");
      await page.getByRole("button", { name: "归档会话" }).click();
      await expect(page.getByText(/请选择一个已归档会话/)).toBeVisible();
      await page.getByLabel("会话历史").selectOption(conversationId);
      await expect(page.getByText(/当前为只读状态/)).toBeVisible();
      await page.getByRole("button", { name: "恢复会话" }).click();
      await expect(page.getByLabel("会话历史").locator("option:checked")).toHaveText("访问审批复核");
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
