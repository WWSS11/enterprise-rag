import styles from "./StatusPill.module.css";

export type StatusTone = "ok" | "degraded" | "error" | "unknown" | "loading";

type StatusPillProps = {
  tone: StatusTone;
  label: string;
  /** Visible shape marker for color-blind safety */
  marker?: string;
  mono?: boolean;
};

const DEFAULT_MARKERS: Record<StatusTone, string> = {
  ok: "●",
  degraded: "▲",
  error: "■",
  unknown: "○",
  loading: "…",
};

export function StatusPill({ tone, label, marker, mono = false }: StatusPillProps) {
  return (
    <span className={`${styles.root} ${styles[tone]}`} role="status">
      <span className={styles.marker} aria-hidden="true">
        {marker ?? DEFAULT_MARKERS[tone]}
      </span>
      <span className={`${styles.label} ${mono ? styles.mono : ""}`}>{label}</span>
    </span>
  );
}
