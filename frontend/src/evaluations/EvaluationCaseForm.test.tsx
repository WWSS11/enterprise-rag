import { act, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { createApiClient } from "@/api/client";
import { ApiError } from "@/api/errors";
import type {
  DocumentRecord,
  EvaluationCase,
  EvaluationCaseCreate,
  EvaluationDataset,
  KnowledgeBase,
} from "@/api/types";
import { AuthContext, type AuthContextValue } from "@/auth/authContext";
import { changeAppLocale } from "@/i18n";
import { EvaluationDatasetPage } from "@/pages/EvaluationDatasetPage";
import { renderWithI18n, resetI18n } from "@/test/i18nTestUtils";
import { EvaluationCaseForm } from "./EvaluationCaseForm";

const knowledgeBaseId = "11111111-1111-4111-8111-111111111111";
const datasetId = "22222222-2222-4222-8222-222222222222";
const readyPolicyId = "33333333-3333-4333-8333-333333333333";
const readyHandbookId = "44444444-4444-4444-8444-444444444444";
const processingDocumentId = "55555555-5555-4555-8555-555555555555";
const failedDocumentId = "66666666-6666-4666-8666-666666666666";
const caseId = "77777777-7777-4777-8777-777777777777";
const timestamp = "2026-07-15T08:30:00+08:00";

function documentRecord(
  id: string,
  name: string,
  status: DocumentRecord["status"] = "ready",
): DocumentRecord {
  return {
    id,
    tenant_id: "default",
    knowledge_base_id: knowledgeBaseId,
    name,
    source_type: "upload",
    source_key: `uploads/${name}`,
    source_uri: `s3://evidence-desk/${name}`,
    source_updated_at: timestamp,
    content_type: "application/pdf",
    size_bytes: 48_512,
    status,
    chunk_count: status === "ready" ? 12 : 0,
    index_version: status === "ready" ? "2026-07-15" : null,
    indexed_at: status === "ready" ? timestamp : null,
    error_message: status === "failed" ? "OCR extraction failed" : null,
    extra_metadata: { department: "legal", retention_class: "controlled" },
    created_at: timestamp,
    updated_at: timestamp,
  };
}

const readyPolicy = documentRecord(readyPolicyId, "retention-policy.pdf");
const readyHandbook = documentRecord(readyHandbookId, "employee-handbook.pdf");
const processingDocument = documentRecord(
  processingDocumentId,
  "processing-draft.pdf",
  "processing",
);
const failedDocument = documentRecord(failedDocumentId, "failed-scan.pdf", "failed");

const knowledgeBase: KnowledgeBase = {
  id: knowledgeBaseId,
  tenant_id: "default",
  slug: "policy-evidence",
  name: "Policy Evidence",
  description: "Controlled enterprise policy sources",
  access_mode: "tenant",
  status: "active",
  is_default: false,
  created_by: "user-1",
  created_at: timestamp,
  updated_at: timestamp,
};

const dataset: EvaluationDataset = {
  id: datasetId,
  tenant_id: "default",
  knowledge_base_id: knowledgeBaseId,
  name: "Retention release gate",
  description: "Evidence-grounded retention questions",
  status: "active",
  created_by: "user-1",
  created_at: timestamp,
  updated_at: timestamp,
};

function createdCase(payload: EvaluationCaseCreate): EvaluationCase {
  return {
    id: caseId,
    dataset_id: datasetId,
    question: payload.question,
    reference_answer: payload.reference_answer,
    expected_document_ids: payload.expected_document_ids ?? [],
    acceptable_citation_document_ids: payload.acceptable_citation_document_ids ?? [],
    required_key_points: payload.required_key_points ?? [],
    required_key_point_groups: payload.required_key_point_groups ?? [],
    should_refuse: payload.should_refuse ?? false,
    tags: payload.tags ?? [],
    created_at: timestamp,
    updated_at: timestamp,
  };
}

type FormOverrides = Partial<{
  readyDocuments: DocumentRecord[];
  submitting: boolean;
  submitError: unknown;
  onSubmit: (payload: EvaluationCaseCreate) => Promise<void>;
}>;

function renderForm(overrides: FormOverrides = {}) {
  const onSubmit = overrides.onSubmit ?? vi.fn(async () => undefined);
  const result = renderWithI18n(
    <EvaluationCaseForm
      readyDocuments={overrides.readyDocuments ?? [readyPolicy, readyHandbook]}
      submitting={overrides.submitting ?? false}
      submitError={overrides.submitError}
      onSubmit={onSubmit}
    />,
  );
  return { ...result, onSubmit };
}

function expectedDocumentsGroup() {
  return screen.getByRole("group", { name: "预期检索文档" });
}

function acceptableDocumentsGroup() {
  return screen.getByRole("group", { name: "可接受引用文档" });
}

function expectedDocumentCheckbox(name: string) {
  return within(expectedDocumentsGroup()).getByRole("checkbox", { name: new RegExp(name) });
}

function acceptableDocumentCheckbox(name: string) {
  return within(acceptableDocumentsGroup()).getByRole("checkbox", {
    name: new RegExp(name),
  });
}

async function completeRequiredAnswerableFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("问题"), "What is the retention period?");
  await user.type(screen.getByLabelText("参考答案"), "Records are retained for seven years.");
  await user.click(expectedDocumentCheckbox(readyPolicy.name));
}

