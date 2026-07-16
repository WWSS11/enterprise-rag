import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { zhCN } from "./locales/zh-CN";
import { enUS } from "./locales/en-US";
import {
  DEFAULT_LOCALE,
  applyDocumentLang,
  resolveInitialLocale,
  type AppLocale,
  writeStoredLocale,
} from "./localeStorage";

export type { AppLocale } from "./localeStorage";
export {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  isAppLocale,
  readStoredLocale,
  writeStoredLocale,
  resolveInitialLocale,
  applyDocumentLang,
} from "./localeStorage";

export const defaultNS = "common" as const;
export const ns = [
  "common",
  "auth",
  "navigation",
  "system",
  "errors",
  "chat",
  "evidence",
  "knowledgeBases",
  "documents",
  "jobs",
  "evaluations",
  "evaluationCases",
  "evaluationRuns",
  "qualityGates",
] as const;

void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": zhCN,
    "en-US": enUS,
  },
  lng: typeof window !== "undefined" ? resolveInitialLocale() : DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  defaultNS,
  ns: [...ns],
  interpolation: {
    escapeValue: false,
  },
  returnNull: false,
  // Missing keys fall back to key path for visibility in tests/dev.
  saveMissing: false,
  react: {
    useSuspense: false,
  },
});

if (typeof window !== "undefined") {
  applyDocumentLang((i18n.language as AppLocale) || DEFAULT_LOCALE);
  i18n.on("languageChanged", (lng) => {
    if (lng === "zh-CN" || lng === "en-US") {
      applyDocumentLang(lng);
      writeStoredLocale(lng);
    }
  });
}

export async function changeAppLocale(locale: AppLocale): Promise<void> {
  await i18n.changeLanguage(locale);
}

export { i18n };
export default i18n;
