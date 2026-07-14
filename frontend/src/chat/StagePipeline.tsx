import { useTranslation } from "react-i18next";
import type { ChatStage } from "@/api/types";
import styles from "./StagePipeline.module.css";

export type StageStatus = "pending" | "active" | "completed" | "error" | "stopped";

const STAGES: ChatStage[] = [
  "rewrite_query",
  "hybrid_retrieve",
  "rerank",
  "expand_context",
  "generate",
];

const LABEL_KEYS: Record<ChatStage, string> = {
  rewrite_query: "stageRewrite",
  hybrid_retrieve: "stageRetrieve",
  rerank: "stageRerank",
  expand_context: "stageExpand",
  generate: "stageGenerate",
};

const STATUS_KEYS: Record<StageStatus, string> = {
  pending: "stagePending",
  active: "stageActive",
  completed: "stageCompleted",
  error: "stageError",
  stopped: "stageStopped",
};

export function StagePipeline({ stages }: { stages: Record<ChatStage, StageStatus> }) {
  const { t } = useTranslation("chat");

  return (
    <section className={styles.root} aria-labelledby="chat-stages-title">
      <h2 id="chat-stages-title" className={styles.title}>
        {t("stagesTitle")}
      </h2>
      <ol className={styles.list}>
        {STAGES.map((stage, index) => {
          const status = stages[stage];
          return (
            <li
              key={stage}
              className={`${styles.item} ${styles[status]}`}
              aria-current={status === "active" ? "step" : undefined}
            >
              <span className={styles.marker} aria-hidden="true">
                {status === "completed"
                  ? "✓"
                  : status === "error"
                    ? "×"
                    : status === "stopped"
                      ? "■"
                      : index + 1}
              </span>
              <span className={styles.name}>{t(LABEL_KEYS[stage])}</span>
              <span className={styles.status}>{t(STATUS_KEYS[status])}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