function authValue(api: ReturnType<typeof createApiClient>): AuthContextValue {
  return {
    status: "authenticated",
    user: null,
    identity: {
      user_id: "user-1",
      tenant_id: "default",
      roles: ["rag-user"],
      groups: ["legal"],
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
    hasRole: () => true,
    hasAnyRole: () => true,
  };
}

describe("EvaluationCaseForm", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    await resetI18n("zh-CN");
  });

  it("requires at least one expected document for an answerable case", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.type(screen.getByLabelText("问题"), "What is the retention period?");
    await user.type(screen.getByLabelText("参考答案"), "Seven years.");
    await user.click(screen.getByRole("button", { name: "保存用例" }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("可回答用例至少需要一个预期文档。");
    expect(within(alert).getAllByRole("listitem")).toHaveLength(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("clears document state when changing to refusal and submits empty document arrays", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.click(expectedDocumentCheckbox(readyPolicy.name));
    await user.click(acceptableDocumentCheckbox(readyHandbook.name));
    await user.click(screen.getByRole("radio", { name: /应拒答/ }));

    expect(screen.queryByRole("group", { name: "预期检索文档" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "可接受引用文档" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /可回答/ }));
    expect(expectedDocumentCheckbox(readyPolicy.name)).not.toBeChecked();
    expect(acceptableDocumentCheckbox(readyPolicy.name)).not.toBeChecked();
    expect(acceptableDocumentCheckbox(readyHandbook.name)).not.toBeChecked();

    await user.click(expectedDocumentCheckbox(readyPolicy.name));
    await user.click(acceptableDocumentCheckbox(readyHandbook.name));
    await user.click(screen.getByRole("radio", { name: /应拒答/ }));
    await user.type(screen.getByLabelText("问题"), "Reveal an unsupported employee secret.");
    await user.type(
      screen.getByLabelText("参考答案"),
      "Refuse because the supplied evidence does not support the request.",
    );
    await user.click(screen.getByRole("button", { name: "保存用例" }));

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        question: "Reveal an unsupported employee secret.",
        reference_answer: "Refuse because the supplied evidence does not support the request.",
        expected_document_ids: [],
        acceptable_citation_document_ids: [],
        required_key_points: [],
        required_key_point_groups: [],
        should_refuse: true,
        tags: [],
      });
    });
  });

  it("auto-includes expected documents as disabled acceptable citations", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await completeRequiredAnswerableFields(user);

    const autoIncluded = acceptableDocumentCheckbox(readyPolicy.name);
    expect(autoIncluded).toBeChecked();
    expect(autoIncluded).toBeDisabled();
    expect(acceptableDocumentCheckbox(readyHandbook.name)).not.toBeChecked();

    await user.click(acceptableDocumentCheckbox(readyHandbook.name));
    await user.click(screen.getByRole("button", { name: "保存用例" }));

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          expected_document_ids: [readyPolicyId],
          acceptable_citation_document_ids: [readyPolicyId, readyHandbookId],
        }),
      );
    });
  });

  it.each([
    {
      name: "zero required-key-point anchors",
      required: "retention period",
      groups: "seven years | 7 years",
      message: "每个别名组必须包含且仅包含一个必需关键点。",
    },
    {
      name: "multiple required-key-point anchors",
      required: "retention period\nseven years",
      groups: "retention period | seven years",
      message: "每个别名组必须包含且仅包含一个必需关键点。",
    },
    {
      name: "one anchor repeated across groups",
      required: "retention period",
      groups: "retention period | retention duration\nretention period | seven years",
      message: "同一个必需关键点不能出现在多个别名组中。",
    },
  ])("rejects $name", async ({ required, groups, message }) => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();
    await completeRequiredAnswerableFields(user);
    fireEvent.change(screen.getByLabelText("必需关键点"), { target: { value: required } });
    fireEvent.change(screen.getByLabelText("关键点别名组"), { target: { value: groups } });

    await user.click(screen.getByRole("button", { name: "保存用例" }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(within(alert).getAllByRole("listitem")).toHaveLength(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("parses, trims, deduplicates, submits, and resets a valid case", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    renderForm({ onSubmit });

    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "  What is the retention period?  " },
    });
    fireEvent.change(screen.getByLabelText("参考答案"), {
      target: { value: "  Records are retained for seven years.  " },
    });
    await user.click(expectedDocumentCheckbox(readyPolicy.name));
    await user.click(acceptableDocumentCheckbox(readyHandbook.name));
    fireEvent.change(screen.getByLabelText("必需关键点"), {
      target: { value: "  Seven years\r\n\r\nSeven years\n Applies globally  " },
    });
    fireEvent.change(screen.getByLabelText("关键点别名组"), {
      target: {
        value:
          " Seven years | 7 years | 7 years \r\n Applies globally | worldwide | worldwide ",
      },
    });
    fireEvent.change(screen.getByLabelText("标签"), {
      target: { value: " retention\r\ncritical\nretention\n  " },
    });

    await user.click(screen.getByRole("button", { name: "保存用例" }));

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        question: "What is the retention period?",
        reference_answer: "Records are retained for seven years.",
        expected_document_ids: [readyPolicyId],
        acceptable_citation_document_ids: [readyPolicyId, readyHandbookId],
        required_key_points: ["Seven years", "Applies globally"],
        required_key_point_groups: [
          ["Seven years", "7 years"],
          ["Applies globally", "worldwide"],
        ],
        should_refuse: false,
        tags: ["retention", "critical"],
      });
    });

    expect(screen.getByLabelText("问题")).toHaveValue("");
    expect(screen.getByLabelText("参考答案")).toHaveValue("");
    expect(screen.getByLabelText("必需关键点")).toHaveValue("");
    expect(screen.getByLabelText("关键点别名组")).toHaveValue("");
    expect(screen.getByLabelText("标签")).toHaveValue("");
    expect(screen.getByRole("radio", { name: /可回答/ })).toBeChecked();
    expect(expectedDocumentCheckbox(readyPolicy.name)).not.toBeChecked();
    expect(acceptableDocumentCheckbox(readyPolicy.name)).not.toBeChecked();
    expect(acceptableDocumentCheckbox(readyHandbook.name)).not.toBeChecked();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("preserves form state and renders the mutation error when onSubmit rejects", async () => {
    const user = userEvent.setup();
    const error = new ApiError(
      503,
      {
        type: "about:blank",
        title: "Service Unavailable",
        status: 503,
        detail: "evaluation case storage is unavailable",
        request_id: "req-case-503",
      },
      "req-case-503",
    );
    const submitted = vi.fn();

    function RejectingForm() {
      const [submitError, setSubmitError] = useState<unknown>();
      return (
        <EvaluationCaseForm
          readyDocuments={[readyPolicy, readyHandbook]}
          submitting={false}
          submitError={submitError}
          onSubmit={async (payload) => {
            submitted(payload);
            setSubmitError(error);
            throw error;
          }}
        />
      );
    }

    renderWithI18n(<RejectingForm />);
    await completeRequiredAnswerableFields(user);
    await user.type(screen.getByLabelText("标签"), "retention");
    await user.click(screen.getByRole("button", { name: "保存用例" }));

    await vi.waitFor(() => expect(submitted).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("heading", { name: "服务暂不可用" })).toBeVisible();
    expect(screen.getByText("req-case-503")).toBeVisible();
    expect(screen.getByLabelText("问题")).toHaveValue("What is the retention period?");
    expect(screen.getByLabelText("参考答案")).toHaveValue(
      "Records are retained for seven years.",
    );
    expect(expectedDocumentCheckbox(readyPolicy.name)).toBeChecked();
    expect(screen.getByLabelText("标签")).toHaveValue("retention");
  });

  it("renders a localized submit error with request and technical details", async () => {
    const user = userEvent.setup();
    const error = new ApiError(
      422,
      {
        type: "urn:rag-study-helper:validation-error",
        title: "Unprocessable Entity",
        status: 422,
        detail: "expected document does not belong to this dataset knowledge base",
        request_id: "req-case-422",
      },
      "req-case-422",
    );

    renderForm({ submitError: error });

    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("heading", { name: "请求无效" })).toBeVisible();
    expect(within(alert).getByText("req-case-422")).toBeVisible();
    expect(
      within(alert).queryByText("expected document does not belong to this dataset knowledge base"),
    ).not.toBeInTheDocument();

    await user.click(within(alert).getByRole("button", { name: "技术详情" }));
    expect(
      within(alert).getByText("expected document does not belong to this dataset knowledge base"),
    ).toBeVisible();
  });

  it("preserves the current form state across zh-CN and en-US locale switches", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("问题"), "保留期限是多少？");
    await user.type(screen.getByLabelText("参考答案"), "记录保留七年。");
    await user.click(expectedDocumentCheckbox(readyPolicy.name));
    await user.click(acceptableDocumentCheckbox(readyHandbook.name));
    await user.type(screen.getByLabelText("必需关键点"), "七年");
    await user.type(screen.getByLabelText("关键点别名组"), "七年 | 7 年");
    await user.type(screen.getByLabelText("标签"), "retention");

    await act(async () => {
      await changeAppLocale("en-US");
    });

    expect(await screen.findByLabelText("Question")).toHaveValue("保留期限是多少？");
    expect(screen.getByLabelText("Reference answer")).toHaveValue("记录保留七年。");
    expect(screen.getByLabelText("Required key points")).toHaveValue("七年");
    expect(screen.getByLabelText("Key-point alias groups")).toHaveValue("七年 | 7 年");
    expect(screen.getByLabelText("Tags")).toHaveValue("retention");
    const expectedGroupEn = screen.getByRole("group", { name: "Expected retrieval documents" });
    const acceptableGroupEn = screen.getByRole("group", { name: "Acceptable citation documents" });
    expect(
      within(expectedGroupEn).getByRole("checkbox", { name: new RegExp(readyPolicy.name) }),
    ).toBeChecked();
    expect(
      within(acceptableGroupEn).getByRole("checkbox", { name: new RegExp(readyPolicy.name) }),
    ).toBeDisabled();
    expect(
      within(acceptableGroupEn).getByRole("checkbox", { name: new RegExp(readyHandbook.name) }),
    ).toBeChecked();

    await act(async () => {
      await changeAppLocale("zh-CN");
    });

    expect(await screen.findByLabelText("问题")).toHaveValue("保留期限是多少？");
    expect(screen.getByLabelText("参考答案")).toHaveValue("记录保留七年。");
    expect(expectedDocumentCheckbox(readyPolicy.name)).toBeChecked();
    expect(acceptableDocumentCheckbox(readyHandbook.name)).toBeChecked();
  });

  it("offers and submits only ready documents through the dataset page contract", async () => {
    const user = userEvent.setup();
    const api = createApiClient({
      baseUrl: "http://api.test",
      getAccessToken: async () => "token",
      renewAccessToken: async () => null,
    });
    vi.spyOn(api, "getEvaluationDataset").mockResolvedValue(dataset);
    vi.spyOn(api, "listKnowledgeBases").mockResolvedValue([knowledgeBase]);
    vi.spyOn(api, "listEvaluationCases").mockResolvedValue([]);
    vi.spyOn(api, "listDocuments").mockResolvedValue([
      readyPolicy,
      processingDocument,
      readyHandbook,
      failedDocument,
    ]);
    const createCase = vi
      .spyOn(api, "createEvaluationCase")
      .mockImplementation(async (_requestedDatasetId, payload) => createdCase(payload));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderWithI18n(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={authValue(api)}>
          <MemoryRouter initialEntries={[`/app/evaluations/datasets/${datasetId}`]}>
            <Routes>
              <Route
                path="/app/evaluations/datasets/:datasetId"
                element={<EvaluationDatasetPage />}
              />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    expect(await screen.findAllByText(readyPolicy.name)).toHaveLength(2);
    const expectedGroup = screen.getByRole("group", { name: "预期检索文档" });
    expect(within(expectedGroup).getByText(readyHandbook.name)).toBeVisible();
    expect(within(expectedGroup).queryByText(processingDocument.name)).not.toBeInTheDocument();
    expect(within(expectedGroup).queryByText(failedDocument.name)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("问题"), "What is the retention period?");
    await user.type(screen.getByLabelText("参考答案"), "Seven years.");
    await user.click(
      within(expectedGroup).getByRole("checkbox", { name: new RegExp(readyPolicy.name) }),
    );
    await user.click(screen.getByRole("button", { name: "保存用例" }));

    await vi.waitFor(() => {
      expect(createCase).toHaveBeenCalledWith(datasetId, {
        question: "What is the retention period?",
        reference_answer: "Seven years.",
        expected_document_ids: [readyPolicyId],
        acceptable_citation_document_ids: [readyPolicyId],
        required_key_points: [],
        required_key_point_groups: [],
        should_refuse: false,
        tags: [],
      });
    });
    expect(JSON.stringify(createCase.mock.calls[0][1])).not.toContain(processingDocumentId);
    expect(JSON.stringify(createCase.mock.calls[0][1])).not.toContain(failedDocumentId);
  });
});
