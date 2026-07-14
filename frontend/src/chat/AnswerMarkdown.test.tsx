import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { AnswerMarkdown } from "./AnswerMarkdown";
import { renderWithI18n } from "@/test/i18nTestUtils";

describe("AnswerMarkdown safety", () => {
  it("does not render raw HTML or remote images", () => {
    const { container } = renderWithI18n(
      <AnswerMarkdown
        answer={'Safe **text** <script>alert(1)</script> <img src="https://evil.test/x">'}
        citations={[]}
        activeCitation={null}
        onCitationSelect={() => undefined}
      />,
    );
    expect(screen.getByText("text")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders safe links and strips unsafe URL protocols", () => {
    const { container } = renderWithI18n(
      <AnswerMarkdown
        answer={"[safe](https://docs.example.test) [unsafe](javascript:alert(1))"}
        citations={[]}
        activeCitation={null}
        onCitationSelect={() => undefined}
      />,
    );
    expect(screen.getByRole("link", { name: "safe" })).toHaveAttribute(
      "href",
      "https://docs.example.test",
    );
    expect(screen.queryByRole("link", { name: "unsafe" })).toBeNull();
    expect(container.querySelector('[href^="javascript:"]')).toBeNull();
  });
});
