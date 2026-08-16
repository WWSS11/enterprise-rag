import { expect, test, type Page } from "@playwright/test";
import {
  assertNoAccessTokenInLocalStorage,
  attachConsoleGuard,
  clearBrowserAuth,
  seedMockAuthenticatedSession,
} from "./helpers";

const knowledgeBaseId = "11111111-1111-4111-8111-111111111111";
const sourceDatasetId = "22222222-2222-4222-8222-222222222222";
const copiedDatasetId = "33333333-3333-4333-8333-333333333333";
const documentId = "44444444-4444-4444-8444-444444444444";
const timestamp = "2026-08-09T00:00:00Z";

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.html).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
}

test("edits, bulk imports, copies, and archives an evaluation dataset", async ({ page }) => {
  const guard = attachConsoleGuard(page);
  let sourceName = "Support release gate";
  let importedCases: unknown[] = [];
  let copied = false;
  let copiedArchived = false;

  function dataset(id: string, name: string, status = "active") {
    return {
      id,
      tenant_id: "default",
      knowledge_base_id: knowledgeBaseId,
      name,
      description: "Stable regression cases",
      status,
      created_by: "mock-e2e-user",
      created_at: timestamp,
      updated_at: timestamp,
    };
  }

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
          groups: ["quality"],
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
    await page.route(/\/api\/v1\/knowledge-bases(?:\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: knowledgeBaseId,
            tenant_id: "default",
            slug: "support",
            name: "Support KB",
            description: "Support policy",
            access_mode: "tenant",
            status: "active",
            is_default: true,
            created_by: "owner-a",
            created_at: timestamp,
            updated_at: timestamp,
          },
        ]),
      }),
    );
    await page.route(/\/api\/v1\/documents\?knowledge_base_id=.*$/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    );
    await page.route(/\/api\/v1\/evaluations\/runs\?.*$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], total: 0, limit: 10, offset: 0 }),
      }),
    );
    await page.route(/\/api\/v1\/evaluations\/datasets(?:\?.*)?$/, (route) => {
      const requestedStatus = new URL(route.request().url()).searchParams.get("status");
      const items = requestedStatus === "archived"
        ? copiedArchived
          ? [dataset(copiedDatasetId, `${sourceName}（副本）`, "archived")]
          : []
        : [dataset(sourceDatasetId, sourceName)];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(items),
      });
    });
    await page.route(/\/api\/v1\/evaluations\/datasets\/[^/]+(?:\/.*)?(?:\?.*)?$/, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const parts = url.pathname.split("/");
      const datasetIndex = parts.indexOf("datasets") + 1;
      const id = parts[datasetIndex];
      const action = parts[datasetIndex + 1];

      expect(request.headers().authorization).toBe("Bearer mock-access-token-for-e2e");
      if (action === "cases" && parts[datasetIndex + 2] === "bulk") {
        const payload = request.postDataJSON() as { cases: unknown[] };
        importedCases = payload.cases;
        const responseCases = payload.cases.map((item, index) => ({
          ...(item as Record<string, unknown>),
          id: `55555555-5555-4555-8555-55555555555${index}`,
          dataset_id: id,
          expected_document_ids: (item as { expected_document_ids?: string[] }).expected_document_ids ?? [],
          acceptable_citation_document_ids: (item as { acceptable_citation_document_ids?: string[] }).acceptable_citation_document_ids ?? [],
          required_key_points: (item as { required_key_points?: string[] }).required_key_points ?? [],
          required_key_point_groups: (item as { required_key_point_groups?: string[][] }).required_key_point_groups ?? [],
          should_refuse: (item as { should_refuse?: boolean }).should_refuse ?? false,
          tags: (item as { tags?: string[] }).tags ?? [],
          created_at: timestamp,
          updated_at: timestamp,
        }));
        await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(responseCases) });
        return;
      }
      if (action === "cases") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: [], total: importedCases.length, limit: 10, offset: 0 }),
        });
        return;
      }
      if (action === "copy") {
        const payload = request.postDataJSON() as { name: string; description: string | null };
        copied = true;
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ ...dataset(copiedDatasetId, payload.name), description: payload.description }),
        });
        return;
      }
      if (action === "archive") {
        expect(id).toBe(copiedDatasetId);
        copiedArchived = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(dataset(copiedDatasetId, `${sourceName}（副本）`, "archived")),
        });
        return;
      }
      if (request.method() === "PATCH") {
        const payload = request.postDataJSON() as { name: string; description: string | null };
        sourceName = payload.name;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ...dataset(sourceDatasetId, sourceName), description: payload.description }),
        });
        return;
      }
      const name = id === copiedDatasetId ? `${sourceName}（副本）` : sourceName;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(dataset(id, name)),
      });
    });
    await seedMockAuthenticatedSession(page);

    await page.goto(`/app/evaluations/datasets/${sourceDatasetId}`);
    await expect(page.getByRole("heading", { name: "数据集管理" })).toBeVisible();

    await page.getByRole("button", { name: "修改数据集" }).click();
    await page.getByLabel("数据集名称").fill("Support release gate v2");
    await page.getByRole("button", { name: "保存修改" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Support release gate v2" })).toBeVisible();

    const cases = [
      {
        question: "Which approval is required?",
        reference_answer: "Owner approval.",
        expected_document_ids: [documentId],
        required_key_points: ["Owner approval"],
      },
      {
        question: "What is the unsupported password?",
        reference_answer: "Cannot answer from the available evidence.",
        should_refuse: true,
      },
    ];
    await page.getByLabel("用例 JSON").fill(JSON.stringify(cases));
    await page.getByRole("button", { name: "校验导入内容" }).click();
    await expect(page.getByText("校验通过：共 2 条，其中可回答题 1 条、拒答题 1 条。")).toBeVisible();
    await page.getByRole("button", { name: "导入 2 条用例" }).click();
    await expect(page.getByText("已成功导入 2 条用例。")).toBeVisible();
    expect(importedCases).toHaveLength(2);

    await page.getByRole("button", { name: "复制数据集" }).click();
    await page.getByRole("button", { name: "创建副本" }).click();
    await expect(page).toHaveURL(new RegExp(`/evaluations/datasets/${copiedDatasetId}$`));
    await expect(page.getByText("评测数据集副本已创建。")).toBeVisible();
    expect(copied).toBe(true);

    await page.getByRole("button", { name: "归档数据集" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "确认归档" }).click();
    await expect(page).toHaveURL(/\/app\/evaluations\?status=archived$/);
    await expect(page.getByText("评测数据集已归档。")).toBeVisible();
    await expect(page.getByText("Support release gate v2（副本）")).toBeVisible();
    await expect(page.getByText("已归档", { exact: true })).toBeVisible();
    expect(copiedArchived).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    await assertNoAccessTokenInLocalStorage(page);
    guard.assertClean();
  } finally {
    guard.dispose();
  }
});
