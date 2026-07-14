import { useTranslation } from "react-i18next";
import { changeAppLocale } from "@/i18n";
import { isAppLocale, type AppLocale } from "@/i18n/localeStorage";
import styles from "./LanguageSwitcher.module.css";

const OPTIONS: { locale: AppLocale; labelKey: "languageChinese" | "languageEnglish" }[] = [
  { locale: "zh-CN", labelKey: "languageChinese" },
  { locale: "en-US", labelKey: "languageEnglish" },
];

type LanguageSwitcherProps = {
  compact?: boolean;
};

export function LanguageSwitcher({ compact = false }: LanguageSwitcherProps) {
  const { t, i18n } = useTranslation("common");
  const current = isAppLocale(i18n.language) ? i18n.language : "zh-CN";

  return (
    <div
      className={`${styles.root} ${compact ? styles.compact : ""}`}
      role="group"
      aria-label={t("languageSwitcher")}
    >
      {!compact ? <span className={styles.label}>{t("language")}</span> : null}
      <div className={styles.options}>
        {OPTIONS.map((option) => {
          const selected = current === option.locale;
          return (
            <button
              key={option.locale}
              type="button"
              className={`${styles.option} ${selected ? styles.selected : ""}`}
              aria-current={selected ? "true" : undefined}
              aria-pressed={selected}
              onClick={() => {
                if (!selected) {
                  void changeAppLocale(option.locale);
                }
              }}
            >
              {t(option.labelKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
