import type { ProblemDetails } from "./types";
import { problemDetailsSchema } from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails;
  readonly requestId: string | null;
  readonly retryAfter: string | null;

  constructor(
    status: number,
    problem: ProblemDetails,
    requestId: string | null,
    retryAfter: string | null = null,
  ) {
    super(problem.detail || problem.title || `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
    this.requestId = requestId ?? problem.request_id ?? null;
    this.retryAfter = retryAfter;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export async function parseProblemDetails(
  response: Response,
): Promise<{ problem: ProblemDetails; requestId: string | null }> {
  const headerRequestId = response.headers.get("x-request-id");
  let body: unknown = null;

  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const parsed = problemDetailsSchema.safeParse(body);
  if (parsed.success) {
    return {
      problem: parsed.data,
      requestId: headerRequestId ?? parsed.data.request_id ?? null,
    };
  }

  return {
    problem: {
      type: "about:blank",
      title: response.statusText || "Error",
      status: response.status,
      detail: typeof body === "string" ? body : `Request failed with status ${response.status}`,
      request_id: headerRequestId,
    },
    requestId: headerRequestId,
  };
}

export function formatProblemMessage(problem: ProblemDetails, fallback = "Request failed"): string {
  return problem.detail || problem.title || fallback;
}
