import { describe, expect, it } from "vitest";
import { SseParser } from "./sse";

describe("SseParser", () => {
  it("parses events split across arbitrary network chunks", () => {
    const parser = new SseParser();
    const chunks = [
      "eve",
      "nt: stage\r\nda",
      'ta: {"name":"rewrite_query",',
      '"status":"completed"}\r\n\r',
      "\nevent: token\ndata: {\"token\":\"证\"}\n\n",
      "event: token\ndata: {\"token\":\"据\"}\n\n",
      "event: done\ndata: {\"status\":\"completed\"}\n\n",
    ];
    const events = chunks.flatMap((chunk) => parser.feed(chunk));
    events.push(...parser.flush());

    expect(events).toEqual([
      {
        event: "stage",
        data: '{"name":"rewrite_query","status":"completed"}',
        id: undefined,
        retry: undefined,
      },
      { event: "token", data: '{"token":"证"}', id: undefined, retry: undefined },
      { event: "token", data: '{"token":"据"}', id: undefined, retry: undefined },
      { event: "done", data: '{"status":"completed"}', id: undefined, retry: undefined },
    ]);
  });

  it("joins multiline data and ignores comments", () => {
    const parser = new SseParser();
    const [event] = parser.feed(": heartbeat\nevent: message\ndata: line 1\ndata: line 2\n\n");
    expect(event.data).toBe("line 1\nline 2");
  });
});
