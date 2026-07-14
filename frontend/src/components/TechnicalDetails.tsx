import { useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./TechnicalDetails.module.css";

type TechnicalDetailsProps = {
  detail: string | null | undefined;
};

export function TechnicalDetails({ detail }: TechnicalDetailsProps) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);

  if (!detail) return null;

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? t("hideTechnicalDetails") : t("technicalDetails")}
      </button>
      {open ? <pre className={styles.pre}>{detail}</pre> : null}
    </div>
  );
}
