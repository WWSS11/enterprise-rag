import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n, {
  changeAppLocale,
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  readStoredLocale,
} from "@/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ForbiddenPage, NotFoundPage } from "@/pages/StatusPages";
import { ApiHealth } from "@/components/ApiHealth";
import { AuthContext, type AuthContextValue } from "@/auth/authContext";
import { createApiClient } from "@/api/client";
import { renderWithI18n, resetI18n } from "@/test/i18nTestUtils";

describe("i18n foundation", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    await resetI18n(DEFAULT_LOCALE);
  });

  it("defaults to zh-CN", () => {
    expect(i18n.language).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("switches to en-US and updates document lang", async () => {
    await changeAppLocale("en-US");
    expect(i18n.language).toBe("en-US");
    expect(document.documentElement.lang).toBe("en-US");
  });

  it("persists explicit language choice in project locale key only", async () => {
    await changeAppLocale("en-US");
    expect(readStoredLocale()).toBe("en-US");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en-US");
    expect(window.localStorage.getItem("access_token")).toBeNull();
    expect(window.sessionStorage.getItem("access_token")).toBeNull();
  });

  it("falls back for missing translation keys", () => {
    const missing = i18n.t("definitelyMissingKey" as never);
    expect(String(missing)).toContain("definitelyMissingKey");
  });

  it("language switcher changes locale without writing tokens", async () => {
    const user = userEvent.setup();
    renderWithI18n(<LanguageSwitcher />);
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(i18n.language).toBe("en-US");
    expect(document.documentElement.lang).toBe("en-US");
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i) ?? "";
      expect(key).not.toMatch(/token/i);
    }
  });

  it("renders localized 403 and 404 pages", async () => {
    const authAnon = {
      status: "anonymous" as const,
      user: null,
      identity: null,
      identityError: null,
      isAuthenticated: false,
      api: createApiClient({
        getAccessToken: async () => null,
        renewAccessToken: async () => null,
      }),
      login: async () => undefined,
      logout: async () => undefined,
      completeLogin: async () => undefined,
      renewToken: async () => null,
      getAccessToken: async () => null,
      refreshIdentity: async () => null,
      hasRole: () => false,
      hasAnyRole: () => false,
    } satisfies AuthContextValue;

    const first = renderWithI18n(
      <MemoryRouter>
        <ForbiddenPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "无权访问" })).toBeInTheDocument();
    first.unmount();

    await changeAppLocale("en-US");
    renderWithI18n(
      <AuthContext.Provider value={authAnon}>
        <MemoryRouter>
          <NotFoundPage />
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });

  it("localizes API health states", async () => {
    const api = createApiClient({
      getAccessToken: async () => null,
      renewAccessToken: async () => null,
      fetchImpl: async () =>
        new Response(JSON.stringify({ status: "ok", service: "rag-api", version: "0.1.0" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    const authValue = {
      status: "authenticated",
      user: null,
      identity: {
        user_id: "u1",
        tenant_id: "default",
        roles: ["rag-admin"],
        groups: ["engineering"],
        auth_method: "oidc",
        is_admin: true,
      },
      identityError: null,
      isAuthenticated: true,
      api,
      login: async () => undefined,
      logout: async () => undefined,
      completeLogin: async () => undefined,
      renewToken: async () => null,
      getAccessToken: async () => null,
      refreshIdentity: async () => null,
      hasRole: () => true,
      hasAnyRole: () => true,
    } satisfies AuthContextValue;

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    renderWithI18n(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={authValue}>
          <MemoryRouter>
            <ApiHealth />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("API 运行正常")).toBeInTheDocument();
    await act(async () => {
      await changeAppLocale("en-US");
    });
    expect(await screen.findByText("API healthy")).toBeInTheDocument();
  });

  it("keeps route stable when language changes", async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <MemoryRouter initialEntries={["/app/chat"]}>
        <Routes>
          <Route
            path="/app/chat"
            element={
              <div>
                <LanguageSwitcher />
                <h1>route-ok</h1>
              </div>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "route-ok" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("heading", { name: "route-ok" })).toBeInTheDocument();
    expect(i18n.language).toBe("en-US");
  });
});
