import { describe, expect, it } from "vitest";
import { parseChatStreamEvent } from "./streamEvents";

describe("parseChatStreamEvent", () => {
  it.each([
    ["stage", '{"name":"rerank","status":"completed"}', "stage"],
    ["token", '{"token":"hello"}', "token"],
    ["done", '{"status":"completed"}', "done"],
    ["error", '{"code":"rag_stream_failed","message":"failed"}', "error"],
  ])("parses %s events", (event, data, expected) => {
    expect(parseChatStreamEvent({ event, data })?.type).toBe(expected);
  });

  it("normalizes the backend retrieve node to the hybrid retrieval UI stage", () => {
    expect(
      parseChatStreamEvent({
        event: "stage",
        data: '{"name":"retrieve","status":"completed"}',
      }),
    ).toEqual({
      type: "stage",
      payload: { name: "hybrid_retrieve", status: "completed" },
    });
  });

  it("rejects unknown stages instead of inventing them", () => {
    expect(
      parseChatStreamEvent({ event: "stage", data: '{"name":"unknown","status":"completed"}' }),
    ).toBeNull();
  });
});
