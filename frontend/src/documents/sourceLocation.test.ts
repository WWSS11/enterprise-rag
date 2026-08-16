import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { sourceLocationLabel } from "./sourceLocation";

describe("sourceLocationLabel", () => {
  it("formats pages, paragraphs, and spreadsheet cell ranges", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(sourceLocationLabel({
      kind: "page",
      page: 7,
      slide: null,
      paragraph_start: null,
      paragraph_end: null,
      sheet: null,
      table: null,
      cell_range: null,
      section_index: 2,
      heading_path: ["第 7 页"],
    }, i18n.t)).toBe("第 7 页");
    expect(sourceLocationLabel({
      kind: "paragraph",
      page: null,
      slide: null,
      paragraph_start: 2,
      paragraph_end: 4,
      sheet: null,
      table: null,
      cell_range: null,
      section_index: 1,
      heading_path: [],
    }, i18n.t)).toBe("第 2～4 段");
    expect(sourceLocationLabel({
      kind: "cell_range",
      page: null,
      slide: null,
      paragraph_start: null,
      paragraph_end: null,
      sheet: "权限矩阵",
      table: null,
      cell_range: "B2:D2",
      section_index: 1,
      heading_path: ["权限矩阵"],
    }, i18n.t)).toBe("权限矩阵 B2:D2");
  });
});
