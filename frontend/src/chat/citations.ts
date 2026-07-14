import type { Citation } from "@/api/types";

export const SOURCE_MARKER = /\[来源:([^#\]\n]+)#([^\]\n]+)\]/g;

export function citationKey(citation: Pick<Citation, "document_name" | "chunk_id">): string {
  return `${citation.document_name}\u0000${citation.chunk_id}`;
}

export function findCitationIndex(
  citations: Citation[],
  documentName: string,
  chunkId: string,
): number {
  const target = `${documentName.trim()}\u0000${chunkId.trim()}`;
  return citations.findIndex((citation) => citationKey(citation) === target);
}

/** Convert exact backend source markers to safe internal Markdown anchors. */
export function linkifyCitationMarkers(answer: string, citations: Citation[]): string {
  return answer.replace(SOURCE_MARKER, (original, documentName: string, chunkId: string) => {
    const index = findCitationIndex(citations, documentName, chunkId);
    return index >= 0 ? `[${index + 1}](#evidence-${index})` : original;
  });
}
