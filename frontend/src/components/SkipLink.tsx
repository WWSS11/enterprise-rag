import { useTranslation } from "react-i18next";

export function SkipLink() {
  const { t } = useTranslation("common");
  return (
    <a className="skip-link" href="#main-content">
      {t("skipToContent")}
    </a>
  );
}
