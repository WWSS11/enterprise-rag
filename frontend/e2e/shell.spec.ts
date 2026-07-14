import { test, expect } from "@playwright/test";
import {
  apiBaseUrl,
  attachConsoleGuard,
  clearBrowserAuth,
  loginThroughKeycloak,
  oidcAuthority,
} from "./helpers";

test.describe("shell a11y and first-run", () => {
  test.beforeAll(async ({ request }) => {
    expect((await request.get(`${apiBaseUrl()}/health/live`)).ok()).toBeTruthy();
    expect(
      (await request.get(`${oidcAuthority()}/.well-known/openid-configuration`)).ok(),
    ).toBeTruthy();
  });

  test.beforeEach(async ({ page }) => {
    await clearBrowserAuth(page);
  });

  test("mobile drawer traps focus, Escape closes, restores trigger", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const guard = attachConsoleGuard(page);
    try {
      await loginThroughKeycloak(page, "/app/chat");
      const openBtn = page.getByRole("button", { name: /打开导航|Open navigation/i });
      await expect(openBtn).toBeVisible();
      await openBtn.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("button", { name: /关闭导航|Close navigation/i })).toBeFocused();

      // Tab cycles inside drawer
      await page.keyboard.press("Tab");
      const active = await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') != null);
      expect(active).toBe(true);

      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(openBtn).toBeFocused();

      // no horizontal overflow on body content
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        const body = document.body;
        return Math.max(doc.scrollWidth, body.scrollWidth) > Math.max(doc.clientWidth, body.clientWidth) + 2;
      });
      expect(overflow).toBe(false);
      guard.assertClean();
    } finally {
      guard.dispose();
    }
  });

  test("chat workspace and api health navigation", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginThroughKeycloak(page, "/app/chat");
    await expect(page.getByRole("heading", { name: "智能问答" })).toBeVisible();
    await expect(page.getByLabel("知识库")).toBeVisible();
    await expect(page.getByLabel("问题")).toBeVisible();
    await expect(page.getByRole("heading", { name: "引用证据", exact: true })).toBeVisible();

    // ApiHealth header link goes to system.
    await page.getByRole("link", { name: /API 健康/i }).click();
    await expect(page).toHaveURL(/\/app\/system/);
    await expect(page.getByRole("heading", { name: "系统状态" })).toBeVisible();
  });
});
