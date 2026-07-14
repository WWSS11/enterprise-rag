import { describe, expect, it } from "vitest";
import type { Citation } from "@/api/types";
import { findCitationIndex, linkifyCitationMarkers } from "./citations";

const citations: Citation[] = [
  {
    document_id: "doc-1",
    document_name: "安全手册.md",
    chunk_id: "chunk-7",
    score: 0.91,
    content_preview: "证据预览",
  },
];

describe("citation mapping", () => {
  it("maps exact source marker to returned citation", () => {
    expect(findCitationIndex(citations, "安全手册.md", "chunk-7")).toBe(0);
    expect(linkifyCitationMarkers("结论 [来源:安全手册.md#chunk-7]", citations)).toBe(
      "结论 [1](#evidence-0)",
    );
  });

  it("preserves unmatched markers without guessing", () => {
    const marker = "[来源:安全手册.md#chunk-999]";
    expect(linkifyCitationMarkers(marker, citations)).toBe(marker);
  });
});
