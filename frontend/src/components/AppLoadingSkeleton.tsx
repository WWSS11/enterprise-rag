import styles from "./AppLoadingSkeleton.module.css";

export function AppLoadingSkeleton({ label = "Loading…" }: { label?: string }) {
  return (
    <div className={styles.page} role="status" aria-live="polite" aria-busy="true">
      <div className={styles.card}>
        <div className={styles.row}>
          <div className={`${styles.bar} ${styles.barMedium}`} />
          <div className={`${styles.bar} ${styles.barShort}`} />
        </div>
        <div className={styles.block} />
        <div className={styles.row}>
          <div className={`${styles.bar} ${styles.barLong}`} />
          <div className={`${styles.bar} ${styles.barMedium}`} />
        </div>
        <p className={styles.label}>{label}</p>
      </div>
    </div>
  );
}
