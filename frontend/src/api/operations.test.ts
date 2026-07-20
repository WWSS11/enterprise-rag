import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client";
import { ApiError } from "./errors";

const kbId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";
const conversationId = "55555555-5555-4555-8555-555555555555";

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

  it("uses the real scan, reindex, delete, rebuild, and member-upsert contracts", async () => {
    const member = {
      id: "44444444-4444-4444-8444-444444444444",
      knowledge_base_id: kbId,
      principal_type: "group",
      principal_id: "engineering",
      permission: "editor",
      created_at: "2026-07-15T00:00:00Z",
      updated_at: "2026-07-15T00:00:00Z",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = url.includes("/members")
        ? member
        : {
            ...jobRecord(),
            job_type: url.includes("rebuild-index")
              ? "vector_index_rebuild"
              : url.includes("/scan")
                ? "local_document_scan"
                : url.includes("/reindex")
                  ? "document_reindex"
                  : "document_deletion",
          };
      return new Response(JSON.stringify(body), {
        status: init?.method === "PUT" ? 200 : 202,
        headers: { "Content-Type": "application/json" },
      });
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const api = createApiClient({
      baseUrl: "http://api.test",
      getAccessToken: async () => "token",
      renewAccessToken: async () => null,
      fetchImpl,
    });

    await api.scanDocuments({ root_alias: "policies", knowledge_base_id: kbId });
    await api.reindexDocument(documentId);
    await api.deleteDocument(documentId);
    await api.rebuildIndex();
    await api.upsertKnowledgeBaseMember(kbId, {
      principal_type: "group",
      principal_id: "engineering",
      permission: "editor",
    });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "http://api.test/api/v1/documents/scan",
      `http://api.test/api/v1/documents/${documentId}/reindex`,
      `http://api.test/api/v1/documents/${documentId}`,
      "http://api.test/api/v1/jobs/rebuild-index",
      `http://api.test/api/v1/knowledge-bases/${kbId}/members`,
    ]);
    expect(fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method)).toEqual([
      "POST",
      "POST",
      "DELETE",
      "POST",
      "PUT",
    ]);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      root_alias: "policies",
      knowledge_base_id: kbId,
    });
    expect(JSON.parse(String((fetchMock.mock.calls[4][1] as RequestInit).body))).toEqual({
      principal_type: "group",
      principal_id: "engineering",
      permission: "editor",
    });
  });

  it("uses real knowledge-base lifecycle and member-revocation contracts", async () => {
    const memberId = "44444444-4444-4444-8444-444444444444";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("include_archived=true")) {
        return new Response(JSON.stringify([knowledgeBase()]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return new Response(JSON.stringify(knowledgeBase()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const api = createApiClient({
      baseUrl: "http://api.test",
      getAccessToken: async () => "token",
      renewAccessToken: async () => null,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await api.listKnowledgeBases({ includeArchived: true });
    await api.getKnowledgeBase(kbId);
    await api.updateKnowledgeBase(kbId, {
      name: "Security policies",
      description: null,
      access_mode: "tenant",
    });
    await api.archiveKnowledgeBase(kbId);
    await api.restoreKnowledgeBase(kbId);
    await api.deleteKnowledgeBaseMember(kbId, memberId);

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "http://api.test/api/v1/knowledge-bases?include_archived=true",
      `http://api.test/api/v1/knowledge-bases/${kbId}`,
      `http://api.test/api/v1/knowledge-bases/${kbId}`,
      `http://api.test/api/v1/knowledge-bases/${kbId}/archive`,
      `http://api.test/api/v1/knowledge-bases/${kbId}/restore`,
      `http://api.test/api/v1/knowledge-bases/${kbId}/members/${memberId}`,
    ]);
    expect(fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method)).toEqual([
      "GET", "GET", "PATCH", "POST", "POST", "DELETE",
    ]);
    expect(JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body))).toEqual({
      name: "Security policies",
      description: null,
      access_mode: "tenant",
    });
  });

  it("uses server conversation history, rename, archive, and restore contracts", async () => {
    const conversation = {
      id: conversationId,
      knowledge_base_id: kbId,
      title: "Security review",
      status: "active",
      created_at: "2026-07-15T00:00:00Z",
      updated_at: "2026-07-15T00:00:00Z",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input).includes("/messages")) {
        return new Response(JSON.stringify({
          items: [], total: 0, limit: 50, offset: 0, has_more: false,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(conversation), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const api = createApiClient({
      baseUrl: "http://api.test",
      getAccessToken: async () => "token",
      renewAccessToken: async () => null,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await api.listConversationMessages(conversationId, {
      limit: 50,
      offset: 50,
      fromLatest: true,
    });
    await api.updateConversation(conversationId, "Security review");
    await api.archiveConversation(conversationId);
    await api.restoreConversation(conversationId);

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `http://api.test/api/v1/conversations/${conversationId}/messages?limit=50&offset=50&from_latest=true`,
      `http://api.test/api/v1/conversations/${conversationId}`,
      `http://api.test/api/v1/conversations/${conversationId}/archive`,
      `http://api.test/api/v1/conversations/${conversationId}/restore`,
    ]);
    expect(fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method)).toEqual([
      "GET", "PATCH", "POST", "POST",
    ]);
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({
      title: "Security review",
    });
  });
});
