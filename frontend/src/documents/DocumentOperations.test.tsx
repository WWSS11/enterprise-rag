import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthContext, type AuthContextValue } from "@/auth/authContext";
import { createApiClient } from "@/api/client";
import type { KnowledgeBase } from "@/api/types";
import { renderWithI18n, resetI18n } from "@/test/i18nTestUtils";
import { DocumentOperations } from "./DocumentOperations";

const kbId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";

const knowledgeBase: KnowledgeBase = {
  id: kbId,
  tenant_id: "default",
  slug: "security",
  name: "Security KB",
  description: null,
  access_mode: "tenant",
  status: "active",
  is_default: false,
  created_by: "owner-1",
  created_at: "2026-07-15T00:00:00Z",
  updated_at: "2026-07-15T00:00:00Z",
};

function documentRecord() {
  return {
    id: documentId,
    tenant_id: "default",
    knowledge_base_id: kbId,
    name: "policy.pdf",
    source_type: "upload",
    source_key: null,
    source_uri: "uploads/policy.pdf",
    source_updated_at: null,
    content_type: "application/pdf",
    size_bytes: 6,
    status: "queued",
    chunk_count: 0,
    index_version: null,
    indexed_at: null,
    error_message: null,
    extra_metadata: {},
    created_at: "2026-07-15T00:00:00Z",
    updated_at: "2026-07-15T00:00:00Z",
  };
}

function jobRecord() {
  return {
    id: jobId,
    document_id: documentId,
    task_id: "task-1",
    job_type: "document_ingestion",
    status: "succeeded",
    progress: 100,
    result: { chunk_count: 4 },
    error_message: null,
    created_at: "2026-07-15T00:00:00Z",
    updated_at: "2026-07-15T00:00:01Z",
  };
}

class FakeXhr {
  status = 0;
  statusText = "";
  responseText = "";
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  responseHeaders = new Map<string, string>();
  sendCalls = 0;
  open() {}
  setRequestHeader() {}
  getResponseHeader(name: string) {
    return this.responseHeaders.get(name.toLowerCase()) ?? null;
  }
  send() {
    this.sendCalls += 1;
  }
  abort() {
    this.onabort?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ loaded, total, lengthComputable: true } as ProgressEvent);
  }
  respond(status: number, body: unknown, headers: Record<string, string> = {}) {
    this.status = status;
    this.statusText = status >= 400 ? "Error" : "OK";
    this.responseText = JSON.stringify(body);
    this.responseHeaders = new Map(
      Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
    );
    this.onload?.();
  }
}

