import { isApiError } from "@/api/errors";

export type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export type LocalizedApiError = {
  title: string;
  action: string;
  serverDetail: string | null;
  requestId: string | null;
  status: number | null;
  retryAfterSeconds: number | null;
};

function parseRetryAfter(header: string | null | undefined): number | null {
  if (!header) return null;
  const asInt = Number.parseInt(header, 10);
  if (!Number.isNaN(asInt) && asInt >= 0) return asInt;
  const when = Date.parse(header);
  if (!Number.isNaN(when)) {
    return Math.max(0, Math.ceil((when - Date.now()) / 1000));
  }
  return null;
}

export function localizeApiError(
  t: TranslateFn,
  error: unknown,
  options?: { retryAfterHeader?: string | null },
): LocalizedApiError {
  if (isApiError(error)) {
    const status = error.status;
    const retryAfterSeconds =
      status === 429 ? parseRetryAfter(options?.retryAfterHeader ?? null) : null;
    const retryAfter =
      status === 429
        ? retryAfterSeconds != null
          ? t("errors:retryAfterSeconds", { seconds: retryAfterSeconds })
          : t("errors:retryAfterUnknown")
        : "";

    const title =
      status === 401
        ? t("errors:titleUnauthorized")
        : status === 403
          ? t("errors:titleForbidden")
          : status === 404
            ? t("errors:titleNotFound")
            : status === 409
              ? t("errors:titleConflict")
              : status === 429
                ? t("errors:titleTooManyRequests")
                : status === 503
                  ? t("errors:titleServiceUnavailable")
                  : status >= 500
                    ? t("errors:titleServerError")
                    : status >= 400
                      ? t("errors:titleBadRequest")
                      : t("errors:titleUnknown");

    const action =
      status === 401
        ? t("errors:actionUnauthorized")
        : status === 403
          ? t("errors:actionForbidden")
          : status === 404
            ? t("errors:actionNotFound")
            : status === 409
              ? t("errors:actionConflict")
              : status === 429
                ? t("errors:actionTooManyRequests", { retryAfter })
                : status === 503
                  ? t("errors:actionServiceUnavailable")
                  : status >= 500
                    ? t("errors:actionServerError")
                    : t("errors:actionGeneric");

    return {
      title,
      action,
      serverDetail: error.message || error.problem.detail || null,
      requestId: error.requestId,
      status,
      retryAfterSeconds,
    };
  }

  if (error instanceof Error) {
    return {
      title: t("errors:titleNetwork"),
      action: t("errors:actionNetwork"),
      serverDetail: error.message,
      requestId: null,
      status: null,
      retryAfterSeconds: null,
    };
  }

  return {
    title: t("errors:titleUnknown"),
    action: t("errors:actionGeneric"),
    serverDetail: null,
    requestId: null,
    status: null,
    retryAfterSeconds: null,
  };
}
