import type { EvidenceDict } from "../zh-CN/evidence";

export const evidenceEn = {
  title: "Citation evidence",
  subtitle: "Real sources explicitly cited by the answer. Select evidence to locate its answer marker.",
  emptyTitle: "No citation evidence yet",
  emptyDetail: "After a completed answer, this desk shows the documents, chunks, and previews returned by the API.",
  noEvidenceTitle: "This response cited no evidence",
  noEvidenceDetail: "The backend completed the response without citation sources. This usually means retrieval found insufficient material or the system refused to answer; do not treat it as evidence-backed.",
  document: "Document",
  chunk: "Chunk",
  score: "Relevance",
  preview: "Evidence preview",
  locateInAnswer: "Locate in answer",
  closeDrawer: "Close citation evidence",
  openDrawer: "Open citation evidence",
  evidenceItem: "Evidence {{index}}",
  citationInAnswer: "Citation {{index}}",
  unmatchedMarker: "An answer marker could not be matched to returned evidence",
  sourceCount: "{{count}} real sources",
  retrievedCount: "Initially retrieved",
  rerankedCount: "Retained after rerank",
  diagnostics: "Citation diagnostics",
} as const satisfies EvidenceDict;
