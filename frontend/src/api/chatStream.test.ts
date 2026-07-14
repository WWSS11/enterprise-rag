import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client";

function streamResponse(parts: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

function byteStreamResponse(parts: Uint8Array[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
  );
}

describe("ApiClient.streamChat", () => {
  it("dispatches stage, token, done, and error event types", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      streamResponse([
        'event: stage\ndata: {"name":"retrieve","status":"completed"}\n\n',
        'event: token\ndata: {"token":"A"}\n\n',
        'event: done\ndata: {"status":"completed"}\n\n',
        'event: error\ndata: {"code":"late_error","message":"bad"}\n\n',
      ]),
    );
    const api = createApiClient({
      baseUrl: "http://api.test",
      getAccessToken: async () => "token",
      renewAccessToken: async () => null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const types: string[] = [];
    await api.streamChat(
      { question: "q", knowledge_base_id: "11111111-1111-4111-8111-111111111111" },
      (event) => types.push(event.type),
      new AbortController().signal,
    );
    expect(types).toEqual(["stage", "token", "done", "error"]);
  });

  it("decodes multibyte tokens split at arbitrary byte boundaries", async () => {
    const bytes = new TextEncoder().encode(
      'event: token\ndata: {"token":"证据"}\n\nevent: done\ndata: {"status":"completed"}\n\n',
    );
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(byteStreamResponse([bytes.slice(0, 31), bytes.slice(31, 32), bytes.slice(32)]));
    const api = createApiClient({
      baseUrl: "http://api.test",
      getAccessToken: async () => "token",
      renewAccessToken: async () => null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const tokens: string[] = [];

    await api.streamChat(
      { question: "q", knowledge_base_id: "11111111-1111-4111-8111-111111111111" },
      (event) => {
        if (event.type === "token") tokens.push(event.payload.token);
      },
      new AbortController().signal,
    );

    expect(tokens).toEqual(["证据"]);
  });

  it("rejects a successful non-SSE response", async () => {
    const api = createApiClient({
      baseUrl: "http://api.test",
      getAccessToken: async () => "token",
      renewAccessToken: async () => null,
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ answer: "not a stream" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ) as unknown as typeof fetch,
    });

    await expect(
      api.streamChat(
        { question: "q", knowledge_base_id: "11111111-1111-4111-8111-111111111111" },
        () => undefined,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("propagates AbortController cancellation", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const rejectAbort = () => reject(new DOMException("Aborted", "AbortError"));
        if (init?.signal?.aborted) {
          rejectAbort();
          return;
        }
        init?.signal?.addEventListener("abort", rejectAbort, { once: true });
      }),
    );
    const api = createApiClient({
      baseUrl: "http://api.test",
      getAccessToken: async () => "token",
      renewAccessToken: async () => null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const controller = new AbortController();
    const promise = api.streamChat(
      { question: "q", knowledge_base_id: "11111111-1111-4111-8111-111111111111" },
      () => undefined,
      controller.signal,
    );
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});
