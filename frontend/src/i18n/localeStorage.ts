/** Project-specific locale preference key — never used for auth tokens. */
export const LOCALE_STORAGE_KEY = "evidence-desk:locale";

export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "zh-CN";

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return value === "zh-CN" || value === "en-US";
}

export function readStoredLocale(): AppLocale | null {
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isAppLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeStoredLocale(locale: AppLocale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // ignore quota / private mode
  }
}

export function resolveInitialLocale(): AppLocale {
  return readStoredLocale() ?? DEFAULT_LOCALE;
}

export function applyDocumentLang(locale: AppLocale): void {
  document.documentElement.lang = locale;
}
