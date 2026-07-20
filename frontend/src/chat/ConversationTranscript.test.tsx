import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConversationTranscript } from "./ConversationTranscript";
import { renderWithI18n, resetI18n } from "@/test/i18nTestUtils";

describe("ConversationTranscript", () => {
  it("renders complete chronological messages and inspectable historical citations", async () => {
    await resetI18n("zh-CN");
    const onLoadEarlier = vi.fn();
    renderWithI18n(
      <ConversationTranscript
        hasMore
        loading={false}
        error={false}
        onLoadEarlier={onLoadEarlier}
        messages={[
          {
            id: "11111111-1111-4111-8111-111111111111",
            conversation_id: "33333333-3333-4333-8333-333333333333",
            role: "user",
            content: "访问审批规则是什么？",
            citations: [],
            token_usage: {},
            created_at: "2026-07-15T00:00:00Z",
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            conversation_id: "33333333-3333-4333-8333-333333333333",
            role: "assistant",
            content: "需要负责人审批。",
            citations: [{
              document_id: "doc-1",
              document_name: "安全制度.md",
              chunk_id: "chunk-7",
              score: 0.93,
              content_preview: "所有受限访问必须审批。",
            }],
            token_usage: {},
            created_at: "2026-07-15T00:00:01Z",
          },
        ]}
      />,
    );

    expect(screen.getByText("访问审批规则是什么？")).toBeVisible();
    expect(screen.getByText("需要负责人审批。")).toBeVisible();
    const user = userEvent.setup();
    await user.click(screen.getByText("查看 1 条历史引用"));
    expect(screen.getByText("安全制度.md")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "加载更早消息" }));
    expect(onLoadEarlier).toHaveBeenCalledOnce();
  });
});
