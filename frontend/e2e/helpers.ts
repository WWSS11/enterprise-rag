import { expect, type ConsoleMessage, type Page } from "@playwright/test";

/** Never log secrets. Callers must not print E2E_PASSWORD or tokens. */
export function e2eCredentials(): { username: string; password: string } {
  const username = process.env.E2E_USERNAME?.trim() || "rag-admin";
  const password = process.env.E2E_PASSWORD?.trim() || "admin_change_me";
  if (!password) {
    throw new Error("E2E_PASSWORD is required for authenticated Playwright tests");
  }
  return { username, password };
}

export function oidcAuthority(): string {
  // Prefer localhost to match Keycloak issuer and browser origin in local e2e.
  const host = process.env.VITE_HOST_IP?.trim() || "127.0.0.1";
  return (
    process.env.VITE_OIDC_AUTHORITY?.trim() ||
    `http://${host}:18080/realms/enterprise-rag`
  );
}

export function apiBaseUrl(): string {
  const host = process.env.VITE_HOST_IP?.trim() || "127.0.0.1";
  return process.env.VITE_API_BASE_URL?.trim() || `http://${host}:8000`;
}

export type ConsoleGuard = {
  errors: string[];
  dispose: () => void;
  assertClean: () => void;
};

const TOKENISH =
  /access_token|refresh_token|id_token|Bearer\s+[A-Za-z0-9\-_]+\.|eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\./i;

/** Capture uncaught page errors; fail if any appear. Never echo token-like text. */
export function attachConsoleGuard(page: Page): ConsoleGuard {
  const errors: string[] = [];

  const onPageError = (error: Error) => {
    const message = TOKENISH.test(error.message) ? "[redacted page error]" : error.message;
    errors.push(message);
  };

  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // Ignore noisy third-party/favicon noise; keep app errors.
    if (/favicon\.ico|Download the React DevTools/i.test(text)) return;
    // Expected when probing invalid/expired sessions against /auth/me.
    if (/status of 401|Failed to load resource.*401/i.test(text)) return;
    errors.push(TOKENISH.test(text) ? "[redacted console error]" : text);
  };

  page.on("pageerror", onPageError);
  page.on("console", onConsole);

  return {
    errors,
    dispose: () => {
      page.off("pageerror", onPageError);
      page.off("console", onConsole);
    },
    assertClean: () => {
      expect(errors, `Unexpected console/page errors: ${errors.join(" | ")}`).toEqual([]);
    },
  };
}

export async function clearBrowserAuth(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.evaluate(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });
}

/**
 * Real browser OIDC: app → Keycloak login form → /auth/callback → app.
 * Does not call the token endpoint or use Password Grant from the test harness.
 */
