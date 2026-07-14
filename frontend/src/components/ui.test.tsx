import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";
import { StatusPill } from "./StatusPill";
import { RequestId } from "./RequestId";
import { renderWithI18n, resetI18n } from "@/test/i18nTestUtils";
import { beforeEach } from "vitest";

beforeEach(async () => {
  await resetI18n("zh-CN");
});

describe("EmptyState", () => {
  it("renders honest empty content without fabricated metrics", () => {
    renderWithI18n(
      <EmptyState
        title="Chat"
        description="No conversations are fabricated here."
        nextSteps={["Connect a knowledge base"]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByText(/No conversations are fabricated/i)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});

describe("StatusPill", () => {
  it("pairs tone with a visible marker", () => {
    renderWithI18n(<StatusPill tone="ok" label="API live" />);
    expect(screen.getByRole("status")).toHaveTextContent("API live");
    expect(screen.getByRole("status")).toHaveTextContent("●");
  });
});

describe("RequestId", () => {
  it("renders mono request id and copy control", () => {
    renderWithI18n(<RequestId requestId="abc-123" />);
    expect(screen.getByText("abc-123")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /复制请求 ID|Copy request ID/i })).toBeInTheDocument();
  });

  it("renders nothing without request id", () => {
    const { container } = renderWithI18n(<RequestId requestId={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
