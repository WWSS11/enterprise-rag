const PREFIX = "evidence-desk:conversation-id:";

function key(knowledgeBaseId: string): string {
  return `${PREFIX}${knowledgeBaseId}`;
}

export function readConversationId(knowledgeBaseId: string): string | null {
  try {
    return window.sessionStorage.getItem(key(knowledgeBaseId));
  } catch {
    return null;
  }
}

export function writeConversationId(knowledgeBaseId: string, conversationId: string): void {
  try {
    window.sessionStorage.setItem(key(knowledgeBaseId), conversationId);
  } catch {
    // Session continuity is optional; never fall back to localStorage.
  }
}

export function clearConversationId(knowledgeBaseId: string): void {
  try {
    window.sessionStorage.removeItem(key(knowledgeBaseId));
  } catch {
    // ignore
  }
}
