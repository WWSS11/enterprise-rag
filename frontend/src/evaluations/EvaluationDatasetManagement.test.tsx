import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { createApiClient } from "@/api/client";
import type { EvaluationCase, EvaluationDataset } from "@/api/types";
import { AuthContext, type AuthContextValue } from "@/auth/authContext";
import { renderWithI18n } from "@/test/i18nTestUtils";
import { EvaluationCaseBulkImport } from "./EvaluationCaseBulkImport";
import { EvaluationDatasetManager } from "./EvaluationDatasetManager";

const knowledgeBaseId = "11111111-1111-4111-8111-111111111111";
const datasetId = "22222222-2222-4222-8222-222222222222";
const copiedDatasetId = "33333333-3333-4333-8333-333333333333";
const documentId = "44444444-4444-4444-8444-444444444444";
const timestamp = "2026-08-09T00:00:00Z";

function dataset(overrides: Partial<EvaluationDataset> = {}): EvaluationDataset {
  return {
    id: datasetId,
    tenant_id: "default",
    knowledge_base_id: knowledgeBaseId,
    name: "Release gate",
    description: "Stable cases",
    status: "active",
    created_by: "editor-a",
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

function evaluationCase(id: string, shouldRefuse: boolean): EvaluationCase {
  return {
    id,
    dataset_id: datasetId,
    question: shouldRefuse ? "Unknown question" : "Approval question",
    reference_answer: shouldRefuse ? "Cannot answer." : "Approval is required.",
    expected_document_ids: shouldRefuse ? [] : [documentId],
    acceptable_citation_document_ids: shouldRefuse ? [] : [documentId],
    required_key_points: shouldRefuse ? [] : ["Approval"],
    required_key_point_groups: shouldRefuse ? [] : [["Approval"]],
    should_refuse: shouldRefuse,
    tags: [],
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function setup(children: ReactNode, route = `/app/evaluations/datasets/${datasetId}`) {
  const api = createApiClient({
    baseUrl: "http://api.test",
    getAccessToken: async () => "token",
    renewAccessToken: async () => null,
    fetchImpl: vi.fn() as unknown as typeof fetch,
  });
  const auth: AuthContextValue = {
    status: "authenticated",
    user: null,
    identity: {
      user_id: "editor-a",
      tenant_id: "default",
      roles: ["rag-user"],
      groups: [],
      auth_method: "oidc",
      is_admin: false,
    },
    identityError: null,
    isAuthenticated: true,
    api,
    login: async () => undefined,
    logout: async () => undefined,
    completeLogin: async () => undefined,
    renewToken: async () => null,
    getAccessToken: async () => "token",
    refreshIdentity: async () => null,
    hasRole: () => false,
    hasAnyRole: () => false,
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  renderWithI18n(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return api;
}

function LocationProbe() {
  return <output aria-label="pathname">{useLocation().pathname}</output>;
}

describe("Evaluation dataset lifecycle and bulk import", () => {
  it("updates metadata and copies all cases into a new dataset route", async () => {
    const user = userEvent.setup();
    const source = dataset();
    const api = setup(
      <Routes>
        <Route path="/app/evaluations/datasets/:datasetId" element={<><EvaluationDatasetManager dataset={source} /><LocationProbe /></>} />
      </Routes>,
    );
    const update = vi.spyOn(api, "updateEvaluationDataset").mockResolvedValue(
      dataset({ name: "Release gate v2", description: null }),
    );
    const copy = vi.spyOn(api, "copyEvaluationDataset").mockResolvedValue(
      dataset({ id: copiedDatasetId, name: "Release gate v2（副本）" }),
    );

    await user.click(screen.getByRole("button", { name: "修改数据集" }));
    await user.clear(screen.getByLabelText("数据集名称"));
    await user.type(screen.getByLabelText("数据集名称"), "Release gate v2");
    await user.clear(screen.getByLabelText("描述（可选）"));
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    expect(update).toHaveBeenCalledWith(datasetId, {
      name: "Release gate v2",
      description: null,
    });

    await user.click(screen.getByRole("button", { name: "复制数据集" }));
    await user.click(screen.getByRole("button", { name: "创建副本" }));
    expect(copy).toHaveBeenCalledWith(datasetId, {
      name: "Release gate（副本）",
      description: "Stable cases",
    });
    expect(await screen.findByLabelText("pathname")).toHaveTextContent(
      `/app/evaluations/datasets/${copiedDatasetId}`,
    );
  });

  it("requires explicit confirmation before archiving", async () => {
    const user = userEvent.setup();
    const source = dataset();
    const api = setup(
      <Routes>
        <Route path="/app/evaluations/datasets/:datasetId" element={<EvaluationDatasetManager dataset={source} />} />
        <Route path="/app/evaluations" element={<LocationProbe />} />
      </Routes>,
    );
    const archive = vi.spyOn(api, "archiveEvaluationDataset").mockResolvedValue(
      dataset({ status: "archived" }),
    );

    await user.click(screen.getByRole("button", { name: "归档数据集" }));
    expect(archive).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog", { name: "确认归档这个数据集？" });
    await user.click(within(dialog).getByRole("button", { name: "确认归档" }));

    expect(archive).toHaveBeenCalledWith(datasetId);
    expect(await screen.findByLabelText("pathname")).toHaveTextContent("/app/evaluations");
  });

  it("validates an array, previews counts, and imports through the bulk endpoint", async () => {
    const user = userEvent.setup();
    const imported = [
      evaluationCase("55555555-5555-4555-8555-555555555555", false),
      evaluationCase("66666666-6666-4666-8666-666666666666", true),
    ];
    const onImported = vi.fn();
    const api = setup(
      <EvaluationCaseBulkImport datasetId={datasetId} onImported={onImported} />,
    );
    const bulk = vi.spyOn(api, "createEvaluationCasesBulk").mockResolvedValue(imported);
    const payload = [
      {
        question: "Approval question",
        reference_answer: "Approval is required.",
        expected_document_ids: [documentId],
        required_key_points: ["Approval"],
      },
      {
        question: "Unknown question",
        reference_answer: "Cannot answer.",
        should_refuse: true,
      },
    ];

    fireEvent.change(screen.getByLabelText("用例 JSON"), {
      target: { value: JSON.stringify(payload) },
    });
    await user.click(screen.getByRole("button", { name: "校验导入内容" }));
    expect(screen.getByText("校验通过：共 2 条，其中可回答题 1 条、拒答题 1 条。")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "导入 2 条用例" }));

    expect(bulk).toHaveBeenCalledWith(datasetId, { cases: payload });
    expect(await screen.findByText("已成功导入 2 条用例。")).toBeVisible();
    expect(onImported).toHaveBeenCalledWith(2);
  });

  it("rejects invalid JSON before calling the API", async () => {
    const user = userEvent.setup();
    const api = setup(
      <EvaluationCaseBulkImport datasetId={datasetId} onImported={() => undefined} />,
    );
    const bulk = vi.spyOn(api, "createEvaluationCasesBulk");

    await user.type(screen.getByLabelText("用例 JSON"), "not-json");
    await user.click(screen.getByRole("button", { name: "校验导入内容" }));

    expect(screen.getByRole("alert")).toHaveTextContent("JSON 格式无效");
    expect(bulk).not.toHaveBeenCalled();
  });
});