export async function loginThroughKeycloak(
  page: Page,
  path = "/app/chat",
): Promise<{ userId: string; tenantId: string; isAdmin: boolean; roles: string[]; groups: string[] }> {
  const { username, password } = e2eCredentials();
  let identity: {
    user_id: string;
    tenant_id: string;
    roles: string[];
    groups: string[];
    is_admin: boolean;
  } | null = null;

  page.on("response", async (response) => {
    try {
      if (!response.url().includes("/api/v1/auth/me") || response.status() !== 200) return;
      const body = (await response.json()) as {
        user_id: string;
        tenant_id: string;
        roles: string[];
        groups: string[];
        is_admin: boolean;
      };
      identity = body;
    } catch {
      // ignore non-JSON
    }
  });

  await page.goto(path);

  // Protected route → /login (optional auto-start) → Keycloak authorize URL.
  const authorizePattern = /\/realms\/enterprise-rag\/.*protocol\/openid-connect\/auth/;
  await Promise.race([
    page.waitForURL(authorizePattern, { timeout: 30_000 }),
    page
      .getByRole("button", { name: /Continue with SSO|使用企业账号登录/i })
      .waitFor({ state: "visible", timeout: 30_000 }),
    page
      .getByRole("button", { name: /Redirecting to identity provider|正在跳转到身份提供方/i })
      .waitFor({ state: "visible", timeout: 30_000 }),
  ]);

  if (!authorizePattern.test(page.url())) {
    const continueBtn = page.getByRole("button", {
      name: /Continue with SSO|使用企业账号登录/i,
    });
    if (await continueBtn.isVisible().catch(() => false)) {
      if (await continueBtn.isEnabled()) {
        await continueBtn.click();
      }
    }
    await page.waitForURL(authorizePattern, { timeout: 30_000 });
  }

  await expect(page.locator("#username")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();

  // Callback strips ?code= and lands in the app.
  await page.waitForURL(/\/app\//, { timeout: 45_000 });
  expect(page.url()).not.toMatch(/[?&]code=/);
  expect(page.url()).not.toMatch(/[?&]state=/);

  // Wait for identity API success (captured via response listener).
  await expect
    .poll(() => identity, { timeout: 20_000 })
    .not.toBeNull();

  const me = identity!;
  return {
    userId: me.user_id,
    tenantId: me.tenant_id,
    isAdmin: me.is_admin,
    roles: me.roles,
    groups: me.groups,
  };
}

export async function seedMockAuthenticatedSession(page: Page): Promise<void> {
  const authority = oidcAuthority();
  const clientId = process.env.VITE_OIDC_CLIENT_ID?.trim() || "enterprise-rag-web";
  const storageKey = `oidc.user:${authority}:${clientId}`;
  const user = {
    id_token: "",
    session_state: null,
    access_token: "mock-access-token-for-e2e",
    refresh_token: "",
    token_type: "Bearer",
    scope: "openid profile email",
    profile: { sub: "mock-e2e-user" },
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };

  await page.evaluate(
    ({ key, value }) => {
      window.sessionStorage.setItem(key, JSON.stringify(value));
      window.localStorage.clear();
    },
    { key: storageKey, value: user },
  );
}

export async function assertNoAccessTokenInLocalStorage(page: Page): Promise<void> {
  const found = await page.evaluate(() => {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i) ?? "";
      const value = window.localStorage.getItem(key) ?? "";
      if (/access_token|id_token|refresh_token/i.test(key)) return true;
      if (/access_token|id_token|refresh_token|eyJ[A-Za-z0-9\-_]+\./i.test(value)) return true;
    }
    return false;
  });
  expect(found, "Access/id/refresh tokens must not live in localStorage").toBe(false);
}

export async function assertSessionStorageHasOidcUser(page: Page): Promise<void> {
  const hasUser = await page.evaluate(() => {
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i) ?? "";
      if (key.startsWith("oidc.user:")) return true;
    }
    return false;
  });
  expect(hasUser, "OIDC user session should be in sessionStorage").toBe(true);
}

export async function logoutFromShell(page: Page): Promise<void> {
  const menuTrigger = page.locator('header button[aria-haspopup="dialog"]');
  await expect(menuTrigger).toBeVisible();
  if (!(await page.getByRole("dialog").isVisible().catch(() => false))) {
    await menuTrigger.click();
  }
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: /退出登录|Sign out/i }).click();
  await page.waitForURL(
    (url) => url.pathname === "/login" || url.href.includes("/login"),
    { timeout: 60_000 },
  );
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await expect(page.getByRole("heading", { name: "Evidence Desk" })).toBeVisible({
    timeout: 30_000,
  });
}

export async function seedInvalidOidcSession(page: Page): Promise<void> {
  const authority = oidcAuthority();
  const clientId = process.env.VITE_OIDC_CLIENT_ID?.trim() || "enterprise-rag-web";
  const key = `oidc.user:${authority}:${clientId}`;
  // Intentionally invalid access token — never a real secret.
  const fakeUser = {
    id_token: "", // empty → local logout path (no IdP end-session)
    session_state: null,
    access_token: "invalid-access-token-for-e2e",
    refresh_token: "",
    token_type: "Bearer",
    scope: "openid profile email",
    profile: { sub: "invalid-e2e-subject" },
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };

  await page.goto("/login");
  await page.evaluate(
    ({ storageKey, user }) => {
      window.sessionStorage.setItem(storageKey, JSON.stringify(user));
      window.localStorage.clear();
    },
    { storageKey: key, user: fakeUser },
  );
}
