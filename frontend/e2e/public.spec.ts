import { test, expect } from "@playwright/test";

test.describe("public shell", () => {
  test("login page renders SSO entry without password form (zh-CN default)", async ({ page }) => {
    await page.goto("/login");
    await page.evaluate(() => {
      window.localStorage.removeItem("evidence-desk:locale");
      window.sessionStorage.clear();
    });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Evidence Desk" })).toBeVisible();
    await expect(page.getByRole("button", { name: /使用企业账号登录/i })).toBeVisible();
    await expect(page.getByText(/Authorization Code \+ PKCE/i)).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  });

  test("unknown route shows localized 404", async ({ page }) => {
    await page.goto("/does-not-exist");
    await expect(page.getByRole("heading", { name: /页面不存在|Page not found/i })).toBeVisible();
  });
});
