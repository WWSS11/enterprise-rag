import type { AppLocale } from "./localeStorage";
import type { TranslateFn } from "./apiError";

export function formatRoleLabel(t: TranslateFn, role: string): string {
  if (role === "rag-admin") return t("auth:roleAdmin");
  if (role === "rag-user") return t("auth:roleUser");
  return t("auth:roleUnknown", { role });
}

export function formatNumber(locale: AppLocale, value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatPercent(locale: AppLocale, value: number, digits = 1): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(value);
}

export function formatDateTime(locale: AppLocale, value: Date | number | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatLatencyMs(locale: AppLocale, ms: number): string {
  if (ms < 1000) {
    return `${formatNumber(locale, Math.round(ms))} ms`;
  }
  return `${formatNumber(locale, ms / 1000, { maximumFractionDigits: 2 })} s`;
}
