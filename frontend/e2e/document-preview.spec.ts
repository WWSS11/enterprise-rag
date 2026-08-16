import { expect, test } from "@playwright/test";
import {
  assertNoAccessTokenInLocalStorage,
  attachConsoleGuard,
  clearBrowserAuth,
  seedMockAuthenticatedSession,
} from "./helpers";

const knowledgeBaseId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const chunkId = "33333333-3333-4333-8333-333333333333";

test("previews a cited source location and downloads the authorized original", async ({ page }) => {
  const guard = attachConsoleGuard(page);
  let downloadAuthorized = false;

  try {
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
        body: JSON.stringify({
          status: "ok",
          service: "rag-api",
          version: "test",
          dependencies: {},
        }),
      }),
    );
    await page.route(/\/api\/v1\/knowledge-bases(?:\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: knowledgeBaseId,
            tenant_id: "default",
            slug: "security",
            name: "安全知识库",
            description: "Security policy",
            access_mode: "restricted",
            status: "active",
            is_default: true,
            created_by: "owner-1",
            created_at: "2026-08-09T00:00:00Z",
            updated_at: "2026-08-09T00:00:00Z",
          },
        ]),
      }),
    );
    await page.route(
      `**/api/v1/knowledge-bases/${knowledgeBaseId}/permissions/me`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            knowledge_base_id: knowledgeBaseId,
            permission: "reader",
            source: "membership",
          }),
        }),
    );
    await page.route(/\/api\/v1\/documents\?knowledge_base_id=.*$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: documentId,
            tenant_id: "default",
            knowledge_base_id: knowledgeBaseId,
            name: "policy.xlsx",
            source_type: "upload",
            source_key: null,
            source_available: true,
            source_updated_at: null,
            content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            size_bytes: 2048,
            status: "ready",
            chunk_count: 1,
            index_version: "index-v1",
            indexed_at: "2026-08-09T00:00:00Z",
            error_message: null,
            extra_metadata: {},
            created_at: "2026-08-09T00:00:00Z",
            updated_at: "2026-08-09T00:00:00Z",
          },
        ]),
      }),
    );
    await page.route(`**/api/v1/documents/${documentId}/preview`, async (route) => {
      expect(route.request().headers().authorization).toBe("Bearer mock-access-token-for-e2e");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          document_id: documentId,
          name: "policy.xlsx",
          content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          source_type: "upload",
          target_chunk_id: chunkId,
          target_location: {
            kind: "cell_range",
            page: null,
            slide: null,
            paragraph_start: null,
            paragraph_end: null,
            sheet: "Access Matrix",
            table: null,
            cell_range: "B2:D2",
            section_index: 0,
            heading_path: ["Access Matrix"],
          },
          sections: [
            {
              section_index: 0,
              title: "Access Matrix",
              heading_path: ["Access Matrix"],
              content: "Finance | Restricted | Approval required",
              location: {
                kind: "cell_range",
                page: null,
                slide: null,
                paragraph_start: null,
                paragraph_end: null,
                sheet: "Access Matrix",
                table: null,
                cell_range: "B2:D2",
                section_index: 0,
                heading_path: ["Access Matrix"],
              },
              is_target: true,
            },
          ],
          truncated: false,
          download_available: true,
        }),
      });
    });
    await page.route(`**/api/v1/documents/${documentId}/download`, async (route) => {
      expect(route.request().headers().authorization).toBe("Bearer mock-access-token-for-e2e");
      downloadAuthorized = true;
      await route.fulfill({
        status: 200,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers: { "content-disposition": 'attachment; filename="policy.xlsx"' },
        body: "mock-original-file",
      });
    });
    await seedMockAuthenticatedSession(page);

    await page.goto(`/app/knowledge-bases/${knowledgeBaseId}`);
    await expect(page.getByText("policy.xlsx")).toBeVisible();
    await page.getByRole("button", { name: "查看原文" }).click();

    const dialog = page.getByRole("dialog", { name: "policy.xlsx" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Access Matrix B2:D2").first()).toBeVisible();
    await expect(dialog.getByText("Finance | Restricted | Approval required")).toBeVisible();

    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "下载原文件" }).click();
    await expect((await download).suggestedFilename()).toBe("policy.xlsx");
    expect(downloadAuthorized).toBe(true);

    await assertNoAccessTokenInLocalStorage(page);
    guard.assertClean();
  } finally {
    guard.dispose();
  }
});
