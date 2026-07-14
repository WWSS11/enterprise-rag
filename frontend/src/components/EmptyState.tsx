import { useId, type ReactNode } from "react";
import styles from "./EmptyState.module.css";

type EmptyStateProps = {
  kicker?: string;
  title: string;
  description: string;
  nextSteps?: string[];
  note?: string;
  actions?: ReactNode;
  titleId?: string;
  /** Use page-level heading hierarchy (default h1). */
  headingLevel?: 1 | 2;
};

export function EmptyState({
  kicker,
  title,
  description,
  nextSteps,
  note,
  actions,
  titleId,
  headingLevel = 1,
}: EmptyStateProps) {
  const autoId = useId();
  const headingId = titleId ?? autoId;
  const HeadingTag = headingLevel === 1 ? "h1" : "h2";

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      {kicker ? <div className={styles.kicker}>{kicker}</div> : null}
      <div className={styles.header}>
        <HeadingTag id={headingId} className={styles.title}>
          {title}
        </HeadingTag>
      </div>
      <p className={styles.description}>{description}</p>
      {nextSteps && nextSteps.length > 0 ? (
        <ul className={styles.list}>
          {nextSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      ) : null}
      {note ? <p className={styles.note}>{note}</p> : null}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </section>
  );
}
