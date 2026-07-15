import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client";
import { ApiError } from "./errors";

const kbId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";

function knowledgeBase() {
  return {
    id: kbId,
    tenant_id: "default",
    slug: "security",
    name: "Security",
    description: null,
    access_mode: "restricted",
    status: "active",
    is_default: false,
    created_by: "user-1",
    created_at: "2026-07-15T00:00:00Z",
    updated_at: "2026-07-15T00:00:00Z",
  };
}

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
    size_bytes: 1024,
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

function jobRecord(status = "queued") {
  return {
    id: jobId,
    document_id: documentId,
    task_id: "task-1",
    job_type: "document_ingestion",
    status,
    progress: status === "succeeded" ? 100 : 0,
    result: {},
    error_message: null,
    created_at: "2026-07-15T00:00:00Z",
    updated_at: "2026-07-15T00:00:00Z",
  };
}

class FakeXhr {
  method = "";
  url = "";
  body: Document | XMLHttpRequestBodyInit | null = null;
  status = 0;
  statusText = "";
  responseText = "";
  requestHeaders = new Map<string, string>();
  responseHeaders = new Map<string, string>();
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.requestHeaders.set(name.toLowerCase(), value);
  }

  getResponseHeader(name: string) {
    return this.responseHeaders.get(name.toLowerCase()) ?? null;
  }

  send(body: Document | XMLHttpRequestBodyInit | null) {
    this.body = body;
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

describe("Knowledge Base Ops API client", () => {
  it("creates a knowledge base and requests real document/job endpoints", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(knowledgeBase()), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([documentRecord()]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(jobRecord()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    const api = createApiClient({
      baseUrl: "http://api.test",
      getAccessToken: async () => "token",
      renewAccessToken: async () => null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await api.createKnowledgeBase({
      slug: "security",
      name: "Security",
      description: null,
      access_mode: "restricted",
    });
    await api.listDocuments(kbId);
    await api.getJob(jobId);

    expect(fetchImpl.mock.calls[0][0]).toBe("http://api.test/api/v1/knowledge-bases");
    expect(fetchImpl.mock.calls[1][0]).toBe(
      `http://api.test/api/v1/documents?knowledge_base_id=${kbId}`,
    );
    expect(fetchImpl.mock.calls[2][0]).toBe(`http://api.test/api/v1/jobs/${jobId}`);
    expect(JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body))).toEqual({
      slug: "security",
      name: "Security",
      description: null,
      access_mode: "restricted",
    });
  });

  it("uploads multipart data, reports byte progress, and parses the accepted job", async () => {
    const xhr = new FakeXhr();
    const api = createApiClient({
      baseUrl: "http://api.test",
      getAccessToken: async () => "token",
      renewAccessToken: async () => null,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      xhrFactory: () => xhr as unknown as XMLHttpRequest,
    });
    const progress = vi.fn();
    const file = new File(["policy"], "policy.pdf", { type: "application/pdf" });
    const promise = api.uploadDocument(file, kbId, progress, new AbortController().signal);

    await vi.waitFor(() => expect(xhr.url).toBe("http://api.test/api/v1/documents"));
    xhr.progress(3, 6);
    xhr.respond(202, { document: documentRecord(), job_id: jobId, task_id: "task-1" });

    await expect(promise).resolves.toMatchObject({ job_id: jobId });
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("http://api.test/api/v1/documents");
    expect(xhr.requestHeaders.get("authorization")).toBe("Bearer token");
    expect(xhr.body).toBeInstanceOf(FormData);
    expect((xhr.body as FormData).get("file")).toBe(file);
    expect((xhr.body as FormData).get("knowledge_base_id")).toBe(kbId);
    expect(progress).toHaveBeenCalledWith({ loaded: 3, total: 6, percent: 50 });
  });

  it("propagates upload cancellation as AbortError", async () => {
    const xhr = new FakeXhr();
    const api = createApiClient({
      baseUrl: "http://api.test",
      getAccessToken: async () => "token",
      renewAccessToken: async () => null,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      xhrFactory: () => xhr as unknown as XMLHttpRequest,
    });
    const controller = new AbortController();
    const promise = api.uploadDocument(
      new File(["policy"], "policy.pdf"),
      kbId,
      () => undefined,
      controller.signal,
    );

    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("maps upload RFC7807 and request_id", async () => {
    const xhr = new FakeXhr();
    const api = createApiClient({
      baseUrl: "http://api.test",
      getAccessToken: async () => "token",
      renewAccessToken: async () => null,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      xhrFactory: () => xhr as unknown as XMLHttpRequest,
    });
    const promise = api.uploadDocument(
      new File(["policy"], "policy.pdf"),
      kbId,
      () => undefined,
      new AbortController().signal,
    );

    await vi.waitFor(() => expect(xhr.url).toBe("http://api.test/api/v1/documents"));
    xhr.respond(
      409,
      {
        type: "about:blank",
        title: "Conflict",
        status: 409,
        detail: "duplicate document",
        request_id: "req-upload-409",
      },
      { "Content-Type": "application/problem+json", "x-request-id": "req-upload-409" },
    );

    await expect(promise).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      requestId: "req-upload-409",
      message: "duplicate document",
    } satisfies Partial<ApiError>);
  });
});
