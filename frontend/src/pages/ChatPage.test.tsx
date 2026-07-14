import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthContext, type AuthContextValue } from "@/auth/authContext";
import { createApiClient } from "@/api/client";
import { ChatPage } from "./ChatPage";
import { changeAppLocale } from "@/i18n";
import { renderWithI18n, resetI18n } from "@/test/i18nTestUtils";

const kbId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const staleConversationId = "33333333-3333-4333-8333-333333333333";

function knowledgeBasesResponse(): Response {
  return new Response(
    JSON.stringify([
      {
        id: kbId,
        tenant_id: "default",
        slug: "policy",
        name: "Policy KB",
        description: null,
        access_mode: "tenant",
        status: "active",
        is_default: true,
        created_by: "user-1",
        created_at: "2026-07-14T00:00:00Z",
        updated_at: "2026-07-14T00:00:00Z",
      },
    ]),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function sseResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  });
}

function completedStream(options?: { answer?: string; withEvidence?: boolean }): string {
  const answer = options?.answer ?? "制度要求审批 [来源:安全制度.md#chunk-7]";
  const withEvidence = options?.withEvidence ?? true;
  return [
    `event: metadata\ndata: {"conversation_id":"${conversationId}"}\n\n`,
    'event: stage\ndata: {"name":"rewrite_query","status":"completed"}\n\n',
    'event: stage\ndata: {"name":"retrieve","status":"completed"}\n\n',
    'event: stage\ndata: {"name":"rerank","status":"completed"}\n\n',
    'event: stage\ndata: {"name":"expand_context","status":"completed"}\n\n',
    `event: token\ndata: ${JSON.stringify({ token: answer })}\n\n`,
    `event: metadata\ndata: ${JSON.stringify({
      conversation_id: conversationId,
      rewritten_query: "访问审批制度",
      citations: withEvidence
        ? [
            {
              document_id: "doc-1",
              document_name: "安全制度.md",
              chunk_id: "chunk-7",
              score: 0.93,
              content_preview: "所有受限访问必须由知识库负责人审批。",
            },
          ]
        : [],
      retrieved_count: withEvidence ? 12 : 0,
      reranked_count: withEvidence ? 4 : 0,
      citation_diagnostics: {
        policy_version: "v1",
        markers_seen: withEvidence ? 1 : 0,
        compliant_markers: withEvidence ? 1 : 0,
      },
    })}\n\n`,
    'event: done\ndata: {"status":"completed"}\n\n',
  ].join("");
}

