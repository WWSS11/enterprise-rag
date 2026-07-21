import { config } from "@/config/env";
import { ApiError, parseProblemDetails } from "./errors";
import { SseParser } from "./sse";
import { parseChatStreamEvent, type ChatStreamEvent } from "@/chat/streamEvents";
import {
  currentIdentitySchema,
  healthResponseSchema,
  knowledgeBaseListSchema,
  knowledgeBaseSchema,
  knowledgeBaseCreateSchema,
  knowledgeBaseUpdateSchema,
  knowledgeBaseMemberSchema,
  knowledgeBaseMemberListSchema,
  knowledgeBasePermissionSchema,
  knowledgeBaseMemberUpsertSchema,
  documentListSchema,
  documentUploadAcceptedSchema,
  localScanRequestSchema,
  jobSchema,
  jobPageSchema,
  conversationSchema,
  conversationPageSchema,
  chatMessagePageSchema,
  auditLogPageSchema,
  chatRequestSchema,
  evaluationDatasetCreateSchema,
  evaluationDatasetListSchema,
  evaluationDatasetSchema,
  evaluationCaseBulkCreateSchema,
  evaluationCaseCreateSchema,
  evaluationCaseListSchema,
  evaluationCasePageSchema,
  evaluationCaseSchema,
  evaluationRunCreateSchema,
  evaluationRunSchema,
  evaluationRunPageSchema,
  evaluationReportSchema,
  evaluationRunComparisonRequestSchema,
  evaluationRunComparisonSchema,
  evaluationQualityGateRequestSchema,
  evaluationQualityGateReportSchema,
  type CurrentIdentity,
  type HealthResponse,
  type KnowledgeBase,
  type KnowledgeBaseCreate,
  type KnowledgeBaseUpdate,
  type KnowledgeBaseMember,
  type KnowledgeBaseMemberUpsert,
  type KnowledgeBasePermission,
  type DocumentRecord,
  type DocumentUploadAccepted,
  type LocalScanRequest,
  type Job,
  type JobPage,
  type Conversation,
  type ConversationPage,
  type ChatMessagePage,
  type AuditLogPage,
  type ChatRequest,
  type EvaluationDataset,
  type EvaluationDatasetCreate,
  type EvaluationCase,
  type EvaluationCaseBulkCreate,
  type EvaluationCaseCreate,
  type EvaluationCasePage,
  type EvaluationCaseUpdate,
  type EvaluationRun,
  type EvaluationRunCreate,
  type EvaluationRunPage,
  type EvaluationReport,
  type EvaluationRunComparison,
  type EvaluationRunComparisonRequest,
  type EvaluationQualityGateRequest,
  type EvaluationQualityGateResult,
} from "./types";

export type AccessTokenProvider = () => Promise<string | null>;
export type TokenRenewer = () => Promise<string | null>;

export type UploadProgress = {
  loaded: number;
  total: number;
  percent: number;
};

export type ApiClientOptions = {
  baseUrl?: string;
  getAccessToken: AccessTokenProvider;
  renewAccessToken: TokenRenewer;
  fetchImpl?: typeof fetch;
  xhrFactory?: () => XMLHttpRequest;
};

function joinUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function withQuery(path: string, values: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl ?? config.apiBaseUrl;
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  const xhrFactory = options.xhrFactory ?? (() => new XMLHttpRequest());

  async function requestWithMetadata<T>(
    path: string,
    init: RequestInit = {},
    parse: (data: unknown) => T,
    allowAnonymous = false,
  ): Promise<{ data: T; requestId: string | null }> {
    const headers = new Headers(init.headers);
    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json");
    }

    let token = await options.getAccessToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    } else if (!allowAnonymous) {
      throw new ApiError(
        401,
        {
          type: "about:blank",
          title: "Unauthorized",
          status: 401,
          detail: "No access token available. Sign in again.",
        },
        null,
      );
    }

    const execute = async (authHeader: string | null) => {
      const nextHeaders = new Headers(headers);
      if (authHeader) {
        nextHeaders.set("Authorization", authHeader);
      } else {
        nextHeaders.delete("Authorization");
      }
      return fetchImpl(joinUrl(baseUrl, path), {
        ...init,
        headers: nextHeaders,
      });
    };

    let response = await execute(token ? `Bearer ${token}` : null);

    // Exactly one silent renew + retry on 401
    if (response.status === 401 && !allowAnonymous) {
      const renewed = await options.renewAccessToken();
      if (renewed) {
        token = renewed;
        response = await execute(`Bearer ${token}`);
      }
    }

    if (!response.ok) {
      const { problem, requestId } = await parseProblemDetails(response);
      throw new ApiError(response.status, problem, requestId, response.headers.get("Retry-After"));
    }

    const requestId = response.headers.get("x-request-id");
    if (response.status === 204) {
      return { data: parse(null), requestId };
    }

    const responseData: unknown = await response.json();
    return { data: parse(responseData), requestId };
  }

  async function request<T>(
    path: string,
    init: RequestInit = {},
    parse: (data: unknown) => T,
    allowAnonymous = false,
  ): Promise<T> {
    const response = await requestWithMetadata(path, init, parse, allowAnonymous);
    return response.data;
  }

  async function uploadDocument(
    file: File,
    knowledgeBaseId: string,
    onProgress: (progress: UploadProgress) => void,
    signal: AbortSignal,
  ): Promise<DocumentUploadAccepted> {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const token = await options.getAccessToken();
    if (!token) {
      throw new ApiError(
        401,
        {
          type: "about:blank",
          title: "Unauthorized",
          status: 401,
          detail: "No access token available. Sign in again.",
        },
        null,
      );
    }

    const execute = (accessToken: string, allowRenew: boolean): Promise<DocumentUploadAccepted> =>
      new Promise((resolve, reject) => {
        if (signal.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }

        const xhr = xhrFactory();
        const abort = () => xhr.abort();
        const cleanup = () => signal.removeEventListener("abort", abort);
        signal.addEventListener("abort", abort, { once: true });

        xhr.open("POST", joinUrl(baseUrl, "/api/v1/documents"));
        xhr.setRequestHeader("Accept", "application/json");
        xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
        xhr.upload.onprogress = (event) => {
          const total = event.lengthComputable && event.total > 0 ? event.total : file.size;
          const percent = total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0;
          onProgress({ loaded: event.loaded, total, percent });
        };
        xhr.onerror = () => {
          cleanup();
          reject(new Error("Document upload failed due to a network error."));
        };
        xhr.onabort = () => {
          cleanup();
          reject(new DOMException("Aborted", "AbortError"));
        };
        xhr.onload = () => {
          cleanup();
          void (async () => {
            if (xhr.status === 401 && allowRenew) {
              const renewed = await options.renewAccessToken();
              if (renewed) {
                execute(renewed, false).then(resolve, reject);
                return;
              }
            }

            if (xhr.status < 200 || xhr.status >= 300) {
              const headers = new Headers({
                "Content-Type": xhr.getResponseHeader("Content-Type") ?? "application/json",
              });
              const requestId = xhr.getResponseHeader("x-request-id");
              const retryAfter = xhr.getResponseHeader("Retry-After");
              if (requestId) headers.set("x-request-id", requestId);
              if (retryAfter) headers.set("Retry-After", retryAfter);
              const response = new Response(xhr.responseText || null, {
                status: xhr.status,
                statusText: xhr.statusText,
                headers,
              });
              const parsed = await parseProblemDetails(response);
              reject(new ApiError(xhr.status, parsed.problem, parsed.requestId, retryAfter));
              return;
            }

            try {
              const data: unknown = JSON.parse(xhr.responseText);
              onProgress({ loaded: file.size, total: file.size, percent: 100 });
              resolve(documentUploadAcceptedSchema.parse(data));
            } catch (error) {
              reject(error);
            }
          })();
        };

        const body = new FormData();
        body.append("file", file);
        body.append("knowledge_base_id", knowledgeBaseId);
        xhr.send(body);
      });

    return execute(token, true);
  }

  async function streamChat(
    payload: ChatRequest,
    onEvent: (event: ChatStreamEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const body = chatRequestSchema.parse(payload);
    let token = await options.getAccessToken();
    if (!token) {
      throw new ApiError(
        401,
        {
          type: "about:blank",
          title: "Unauthorized",
          status: 401,
          detail: "No access token available. Sign in again.",
        },
        null,
      );
    }

    const execute = (accessToken: string) =>
      fetchImpl(joinUrl(baseUrl, "/api/v1/chat/stream"), {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
        signal,
      });

    let response = await execute(token);
    if (response.status === 401) {
      const renewed = await options.renewAccessToken();
      if (renewed) {
        token = renewed;
        response = await execute(token);
      }
    }

    if (!response.ok) {
      const { problem, requestId } = await parseProblemDetails(response);
      throw new ApiError(response.status, problem, requestId, response.headers.get("Retry-After"));
    }
    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.toLowerCase().includes("text/event-stream")) {
      throw new ApiError(
        502,
        {
          type: "about:blank",
          title: "Bad Gateway",
          status: 502,
          detail: "Chat stream returned an unexpected content type.",
        },
        response.headers.get("x-request-id"),
      );
    }
    if (!response.body) {
      throw new ApiError(
        503,
        {
          type: "about:blank",
          title: "Service Unavailable",
          status: 503,
          detail: "Streaming response body is unavailable.",
        },
        response.headers.get("x-request-id"),
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();

    const dispatch = (rawEvents: ReturnType<SseParser["feed"]>) => {
      for (const raw of rawEvents) {
        const parsed = parseChatStreamEvent(raw);
        if (parsed) onEvent(parsed);
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        dispatch(parser.feed(decoder.decode(value, { stream: true })));
      }
      dispatch(parser.feed(decoder.decode()));
      dispatch(parser.flush());
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  return {
    getMe(): Promise<CurrentIdentity> {
      return request("/api/v1/auth/me", { method: "GET" }, (data) =>
        currentIdentitySchema.parse(data),
      );
    },

    getLiveHealth(): Promise<HealthResponse> {
      return request(
        "/health/live",
        { method: "GET" },
        (data) => healthResponseSchema.parse(data),
        true,
      );
    },

    getReadyHealth(): Promise<HealthResponse> {
      return request(
        "/health/ready",
        { method: "GET" },
        (data) => healthResponseSchema.parse(data),
        true,
      );
    },

    listKnowledgeBases(options: { includeArchived?: boolean } = {}): Promise<KnowledgeBase[]> {
      const path = withQuery("/api/v1/knowledge-bases", {
        include_archived: options.includeArchived ? "true" : undefined,
      });
      return request(path, { method: "GET" }, (data) =>
        knowledgeBaseListSchema.parse(data),
      );
    },

    getKnowledgeBase(knowledgeBaseId: string): Promise<KnowledgeBase> {
      return request(
        `/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`,
        { method: "GET" },
        (data) => knowledgeBaseSchema.parse(data),
      );
    },

    createKnowledgeBase(payload: KnowledgeBaseCreate): Promise<KnowledgeBase> {
      const body = knowledgeBaseCreateSchema.parse(payload);
      return request(
        "/api/v1/knowledge-bases",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        (data) => knowledgeBaseSchema.parse(data),
      );
    },

    updateKnowledgeBase(
      knowledgeBaseId: string,
      payload: KnowledgeBaseUpdate,
    ): Promise<KnowledgeBase> {
      const body = knowledgeBaseUpdateSchema.parse(payload);
      return request(
        `/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        (data) => knowledgeBaseSchema.parse(data),
      );
    },

    archiveKnowledgeBase(knowledgeBaseId: string): Promise<KnowledgeBase> {
      return request(
        `/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/archive`,
        { method: "POST" },
        (data) => knowledgeBaseSchema.parse(data),
      );
    },

    restoreKnowledgeBase(knowledgeBaseId: string): Promise<KnowledgeBase> {
      return request(
        `/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/restore`,
        { method: "POST" },
        (data) => knowledgeBaseSchema.parse(data),
      );
    },

    upsertKnowledgeBaseMember(
      knowledgeBaseId: string,
      payload: KnowledgeBaseMemberUpsert,
    ): Promise<KnowledgeBaseMember> {
      const body = knowledgeBaseMemberUpsertSchema.parse(payload);
      return request(
        `/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/members`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        (data) => knowledgeBaseMemberSchema.parse(data),
      );
    },

    listKnowledgeBaseMembers(knowledgeBaseId: string): Promise<KnowledgeBaseMember[]> {
      return request(
        `/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/members`,
        { method: "GET" },
        (data) => knowledgeBaseMemberListSchema.parse(data),
      );
    },

    deleteKnowledgeBaseMember(knowledgeBaseId: string, memberId: string): Promise<void> {
      return request(
        `/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/members/${encodeURIComponent(memberId)}`,
        { method: "DELETE" },
        () => undefined,
      );
    },

    getKnowledgeBasePermission(knowledgeBaseId: string): Promise<KnowledgeBasePermission> {
      return request(
        `/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/permissions/me`,
        { method: "GET" },
        (data) => knowledgeBasePermissionSchema.parse(data),
      );
    },

    listDocuments(knowledgeBaseId?: string): Promise<DocumentRecord[]> {
      const query = knowledgeBaseId
        ? `?knowledge_base_id=${encodeURIComponent(knowledgeBaseId)}`
        : "";
      return request(`/api/v1/documents${query}`, { method: "GET" }, (data) =>
        documentListSchema.parse(data),
      );
    },

    scanDocuments(payload: LocalScanRequest): Promise<Job> {
      const body = localScanRequestSchema.parse(payload);
      return request(
        "/api/v1/documents/scan",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        (data) => jobSchema.parse(data),
      );
    },

    reindexDocument(documentId: string): Promise<Job> {
      return request(
        `/api/v1/documents/${encodeURIComponent(documentId)}/reindex`,
        { method: "POST" },
        (data) => jobSchema.parse(data),
      );
    },

    deleteDocument(documentId: string): Promise<Job> {
      return request(
        `/api/v1/documents/${encodeURIComponent(documentId)}`,
        { method: "DELETE" },
        (data) => jobSchema.parse(data),
      );
    },

    getJob(jobId: string): Promise<Job> {
      return request(`/api/v1/jobs/${encodeURIComponent(jobId)}`, { method: "GET" }, (data) =>
        jobSchema.parse(data),
      );
    },

    listJobs(filters: {
      status?: string;
      jobType?: string;
      knowledgeBaseId?: string;
      limit?: number;
      offset?: number;
    } = {}): Promise<JobPage> {
      const path = withQuery("/api/v1/jobs", {
        status: filters.status,
        job_type: filters.jobType,
        knowledge_base_id: filters.knowledgeBaseId,
        limit: filters.limit,
        offset: filters.offset,
      });
      return request(path, { method: "GET" }, (data) => jobPageSchema.parse(data));
    },

    rebuildIndex(): Promise<Job> {
      return request(
        "/api/v1/jobs/rebuild-index",
        { method: "POST" },
        (data) => jobSchema.parse(data),
      );
    },

    listEvaluationDatasets(): Promise<EvaluationDataset[]> {
      return request("/api/v1/evaluations/datasets", { method: "GET" }, (data) =>
        evaluationDatasetListSchema.parse(data),
      );
    },

    createEvaluationDataset(payload: EvaluationDatasetCreate): Promise<EvaluationDataset> {
      const body = evaluationDatasetCreateSchema.parse(payload);
      return request(
        "/api/v1/evaluations/datasets",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        (data) => evaluationDatasetSchema.parse(data),
      );
    },

    getEvaluationDataset(datasetId: string): Promise<EvaluationDataset> {
      return request(
        `/api/v1/evaluations/datasets/${encodeURIComponent(datasetId)}`,
        { method: "GET" },
        (data) => evaluationDatasetSchema.parse(data),
      );
    },

    createEvaluationCase(
      datasetId: string,
      payload: EvaluationCaseCreate,
    ): Promise<EvaluationCase> {
      const body = evaluationCaseCreateSchema.parse(payload);
      return request(
        `/api/v1/evaluations/datasets/${encodeURIComponent(datasetId)}/cases`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        (data) => evaluationCaseSchema.parse(data),
      );
    },

    createEvaluationCasesBulk(
      datasetId: string,
      payload: EvaluationCaseBulkCreate,
    ): Promise<EvaluationCase[]> {
      const body = evaluationCaseBulkCreateSchema.parse(payload);
      return request(
        `/api/v1/evaluations/datasets/${encodeURIComponent(datasetId)}/cases/bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        (data) => evaluationCaseListSchema.parse(data),
      );
    },

    listEvaluationCases(
      datasetId: string,
      filters: {
        query?: string;
        shouldRefuse?: boolean;
        limit?: number;
        offset?: number;
      } = {},
    ): Promise<EvaluationCasePage> {
      const path = withQuery(
        `/api/v1/evaluations/datasets/${encodeURIComponent(datasetId)}/cases`,
        {
          q: filters.query,
          should_refuse:
            filters.shouldRefuse === undefined ? undefined : String(filters.shouldRefuse),
          limit: filters.limit,
          offset: filters.offset,
        },
      );
      return request(
        path,
        { method: "GET" },
        (data) => evaluationCasePageSchema.parse(data),
      );
    },

    updateEvaluationCase(
      datasetId: string,
      caseId: string,
      payload: EvaluationCaseUpdate,
    ): Promise<EvaluationCase> {
      const body = evaluationCaseCreateSchema.parse(payload);
      return request(
        `/api/v1/evaluations/datasets/${encodeURIComponent(datasetId)}/cases/${encodeURIComponent(caseId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        (data) => evaluationCaseSchema.parse(data),
      );
    },

    deleteEvaluationCase(datasetId: string, caseId: string): Promise<void> {
      return request(
        `/api/v1/evaluations/datasets/${encodeURIComponent(datasetId)}/cases/${encodeURIComponent(caseId)}`,
        { method: "DELETE" },
        () => undefined,
      );
    },

    createEvaluationRun(payload: EvaluationRunCreate): Promise<EvaluationRun> {
      const body = evaluationRunCreateSchema.parse(payload);
      return request(
        "/api/v1/evaluations/runs",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        (data) => evaluationRunSchema.parse(data),
      );
    },

    getEvaluationRun(runId: string): Promise<EvaluationRun> {
      return request(
        `/api/v1/evaluations/runs/${encodeURIComponent(runId)}`,
        { method: "GET" },
        (data) => evaluationRunSchema.parse(data),
      );
    },

    listEvaluationRuns(filters: {
      datasetId?: string;
      status?: string;
      limit?: number;
      offset?: number;
    } = {}): Promise<EvaluationRunPage> {
      const path = withQuery("/api/v1/evaluations/runs", {
        dataset_id: filters.datasetId,
        status: filters.status,
        limit: filters.limit,
        offset: filters.offset,
      });
      return request(path, { method: "GET" }, (data) => evaluationRunPageSchema.parse(data));
    },

    listConversations(filters: {
      knowledgeBaseId?: string;
      status?: string;
      limit?: number;
      offset?: number;
    } = {}): Promise<ConversationPage> {
      const path = withQuery("/api/v1/conversations", {
        knowledge_base_id: filters.knowledgeBaseId,
        status: filters.status,
        limit: filters.limit,
        offset: filters.offset,
      });
      return request(path, { method: "GET" }, (data) => conversationPageSchema.parse(data));
    },

    listConversationMessages(
      conversationId: string,
      filters: { limit?: number; offset?: number; fromLatest?: boolean } = {},
    ): Promise<ChatMessagePage> {
      const path = withQuery(
        `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          limit: filters.limit,
          offset: filters.offset,
          from_latest:
            filters.fromLatest === undefined ? undefined : String(filters.fromLatest),
        },
      );
      return request(path, { method: "GET" }, (data) => chatMessagePageSchema.parse(data));
    },

    updateConversation(conversationId: string, title: string): Promise<Conversation> {
      return request(
        `/api/v1/conversations/${encodeURIComponent(conversationId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        },
        (data) => conversationSchema.parse(data),
      );
    },

    archiveConversation(conversationId: string): Promise<Conversation> {
      return request(
        `/api/v1/conversations/${encodeURIComponent(conversationId)}/archive`,
        { method: "POST" },
        (data) => conversationSchema.parse(data),
      );
    },

    restoreConversation(conversationId: string): Promise<Conversation> {
      return request(
        `/api/v1/conversations/${encodeURIComponent(conversationId)}/restore`,
        { method: "POST" },
        (data) => conversationSchema.parse(data),
      );
    },

    listAuditLogs(filters: {
      action?: string;
      resourceType?: string;
      resourceId?: string;
      userId?: string;
      limit?: number;
      offset?: number;
    } = {}): Promise<AuditLogPage> {
      const path = withQuery("/api/v1/audit-logs", {
        action: filters.action,
        resource_type: filters.resourceType,
        resource_id: filters.resourceId,
        user_id: filters.userId,
        limit: filters.limit,
        offset: filters.offset,
      });
      return request(path, { method: "GET" }, (data) => auditLogPageSchema.parse(data));
    },

    getEvaluationRunReport(runId: string): Promise<EvaluationReport> {
      return request(
        `/api/v1/evaluations/runs/${encodeURIComponent(runId)}/report`,
        { method: "GET" },
        (data) => evaluationReportSchema.parse(data),
      );
    },

    recalculateEvaluationRun(runId: string): Promise<EvaluationRun> {
      return request(
        `/api/v1/evaluations/runs/${encodeURIComponent(runId)}/recalculate`,
        { method: "POST" },
        (data) => evaluationRunSchema.parse(data),
      );
    },

    compareEvaluationRuns(
      candidateRunId: string,
      payload: EvaluationRunComparisonRequest,
    ): Promise<EvaluationRunComparison> {
      const body = evaluationRunComparisonRequestSchema.parse(payload);
      return request(
        `/api/v1/evaluations/runs/${encodeURIComponent(candidateRunId)}/compare`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        (data) => evaluationRunComparisonSchema.parse(data),
      );
    },

    async gateEvaluationRun(
      candidateRunId: string,
      payload: EvaluationQualityGateRequest,
    ): Promise<EvaluationQualityGateResult> {
      const body = evaluationQualityGateRequestSchema.parse(payload);
      try {
        const response = await requestWithMetadata(
          `/api/v1/evaluations/runs/${encodeURIComponent(candidateRunId)}/gate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
          (data) => evaluationQualityGateReportSchema.parse(data),
        );
        return { report: response.data, request_id: response.requestId, conflict: false };
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          const report = evaluationQualityGateReportSchema.safeParse(error.problem.data);
          if (report.success) {
            return {
              report: report.data,
              request_id: error.requestId,
              conflict: true,
            };
          }
        }
        throw error;
      }
    },

    uploadDocument,
    streamChat,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
