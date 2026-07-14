import { I18nextProvider } from "react-i18next";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import i18n, { changeAppLocale, DEFAULT_LOCALE } from "@/i18n";

export async function resetI18n(locale = DEFAULT_LOCALE): Promise<void> {
  await changeAppLocale(locale);
  try {
    window.localStorage.removeItem("evidence-desk:locale");
  } catch {
    // ignore
  }
  if (locale === DEFAULT_LOCALE) {
    document.documentElement.lang = DEFAULT_LOCALE;
  }
}

export function renderWithI18n(ui: ReactElement, options?: RenderOptions) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>, options);
}