function renderDocuments(xhr: FakeXhr | (() => FakeXhr), fetchImpl: typeof fetch) {
  const xhrFactory = typeof xhr === "function" ? xhr : () => xhr;
  const api = createApiClient({
    baseUrl: "http://api.test",
    getAccessToken: async () => "token",
    renewAccessToken: async () => null,
    fetchImpl,
    xhrFactory: () => xhrFactory() as unknown as XMLHttpRequest,
  });
  const auth: AuthContextValue = {
    status: "authenticated",
    user: null,
    identity: {
      user_id: "user-1",
      tenant_id: "default",
      roles: ["rag-user"],
      groups: [],
      auth_method: "oidc",
      is_admin: false,
    },
    identityError: null,
    isAuthenticated: true,
    api,
    login: async () => undefined,
    logout: async () => undefined,
    completeLogin: async () => undefined,
    renewToken: async () => null,
    getAccessToken: async () => "token",
    refreshIdentity: async () => null,
    hasRole: () => true,
    hasAnyRole: () => true,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithI18n(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter>
          <DocumentOperations knowledgeBase={knowledgeBase} canEdit />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe("DocumentOperations", () => {
  beforeEach(async () => {
    window.sessionStorage.clear();
    await resetI18n("zh-CN");
  });

  it.each([
    ["该文件扩展名不在后端支持列表中。", new File(["binary"], "policy.exe")],
    [
      "文件超过 50 MB 后端限制。",
      Object.defineProperty(new File(["policy"], "policy.pdf", { type: "application/pdf" }), "size", {
        value: 50 * 1024 * 1024 + 1,
      }),
    ],
  ])("rejects invalid files before creating an XHR: %s", async (message, file) => {
    const user = userEvent.setup({ applyAccept: false });
    const xhrFactory = vi.fn(() => new FakeXhr());
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
    ) as unknown as typeof fetch;
    renderDocuments(xhrFactory, fetchImpl);

    await screen.findByRole("heading", { name: "该知识库暂无文档" });
    await user.upload(screen.getByLabelText("选择文件"), file);
    await user.click(screen.getByRole("button", { name: "上传并创建入库任务" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(xhrFactory).not.toHaveBeenCalled();
  });

  it("uploads a file, shows real transfer progress, and tracks the accepted job", async () => {
    const user = userEvent.setup();
    const xhr = new FakeXhr();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).includes("/jobs/") ? jobRecord() : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    renderDocuments(xhr, fetchImpl);

    await screen.findByRole("heading", { name: "该知识库暂无文档" });
    const file = new File(["policy"], "policy.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("选择文件"), file);
    await user.click(screen.getByRole("button", { name: "上传并创建入库任务" }));
    await act(async () => {
      xhr.progress(3, 6);
    });
    expect(
      await screen.findByRole("progressbar", { name: "传输进度 50%" }),
    ).toBeVisible();
    await act(async () => {
      xhr.respond(202, { document: documentRecord(), job_id: jobId, task_id: "task-1" });
    });

    expect(await screen.findByText("文件已接收，真实入库任务已创建。")).toBeVisible();
    expect(await screen.findByText("已完成")).toBeVisible();
    expect(window.sessionStorage.getItem("evidence-desk:known-job-ids")).toContain(jobId);
  });

  it("cancels an in-flight upload without inventing a backend job cancellation", async () => {
    const user = userEvent.setup();
    const xhr = new FakeXhr();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
    ) as unknown as typeof fetch;
    renderDocuments(xhr, fetchImpl);

    await screen.findByRole("heading", { name: "该知识库暂无文档" });
    await user.upload(
      screen.getByLabelText("选择文件"),
      new File(["policy"], "policy.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: "上传并创建入库任务" }));
    await user.click(screen.getByRole("button", { name: "取消上传" }));

    expect(await screen.findByText("上传已取消")).toBeVisible();
    expect(screen.getByRole("button", { name: "重试上传" })).toBeEnabled();
    expect(window.sessionStorage.getItem("evidence-desk:known-job-ids")).toBeNull();
  });

  it("retries a failed upload through a second XHR and succeeds", async () => {
    const user = userEvent.setup();
    const failedXhr = new FakeXhr();
    const retryXhr = new FakeXhr();
    const xhrFactory = vi
      .fn<() => FakeXhr>()
      .mockReturnValueOnce(failedXhr)
      .mockReturnValueOnce(retryXhr);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).includes("/jobs/") ? jobRecord() : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    renderDocuments(xhrFactory, fetchImpl);

    await screen.findByRole("heading", { name: "该知识库暂无文档" });
    await user.upload(
      screen.getByLabelText("选择文件"),
      new File(["policy"], "policy.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: "上传并创建入库任务" }));
    await vi.waitFor(() => expect(xhrFactory).toHaveBeenCalledTimes(1));
    expect(failedXhr.sendCalls).toBe(1);
    await act(async () => {
      failedXhr.respond(
        503,
        {
          type: "about:blank",
          title: "Service Unavailable",
          status: 503,
          detail: "ingestion unavailable",
          request_id: "req-upload-503",
        },
        { "Content-Type": "application/problem+json", "x-request-id": "req-upload-503" },
      );
    });

    expect(await screen.findByText("req-upload-503")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "技术详情" }));
    expect(screen.getByText("ingestion unavailable")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重试上传" }));
    await vi.waitFor(() => expect(xhrFactory).toHaveBeenCalledTimes(2));
    expect(retryXhr.sendCalls).toBe(1);
    await act(async () => {
      retryXhr.respond(202, { document: documentRecord(), job_id: jobId, task_id: "task-1" });
    });

    expect(await screen.findByText("文件已接收，真实入库任务已创建。")).toBeVisible();
    expect(await screen.findByText("已完成")).toBeVisible();
    expect(window.sessionStorage.getItem("evidence-desk:known-job-ids")).toContain(jobId);
  });
});
