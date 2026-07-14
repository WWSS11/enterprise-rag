import { describe, expect, it, vi, beforeEach } from "vitest";
import { createApiClient } from "./client";
import { ApiError } from "./errors";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
}

describe("createApiClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("attaches bearer token and parses /auth/me", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        user_id: "user-1",
        tenant_id: "default",
        roles: ["rag-user"],
        groups: ["engineering"],
        auth_method: "oidc",
        is_admin: false,
      }),
    );

    const client = createApiClient({
      baseUrl: "http://api.test",
      getAccessToken: async () => "token-1",
      renewAccessToken: async () => null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const me = await client.getMe();
    expect(me.user_id).toBe("user-1");
    expect(me.tenant_id).toBe("default");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer token-1");
  });

  it("renews once on 401 and retries", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            type: "about:blank",
            title: "Unauthorized",
            status: 401,
            detail: "token expired",
            request_id: "req-1",
          },
          { status: 401, headers: { "x-request-id": "req-1", "Content-Type": "application/problem+json" } },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          user_id: "user-1",
          tenant_id: "default",
          roles: [],
          groups: [],
          auth_method: "oidc",
          is_admin: false,
        }),
      );

    const renewAccessToken = vi.fn().mockResolvedValue("token-2");

    const client = createApiClient({
      baseUrl: "http://api.test",
      getAccessToken: async () => "token-1",
      renewAccessToken,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const me = await client.getMe();
    expect(me.user_id).toBe("user-1");
    expect(renewAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondInit = fetchImpl.mock.calls[1][1] as RequestInit;
    expect(new Headers(secondInit.headers).get("Authorization")).toBe("Bearer token-2");
  });

  it("maps RFC7807 problem details with request_id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          type: "about:blank",
          title: "Forbidden",
          status: 403,
          detail: "not allowed",
          request_id: "req-403",
        },
        {
          status: 403,
          headers: {
            "Content-Type": "application/problem+json",
            "x-request-id": "req-403",
          },
        },
      ),
    );

    const client = createApiClient({
      baseUrl: "http://api.test",
      getAccessToken: async () => "token-1",
      renewAccessToken: async () => null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.getMe()).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      requestId: "req-403",
      message: "not allowed",
    } satisfies Partial<ApiError>);
  });

  it("does not retry more than once after failed renew", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          type: "about:blank",
          title: "Unauthorized",
          status: 401,
          detail: "still unauthorized",
        },
        { status: 401 },
      ),
    );

    const renewAccessToken = vi.fn().mockResolvedValue(null);

    const client = createApiClient({
      baseUrl: "http://api.test",
      getAccessToken: async () => "token-1",
      renewAccessToken,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.getMe()).rejects.toBeInstanceOf(ApiError);
    expect(renewAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
