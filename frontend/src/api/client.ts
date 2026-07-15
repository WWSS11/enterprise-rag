import { config } from "@/config/env";
import { ApiError, parseProblemDetails } from "./errors";
import { SseParser } from "./sse";
import { parseChatStreamEvent, type ChatStreamEvent } from "@/chat/streamEvents";
import {
  currentIdentitySchema,
  healthResponseSchema,
  knowledgeBaseListSchema,
  knowledgeBaseSchema,
  knowledgeBaseCreateSchema,
  documentListSchema,
  documentUploadAcceptedSchema,
  jobSchema,
  chatRequestSchema,
  type CurrentIdentity,
  type HealthResponse,
  type KnowledgeBase,
  type KnowledgeBaseCreate,
  type DocumentRecord,
  type DocumentUploadAccepted,
  type Job,
  type ChatRequest,
} from "./types";

export type AccessTokenProvider = () => Promise<string | null>;
export type TokenRenewer = () => Promise<string | null>;

export type UploadProgress = {
  loaded: number;
  total: number;
  percent: number;
};

export type ApiClientOptions = {
  baseUrl?: string;
  getAccessToken: AccessTokenProvider;
  renewAccessToken: TokenRenewer;
  fetchImpl?: typeof fetch;
  xhrFactory?: () => XMLHttpRequest;
};

function joinUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl ?? config.apiBaseUrl;
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  const xhrFactory = options.xhrFactory ?? (() => new XMLHttpRequest());

  async function request<T>(
    path: string,
    init: RequestInit = {},
    parse: (data: unknown) => T,
    allowAnonymous = false,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json");
    }

    let token = await options.getAccessToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    } else if (!allowAnonymous) {
      throw new ApiError(
        401,
        {
          type: "about:blank",
          title: "Unauthorized",
          status: 401,
          detail: "No access token available. Sign in again.",
        },
        null,
      );
    }

    const execute = async (authHeader: string | null) => {
      const nextHeaders = new Headers(headers);
      if (authHeader) {
        nextHeaders.set("Authorization", authHeader);
      } else {
        nextHeaders.delete("Authorization");
      }
      return fetchImpl(joinUrl(baseUrl, path), {
        ...init,
        headers: nextHeaders,
      });
    };

    let response = await execute(token ? `Bearer ${token}` : null);

    // Exactly one silent renew + retry on 401
    if (response.status === 401 && !allowAnonymous) {
      const renewed = await options.renewAccessToken();
      if (renewed) {
        token = renewed;
        response = await execute(`Bearer ${token}`);
      }
    }

    if (!response.ok) {
      const { problem, requestId } = await parseProblemDetails(response);
      throw new ApiError(response.status, problem, requestId, response.headers.get("Retry-After"));
    }

    if (response.status === 204) {
      return parse(null);
    }

    const data: unknown = await response.json();
    return parse(data);
  }

  async function uploadDocument(
    file: File,
    knowledgeBaseId: string,
    onProgress: (progress: UploadProgress) => void,
    signal: AbortSignal,
  ): Promise<DocumentUploadAccepted> {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const token = await options.getAccessToken();
    if (!token) {
      throw new ApiError(
        401,
        {
          type: "about:blank",
          title: "Unauthorized",
          status: 401,
          detail: "No access token available. Sign in again.",
        },
        null,
      );
    }

    const execute = (accessToken: string, allowRenew: boolean): Promise<DocumentUploadAccepted> =>
      new Promise((resolve, reject) => {
        if (signal.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }

        const xhr = xhrFactory();
        const abort = () => xhr.abort();
        const cleanup = () => signal.removeEventListener("abort", abort);
        signal.addEventListener("abort", abort, { once: true });

        xhr.open("POST", joinUrl(baseUrl, "/api/v1/documents"));
        xhr.setRequestHeader("Accept", "application/json");
        xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
        xhr.upload.onprogress = (event) => {
          const total = event.lengthComputable && event.total > 0 ? event.total : file.size;
          const percent = total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0;
          onProgress({ loaded: event.loaded, total, percent });
        };
        xhr.onerror = () => {
          cleanup();
          reject(new Error("Document upload failed due to a network error."));
        };
        xhr.onabort = () => {
          cleanup();
          reject(new DOMException("Aborted", "AbortError"));
        };
        xhr.onload = () => {
          cleanup();
          void (async () => {
            if (xhr.status === 401 && allowRenew) {
              const renewed = await options.renewAccessToken();
              if (renewed) {
                execute(renewed, false).then(resolve, reject);
                return;
              }
            }

            if (xhr.status < 200 || xhr.status >= 300) {
              const headers = new Headers({
                "Content-Type": xhr.getResponseHeader("Content-Type") ?? "application/json",
              });
              const requestId = xhr.getResponseHeader("x-request-id");
              const retryAfter = xhr.getResponseHeader("Retry-After");
              if (requestId) headers.set("x-request-id", requestId);
              if (retryAfter) headers.set("Retry-After", retryAfter);
              const response = new Response(xhr.responseText || null, {
                status: xhr.status,
                statusText: xhr.statusText,
                headers,
              });
              const parsed = await parseProblemDetails(response);
              reject(new ApiError(xhr.status, parsed.problem, parsed.requestId, retryAfter));
              return;
            }

            try {
              const data: unknown = JSON.parse(xhr.responseText);
              onProgress({ loaded: file.size, total: file.size, percent: 100 });
              resolve(documentUploadAcceptedSchema.parse(data));
            } catch (error) {
              reject(error);
            }
          })();
        };

        const body = new FormData();
        body.append("file", file);
        body.append("knowledge_base_id", knowledgeBaseId);
        xhr.send(body);
      });

    return execute(token, true);
  }

  async function streamChat(
    payload: ChatRequest,
    onEvent: (event: ChatStreamEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const body = chatRequestSchema.parse(payload);
    let token = await options.getAccessToken();
    if (!token) {
      throw new ApiError(
        401,
        {
          type: "about:blank",
          title: "Unauthorized",
          status: 401,
          detail: "No access token available. Sign in again.",
        },
        null,
      );
    }

    const execute = (accessToken: string) =>
      fetchImpl(joinUrl(baseUrl, "/api/v1/chat/stream"), {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
        signal,
      });

    let response = await execute(token);
    if (response.status === 401) {
      const renewed = await options.renewAccessToken();
      if (renewed) {
        token = renewed;
        response = await execute(token);
      }
    }

    if (!response.ok) {
      const { problem, requestId } = await parseProblemDetails(response);
      throw new ApiError(response.status, problem, requestId, response.headers.get("Retry-After"));
    }
    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.toLowerCase().includes("text/event-stream")) {
      throw new ApiError(
        502,
        {
          type: "about:blank",
          title: "Bad Gateway",
          status: 502,
          detail: "Chat stream returned an unexpected content type.",
        },
        response.headers.get("x-request-id"),
      );
    }
    if (!response.body) {
      throw new ApiError(
        503,
        {
          type: "about:blank",
          title: "Service Unavailable",
          status: 503,
          detail: "Streaming response body is unavailable.",
        },
        response.headers.get("x-request-id"),
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();

    const dispatch = (rawEvents: ReturnType<SseParser["feed"]>) => {
      for (const raw of rawEvents) {
        const parsed = parseChatStreamEvent(raw);
        if (parsed) onEvent(parsed);
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        dispatch(parser.feed(decoder.decode(value, { stream: true })));
      }
      dispatch(parser.feed(decoder.decode()));
      dispatch(parser.flush());
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  return {
    getMe(): Promise<CurrentIdentity> {
      return request("/api/v1/auth/me", { method: "GET" }, (data) =>
        currentIdentitySchema.parse(data),
      );
    },

    getLiveHealth(): Promise<HealthResponse> {
      return request(
        "/health/live",
        { method: "GET" },
        (data) => healthResponseSchema.parse(data),
        true,
      );
    },

    getReadyHealth(): Promise<HealthResponse> {
      return request(
        "/health/ready",
        { method: "GET" },
        (data) => healthResponseSchema.parse(data),
        true,
      );
    },

    listKnowledgeBases(): Promise<KnowledgeBase[]> {
      return request("/api/v1/knowledge-bases", { method: "GET" }, (data) =>
        knowledgeBaseListSchema.parse(data),
      );
    },

    createKnowledgeBase(payload: KnowledgeBaseCreate): Promise<KnowledgeBase> {
      const body = knowledgeBaseCreateSchema.parse(payload);
      return request(
        "/api/v1/knowledge-bases",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        (data) => knowledgeBaseSchema.parse(data),
      );
    },

    listDocuments(knowledgeBaseId?: string): Promise<DocumentRecord[]> {
      const query = knowledgeBaseId
        ? `?knowledge_base_id=${encodeURIComponent(knowledgeBaseId)}`
        : "";
      return request(`/api/v1/documents${query}`, { method: "GET" }, (data) =>
        documentListSchema.parse(data),
      );
    },

    getJob(jobId: string): Promise<Job> {
      return request(`/api/v1/jobs/${encodeURIComponent(jobId)}`, { method: "GET" }, (data) =>
        jobSchema.parse(data),
      );
    },

    uploadDocument,
    streamChat,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
