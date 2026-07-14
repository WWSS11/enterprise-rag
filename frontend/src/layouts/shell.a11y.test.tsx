import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "@/layouts/AppShell";
import { AuthContext, type AuthContextValue } from "@/auth/authContext";
import { createApiClient } from "@/api/client";
import { EmptyState } from "@/components/EmptyState";
import { NotFoundPage } from "@/pages/StatusPages";
import { renderWithI18n, resetI18n } from "@/test/i18nTestUtils";
import { SIDEBAR_COLLAPSED_KEY } from "@/hooks/uiPrefs";

function authValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  const api = createApiClient({
    getAccessToken: async () => "t",
    renewAccessToken: async () => null,
    fetchImpl: async () =>
      new Response(JSON.stringify({ status: "ok", service: "rag-api", version: "0.1.0" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  });
  return {
    status: "authenticated",
    user: null,
    identity: {
      user_id: "user-1",
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
    getAccessToken: async () => "t",
    refreshIdentity: async () => null,
    hasRole: () => true,
    hasAnyRole: () => true,
    ...overrides,
  };
}

function renderShell(path = "/app/chat") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithI18n(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={authValue()}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/app" element={<AppShell />}>
              <Route path="chat" element={<div>chat-page</div>} />
              <Route path="system" element={<div>system-page</div>} />
              <Route path="knowledge-bases" element={<div>kb-page</div>} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe("shell critique fixes", () => {
  beforeEach(async () => {
    await resetI18n("zh-CN");
    window.localStorage.clear();
    // Mobile viewport for drawer
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: query.includes("max-width"),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  });

  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("EmptyState generates unique heading ids", () => {
    renderWithI18n(
      <>
        <EmptyState title="A" description="d1" />
        <EmptyState title="B" description="d2" />
      </>,
    );
    const h1 = screen.getByRole("heading", { name: "A" });
    const h2 = screen.getByRole("heading", { name: "B" });
    expect(h1.id).toBeTruthy();
    expect(h2.id).toBeTruthy();
    expect(h1.id).not.toBe(h2.id);
  });

  it("404 shows workspace CTA when authenticated", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithI18n(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={authValue()}>
          <MemoryRouter>
            <NotFoundPage />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("link", { name: /返回工作台|Back to workspace/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^登录$|^Sign in$/i })).not.toBeInTheDocument();
  });

  it("404 shows sign-in when anonymous", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithI18n(
      <QueryClientProvider client={client}>
        <AuthContext.Provider
          value={authValue({
            isAuthenticated: false,
            status: "anonymous",
            identity: null,
          })}
        >
          <MemoryRouter>
            <NotFoundPage />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("link", { name: /登录|Sign in/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /打开智能问答|Open Chat/i })).not.toBeInTheDocument();
  });

  it("ApiHealth links to system", async () => {
    renderShell("/app/chat");
    const link = await screen.findByRole("link", { name: /API 健康|API health/i });
    expect(link).toHaveAttribute("href", "/app/system");
  });

  it("UserMenu has accessible name, modal dialog, Escape closes", async () => {
    const user = userEvent.setup();
    renderShell();
    const trigger = screen.getByRole("button", { name: /用户: user-1|User: user-1/i });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("button", { name: /退出登录|Sign out/i })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("persists sidebar collapsed preference without tokens", async () => {
    const user = userEvent.setup();
    // force desktop: menu button hidden but collapse still in sidebar
    renderShell();
    const collapse = screen.getByRole("button", { name: /收起侧栏|Collapse sidebar/i });
    await user.click(collapse);
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe("1");
    expect(window.localStorage.getItem("access_token")).toBeNull();
  });

  it("language switcher is in header and does not clear session storage keys for oidc", async () => {
    const user = userEvent.setup();
    window.sessionStorage.setItem("oidc.user:test", "keep");
    renderShell();
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(document.documentElement.lang).toBe("en-US");
    expect(window.sessionStorage.getItem("oidc.user:test")).toBe("keep");
  });
});
