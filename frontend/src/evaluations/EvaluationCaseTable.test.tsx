import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EvaluationCase } from "@/api/types";
import { renderWithI18n, resetI18n } from "@/test/i18nTestUtils";
import { EvaluationCaseTable } from "./EvaluationCaseTable";

const evaluationCase: EvaluationCase = {
  id: "11111111-1111-4111-8111-111111111111",
  dataset_id: "22222222-2222-4222-8222-222222222222",
  question: "访问审批规则是什么？",
  reference_answer: "所有受限访问都需要负责人审批。",
  expected_document_ids: ["33333333-3333-4333-8333-333333333333"],
  acceptable_citation_document_ids: ["33333333-3333-4333-8333-333333333333"],
  required_key_points: ["负责人审批"],
  required_key_point_groups: [["负责人审批", "owner approval"]],
  should_refuse: false,
  tags: ["访问控制"],
  created_at: "2026-07-20T00:00:00Z",
  updated_at: "2026-07-20T01:00:00Z",
};

describe("EvaluationCaseTable", () => {
  it("expands ground truth and exposes explicit edit/delete actions", async () => {
    await resetI18n("zh-CN");
    const onEdit = vi.fn();
    const onRequestDelete = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderWithI18n(
      <EvaluationCaseTable
        items={[evaluationCase]}
        offset={10}
        canEdit
        confirmingCaseId={null}
        deletingCaseId={null}
        onEdit={onEdit}
        onRequestDelete={onRequestDelete}
        onCancelDelete={() => undefined}
        onConfirmDelete={() => undefined}
      />,
    );

    expect(screen.getByText("11")).toBeVisible();
    await user.click(screen.getByRole("button", { name: evaluationCase.question }));
    expect(screen.getByText(evaluationCase.reference_answer)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "编辑" }));
    expect(onEdit).toHaveBeenCalledWith(evaluationCase);
    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(onRequestDelete).toHaveBeenCalledWith(evaluationCase.id);

    rerender(
      <EvaluationCaseTable
        items={[evaluationCase]}
        offset={10}
        canEdit
        confirmingCaseId={evaluationCase.id}
        deletingCaseId={null}
        onEdit={onEdit}
        onRequestDelete={onRequestDelete}
        onCancelDelete={() => undefined}
        onConfirmDelete={() => undefined}
      />,
    );
    expect(screen.getByRole("group", { name: "确认删除评测用例" })).toBeVisible();
  });
});
