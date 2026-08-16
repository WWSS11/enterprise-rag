import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createApiClient } from "@/api/client";
import { AuthContext, type AuthContextValue } from "@/auth/authContext";
import { renderWithI18n, resetI18n } from "@/test/i18nTestUtils";
import { DocumentPreviewDialog } from "./DocumentPreviewDialog";

const documentId = "11111111-1111-4111-8111-111111111111";
const chunkId = "22222222-2222-4222-8222-222222222222";

function auth(fetchImpl: typeof fetch): AuthContextValue {
  return {
    status: "authenticated",
    user: null,
    identity: {
      user_id: "reader-a",
      tenant_id: "default",
      roles: ["rag-user"],
      groups: [],
      auth_method: "oidc",
      is_admin: false,
    },
    identityError: null,
    isAuthenticated: true,
    api: createApiClient({
      baseUrl: "http://api.test",
      getAccessToken: async () => "token",
      renewAccessToken: async () => null,
      fetchImpl,
    }),
    login: async () => undefined,
    logout: async () => undefined,
    completeLogin: async () => undefined,
    renewToken: async () => null,
    getAccessToken: async () => "token",
    refreshIdentity: async () => null,
    hasRole: () => false,
    hasAnyRole: () => false,
  };
}

describe("DocumentPreviewDialog", () => {
  beforeEach(async () => {
    await resetI18n("zh-CN");
  });

  it("loads the cited excerpt and downloads the permission-checked original", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/api/v1/documents/${documentId}/download`)) {
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token");
        return new Response(new Blob(["source"]), {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        });
      }
      return new Response(JSON.stringify({
        document_id: documentId,
        name: "policy.pdf",
        content_type: "application/pdf",
        source_type: "upload",
        target_chunk_id: chunkId,
        target_location: {
          kind: "page",
          page: 7,
          slide: null,
          paragraph_start: null,
          paragraph_end: null,
          sheet: null,
          table: null,
          cell_range: null,
          section_index: 2,
          heading_path: ["第 7 页"],
        },
        sections: [{
          section_index: 2,
          title: "第 7 页",
          heading_path: ["第 7 页"],
          content: "最小权限原则。",
          location: {
            kind: "page",
            page: 7,
            slide: null,
            paragraph_start: null,
            paragraph_end: null,
            sheet: null,
            table: null,
            cell_range: null,
            section_index: 2,
            heading_path: ["第 7 页"],
          },
          is_target: true,
        }],
        truncated: false,
        download_available: true,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

    renderWithI18n(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={auth(fetchMock as unknown as typeof fetch)}>
          <DocumentPreviewDialog
            target={{ documentId, documentName: "policy.pdf", chunkId }}
            onClose={() => undefined}
          />
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("最小权限原则。")).toBeVisible();
    expect(screen.getAllByText("第 7 页").length).toBeGreaterThanOrEqual(1);
    await user.click(screen.getByRole("button", { name: "下载原文件" }));
    await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(click).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      `http://api.test/api/v1/documents/${documentId}/download`,
      expect.objectContaining({ method: "GET" }),
    );
  });
});
