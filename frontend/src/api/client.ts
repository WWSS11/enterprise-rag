import { config } from "@/config/env";
import { ApiError, parseProblemDetails } from "./errors";
import { SseParser } from "./sse";
import { parseChatStreamEvent, type ChatStreamEvent } from "@/chat/streamEvents";
import {
  currentIdentitySchema,
  healthResponseSchema,
  knowledgeBaseListSchema,
  chatRequestSchema,
  type CurrentIdentity,
  type HealthResponse,
  type KnowledgeBase,
  type ChatRequest,
} from "./types";

export type AccessTokenProvider = () => Promise<string | null>;
export type TokenRenewer = () => Promise<string | null>;

export type ApiClientOptions = {
  baseUrl?: string;
  getAccessToken: AccessTokenProvider;
  renewAccessToken: TokenRenewer;
  fetchImpl?: typeof fetch;
};

function joinUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl ?? config.apiBaseUrl;
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);

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

    streamChat,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
