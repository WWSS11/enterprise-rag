import type { ErrorsDict } from "../zh-CN/errors";

export const errorsEn = {
  forbiddenCode: "403",
  forbiddenTitle: "Access denied",
  forbiddenBody:
    "Your current identity does not have permission for this resource. Authorization is decided from /api/v1/auth/me (roles, groups, admin), not from client guesswork.",
  notFoundCode: "404",
  notFoundTitle: "Page not found",
  notFoundBody:
    "That route is not part of Evidence Desk. Use the sidebar to reach Chat, knowledge bases, documents, evaluations, jobs, or system status.",
  boundaryTitle: "Something broke in the console",
  boundaryBody:
    "The application hit an unexpected client error. Your session was not logged. Reload to recover, or return after the page resets.",
  reloadApp: "Reload app",
  tryContinue: "Try continue",
  titleUnauthorized: "Unauthorized",
  titleForbidden: "Forbidden",
  titleNotFound: "Not found",
  titleConflict: "Conflict",
  titleTooManyRequests: "Too many requests",
  titleServiceUnavailable: "Service unavailable",
  titleBadRequest: "Bad request",
  titleServerError: "Server error",
  titleNetwork: "Network error",
  titleUnknown: "Request failed",
  actionUnauthorized: "Sign in again and retry.",
  actionForbidden: "Ask a knowledge-base owner or administrator for access.",
  actionNotFound: "Check the path or return to an available page.",
  actionConflict: "Refresh state and resolve the conflict (HTTP 409).",
  actionTooManyRequests: "Please wait before retrying. {{retryAfter}}",
  actionServiceUnavailable: "A dependency is temporarily unavailable. Try again later.",
  actionServerError: "Retry later; if it persists, share the request_id with support.",
  actionNetwork: "Check your network connection and retry.",
  actionGeneric: "Please try again later.",
  retryAfterSeconds: "Suggested wait: about {{seconds}} seconds.",
  retryAfterUnknown: "Please try again later.",
} as const satisfies ErrorsDict;
