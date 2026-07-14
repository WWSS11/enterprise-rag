import { beforeEach, describe, expect, it } from "vitest";
import {
  clearConversationId,
  readConversationId,
  writeConversationId,
} from "./conversationStorage";

describe("conversation storage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it("stores conversation_id only in sessionStorage", () => {
    const kb = "11111111-1111-4111-8111-111111111111";
    const conversation = "22222222-2222-4222-8222-222222222222";
    writeConversationId(kb, conversation);
    expect(readConversationId(kb)).toBe(conversation);
    expect([...Array(window.localStorage.length)].map((_, i) => window.localStorage.key(i))).toEqual([]);
    clearConversationId(kb);
    expect(readConversationId(kb)).toBeNull();
  });
});
