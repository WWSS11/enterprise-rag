import type { TFunction } from "i18next";
import type { SourceLocation } from "@/api/types";

export function sourceLocationLabel(
  location: SourceLocation | null | undefined,
  t: TFunction,
): string {
  if (!location) return t("documents:locationUnknown");
  if (location.kind === "page" && location.page) {
    return t("documents:locationPage", { page: location.page });
  }
  if (location.kind === "slide" && location.slide) {
    return t("documents:locationSlide", { slide: location.slide });
  }
  if (location.kind === "paragraph" && location.paragraph_start) {
    const end = location.paragraph_end ?? location.paragraph_start;
    return end === location.paragraph_start
      ? t("documents:locationParagraph", { start: location.paragraph_start })
      : t("documents:locationParagraphRange", {
          start: location.paragraph_start,
          end,
        });
  }
  if (location.kind === "cell_range" && location.cell_range) {
    return t("documents:locationCell", {
      container: location.sheet ?? location.table ?? "",
      range: location.cell_range,
    }).trim();
  }
  if (location.heading_path.length > 0) {
    return t("documents:locationSection", {
      heading: location.heading_path.join(" › "),
    });
  }
  if (location.section_index !== null) {
    return t("documents:locationSectionIndex", {
      section: location.section_index + 1,
    });
  }
  return t("documents:locationUnknown");
}
