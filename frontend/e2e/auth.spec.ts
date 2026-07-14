import { test, expect } from "@playwright/test";
import {
  apiBaseUrl,
  assertNoAccessTokenInLocalStorage,
  assertSessionStorageHasOidcUser,
  attachConsoleGuard,
  clearBrowserAuth,
  loginThroughKeycloak,
  logoutFromShell,
  oidcAuthority,
  seedInvalidOidcSession,
} from "./helpers";

test.describe.configure({ mode: "serial" });

test.describe("authenticated OIDC shell (Keycloak PKCE)", () => {
  test.beforeAll(async ({ request }) => {
    const live = await request.get(`${apiBaseUrl()}/health/live`);
    expect(live.ok(), "FastAPI must be running for authenticated e2e").toBeTruthy();

    const oidc = await request.get(`${oidcAuthority()}/.well-known/openid-configuration`);
    expect(oidc.ok(), "Keycloak OIDC discovery must be reachable").toBeTruthy();
  });

  test.beforeEach(async ({ page }) => {
    await clearBrowserAuth(page);
  });

  test("PKCE login, identity, reload, storage, logout, and recovery", async ({ page }) => {
    const guard = attachConsoleGuard(page);

    try {
      const identity = await loginThroughKeycloak(page, "/app/chat");

      await expect(page.getByRole("heading", { name: "智能问答" })).toBeVisible();
      expect(page.url()).toMatch(/\/app\/chat/);
      expect(page.url()).not.toMatch(/[?&]code=/);
      await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

      await page.goto("/app/system");
      await expect(page.getByRole("heading", { name: "系统状态" })).toBeVisible();
      await expect(page.getByText(identity.userId, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(identity.tenantId, { exact: true }).first()).toBeVisible();
      for (const role of identity.roles) {
        await expect(page.locator("dd.mono, .mono").filter({ hasText: role }).first()).toBeVisible();
      }
      for (const group of identity.groups) {
        await expect(page.locator("dd.mono, .mono").filter({ hasText: group }).first()).toBeVisible();
      }
      await expect(
        page.locator("dd.mono").filter({ hasText: String(identity.isAdmin) }).first(),
      ).toBeVisible();

      await assertSessionStorageHasOidcUser(page);
      await assertNoAccessTokenInLocalStorage(page);

      await page.reload();
      await expect(page.getByRole("heading", { name: "系统状态" })).toBeVisible();
      await expect(page.getByText(identity.userId, { exact: true }).first()).toBeVisible();
      await assertSessionStorageHasOidcUser(page);
      await assertNoAccessTokenInLocalStorage(page);

      await page.goto("/app/chat");
      await expect(page.getByRole("heading", { name: "智能问答" })).toBeVisible();
      await page.goto("/app/jobs");
      await expect(page.getByRole("heading", { name: "任务中心" })).toBeVisible();

      await logoutFromShell(page);
      await expect(
        page.getByRole("button", { name: /使用企业账号登录|Continue with SSO/i }),
      ).toBeVisible({ timeout: 15_000 });

      await page.goto("/app/chat");
      await expect(page).not.toHaveURL(/\/app\/chat(?:\?|$)/, { timeout: 30_000 });
      await expect
        .poll(() => {
          const href = page.url();
          return (
            href.includes("/login") ||
            href.includes("/protocol/openid-connect/auth") ||
            href.includes("/auth/callback")
          );
        })
        .toBeTruthy();
      expect(page.url()).not.toMatch(/\/app\/(?:chat|system|jobs)/);

      guard.assertClean();
    } finally {
      guard.dispose();
    }
  });

  test("language switch persists and preserves auth + route", async ({ page }) => {
    const guard = attachConsoleGuard(page);
    try {
      const identity = await loginThroughKeycloak(page, "/app/chat");
      await expect(page.getByRole("heading", { name: "智能问答" })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

      // Open user menu is no longer needed for language — switcher is in header
      await page.getByRole("button", { name: "English" }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
      await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible();
      expect(page.url()).toMatch(/\/app\/chat/);
      await expect(page.getByText(identity.userId).first()).toBeVisible();

      const locale = await page.evaluate(() => window.localStorage.getItem("evidence-desk:locale"));
      expect(locale).toBe("en-US");
      await assertNoAccessTokenInLocalStorage(page);
      await assertSessionStorageHasOidcUser(page);

      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
      await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible();
      await expect(page.getByText(identity.userId).first()).toBeVisible();

      await page.getByRole("button", { name: "中文" }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
      await expect(page.getByRole("heading", { name: "智能问答" })).toBeVisible();

      // Chat is now a real API-backed workspace; selector/form remain available after locale changes.
      await expect(page.getByLabel(/知识库|Knowledge base/i)).toBeVisible();
      await expect(page.getByLabel(/问题|Question/i)).toBeVisible();

      await logoutFromShell(page);
      await expect(page.getByRole("button", { name: /使用企业账号登录/i })).toBeVisible();
      await assertNoAccessTokenInLocalStorage(page);
      guard.assertClean();
    } finally {
      guard.dispose();
    }
  });

  test("invalid session shows recoverable identity error without redirect loop", async ({
    page,
  }) => {
    const guard = attachConsoleGuard(page);

    try {
      await seedInvalidOidcSession(page);

      const urls: string[] = [];
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) {
          urls.push(frame.url());
        }
      });

      await page.goto("/app/chat");

      await expect(
        page.getByRole("heading", { name: /身份不可用|Identity unavailable/i }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: /重试加载身份|Retry identity/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /退出登录|Sign out/i })).toBeVisible();

      await page.waitForTimeout(1500);
      const appChatHits = urls.filter((u) => u.includes("/app/chat")).length;
      const loginHits = urls.filter((u) => /\/login(?:\?|$)/.test(u)).length;
      expect(appChatHits, "must not thrash /app/chat").toBeLessThan(5);
      expect(loginHits, "must not thrash /login while identity_error").toBeLessThan(5);

      await page.getByRole("button", { name: /退出登录|Sign out/i }).click();
      await page.waitForURL((url) => url.pathname === "/login", { timeout: 20_000 });
      await expect(page.getByRole("heading", { name: "Evidence Desk" })).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: /使用企业账号登录|Continue with SSO|Redirecting to identity provider|正在跳转到身份提供方/i,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /使用企业账号登录|Continue with SSO/i }),
      ).toBeVisible({ timeout: 10_000 });

      guard.assertClean();
    } finally {
      guard.dispose();
    }
  });
});