function authValue(fetchImpl: typeof fetch): AuthContextValue {
  const api = createApiClient({
    baseUrl: "http://api.test",
    getAccessToken: async () => "token",
    renewAccessToken: async () => null,
    fetchImpl,
  });
  return {
    status: "authenticated",
    user: null,
    identity: {
      user_id: "user-1",
      tenant_id: "default",
      roles: ["rag-user"],
      groups: ["engineering"],
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

function renderChat(fetchImpl?: typeof fetch) {
  const resolvedFetch =
    fetchImpl ?? (async () => knowledgeBasesResponse()) as unknown as typeof fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithI18n(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={authValue(resolvedFetch)}>
        <MemoryRouter>
          <ChatPage />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

async function submitQuestion(question = "访问需要什么审批？") {
  const user = userEvent.setup();
  await screen.findByRole("option", { name: "Policy KB" });
  await user.type(screen.getByLabelText("问题"), question);
  await user.click(screen.getByRole("button", { name: "发送问题" }));
  return user;
}

describe("ChatPage", () => {
  beforeEach(async () => {
    window.sessionStorage.clear();
    await resetI18n("zh-CN");
  });

  it("keeps the question draft when language changes", async () => {
    const user = userEvent.setup();
    renderChat();

    await screen.findByRole("option", { name: "Policy KB" });
    const question = screen.getByLabelText("问题");
    await user.type(question, "政策是什么？");

    await act(async () => {
      await changeAppLocale("en-US");
    });
    await screen.findByRole("heading", { name: "Chat" });
    expect(screen.getByLabelText("Question")).toHaveValue("政策是什么？");
  });

  it("streams backend stages, metadata, citations, copy, and session continuity", async () => {
    const requests: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/v1/knowledge-bases")) return knowledgeBasesResponse();
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return sseResponse(completedStream());
    }) as unknown as typeof fetch;
    renderChat(fetchImpl);

    const user = await submitQuestion();

    await screen.findByText("回答已完成");
    expect(screen.getByText(/制度要求审批/)).toBeInTheDocument();
    expect(screen.getByText("混合检索")).toBeInTheDocument();
    expect(screen.getByText("初始检索")).toBeInTheDocument();
    expect(screen.getByText("重排保留")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "引用 1" }));
    expect(screen.getByRole("button", { name: "证据 1" })).toBeVisible();
    expect(screen.getByText("所有受限访问必须由知识库负责人审批。")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "复制回答" }));
    expect(await screen.findByText("回答已复制")).toBeVisible();
    expect(requests[0]).toMatchObject({
      question: "访问需要什么审批？",
      knowledge_base_id: kbId,
      conversation_id: null,
    });
    expect(window.sessionStorage.getItem(`evidence-desk:conversation-id:${kbId}`)).toBe(
      conversationId,
    );
  });

  it("labels a completed no-results response as uncited evidence/refusal", async () => {
    const fallback = "未在当前有权访问的知识库中检索到足够相关的资料。请补充更具体的关键词。";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/api/v1/knowledge-bases")
        ? knowledgeBasesResponse()
        : sseResponse(completedStream({ answer: fallback, withEvidence: false })),
    ) as unknown as typeof fetch;
    renderChat(fetchImpl);

    await submitQuestion("不存在的制度是什么？");

    expect(await screen.findByText("回答未附引用证据")).toBeVisible();
    expect(screen.getByText("本次回答未引用证据")).toBeVisible();
    expect(screen.getByText(/未在当前有权访问的知识库/)).toBeVisible();
  });

  it("reports an empty completed response instead of showing the first-run state", async () => {
    const stream = [
      `event: metadata\ndata: {"conversation_id":"${conversationId}"}\n\n`,
      'event: metadata\ndata: {"citations":[],"retrieved_count":0,"reranked_count":0}\n\n',
      'event: done\ndata: {"status":"completed"}\n\n',
    ].join("");
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/api/v1/knowledge-bases")
        ? knowledgeBasesResponse()
        : sseResponse(stream),
    ) as unknown as typeof fetch;
    renderChat(fetchImpl);

    await submitQuestion();

    expect(await screen.findByText("后端未返回回答内容")).toBeVisible();
    expect(screen.getByText("本次回答未引用证据")).toBeVisible();
  });

  it("detects a stream that ends before done and offers retry", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/api/v1/knowledge-bases")
        ? knowledgeBasesResponse()
        : sseResponse('event: token\ndata: {"token":"partial"}\n\n'),
    ) as unknown as typeof fetch;
    renderChat(fetchImpl);

    await submitQuestion();

    expect(await screen.findByText("问答失败")).toBeVisible();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "技术详情" }));
    expect(screen.getByText(/流错误：stream_incomplete/)).toBeVisible();
    expect(screen.getByRole("button", { name: "重试本次问题" })).toBeEnabled();
    expect(screen.getByText("partial")).toBeVisible();
  });

  it("aborts an active stream and exposes stopped recovery controls", async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/v1/knowledge-bases")) {
        return Promise.resolve(knowledgeBasesResponse());
      }
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
      });
    }) as unknown as typeof fetch;
    renderChat(fetchImpl);

    const user = await submitQuestion();
    await user.click(await screen.findByRole("button", { name: "停止生成" }));

    expect(await screen.findByText("生成已停止")).toBeVisible();
    expect(screen.getByRole("button", { name: "重试本次问题" })).toBeEnabled();
  });

  it("clears a stale conversation after 409 and retries as a new conversation", async () => {
    window.sessionStorage.setItem(
      `evidence-desk:conversation-id:${kbId}`,
      staleConversationId,
    );
    const requests: Record<string, unknown>[] = [];
    let postCount = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/v1/knowledge-bases")) return knowledgeBasesResponse();
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      postCount += 1;
      if (postCount === 1) {
        return new Response(JSON.stringify({ detail: "conversation knowledge base mismatch" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }
      return sseResponse(completedStream());
    }) as unknown as typeof fetch;
    renderChat(fetchImpl);

    const user = await submitQuestion();
    expect(await screen.findByText("当前会话与知识库状态冲突")).toBeVisible();
    expect(window.sessionStorage.getItem(`evidence-desk:conversation-id:${kbId}`)).toBeNull();

    await user.click(screen.getByRole("button", { name: "重试本次问题" }));
    await screen.findByText("回答已完成");

    expect(requests[0].conversation_id).toBe(staleConversationId);
    expect(requests[1].conversation_id).toBeNull();
    await waitFor(() =>
      expect(window.sessionStorage.getItem(`evidence-desk:conversation-id:${kbId}`)).toBe(
        conversationId,
      ),
    );
  });
});
