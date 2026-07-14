export type SseEvent = {
  event: string;
  data: string;
  id?: string;
  retry?: number;
};

function parseBlock(block: string): SseEvent | null {
  const lines = block.replace(/\r\n|\r/g, "\n").split("\n");
  let event = "message";
  let id: string | undefined;
  let retry: number | undefined;
  const data: string[] = [];

  for (const line of lines) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    switch (field) {
      case "event":
        event = value || "message";
        break;
      case "data":
        data.push(value);
        break;
      case "id":
        if (!value.includes("\0")) id = value;
        break;
      case "retry": {
        const parsed = Number(value);
        if (Number.isInteger(parsed) && parsed >= 0) retry = parsed;
        break;
      }
      default:
        break;
    }
  }

  if (data.length === 0) return null;
  return { event, data: data.join("\n"), id, retry };
}

function nextBoundary(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  const cr = buffer.indexOf("\r\r");
  const matches = [
    lf >= 0 ? { index: lf, length: 2 } : null,
    crlf >= 0 ? { index: crlf, length: 4 } : null,
    cr >= 0 ? { index: cr, length: 2 } : null,
  ].filter((item): item is { index: number; length: number } => item !== null);
  if (matches.length === 0) return null;
  return matches.reduce((best, item) => (item.index < best.index ? item : best));
}

/** Incremental SSE parser that tolerates arbitrary network chunk boundaries. */
export class SseParser {
  private buffer = "";

  feed(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];

    while (true) {
      const boundary = nextBoundary(this.buffer);
      if (!boundary) break;
      const block = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary.length);
      const event = parseBlock(block);
      if (event) events.push(event);
    }

    return events;
  }

  flush(): SseEvent[] {
    const remainder = this.buffer;
    this.buffer = "";
    if (!remainder.trim()) return [];
    const event = parseBlock(remainder);
    return event ? [event] : [];
  }
}
