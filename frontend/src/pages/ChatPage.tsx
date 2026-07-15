import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ChatStage, Citation } from "@/api/types";
import { isApiError } from "@/api/errors";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/Button";
import { RequestId } from "@/components/RequestId";
import { TechnicalDetails } from "@/components/TechnicalDetails";
import { AnswerMarkdown } from "@/chat/AnswerMarkdown";
import { EvidenceDesk } from "@/chat/EvidenceDesk";
import { StagePipeline, type StageStatus } from "@/chat/StagePipeline";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type { ChatStreamEvent, ChatStreamMetadata } from "@/chat/streamEvents";
import {
  clearConversationId,
  readConversationId,
  writeConversationId,
} from "@/chat/conversationStorage";
import styles from "./ChatPage.module.css";

const formSchema = z.object({
  knowledgeBaseId: z.string().uuid(),
  question: z.string().trim().min(1).max(8000),
});

type FormValues = z.infer<typeof formSchema>;
type RunStatus = "idle" | "streaming" | "completed" | "stopped" | "error";
type CompletionKind = "grounded" | "no_evidence" | "empty" | null;

const STAGE_ORDER: ChatStage[] = [
  "rewrite_query",
  "hybrid_retrieve",
  "rerank",
  "expand_context",
  "generate",
];

function initialStages(): Record<ChatStage, StageStatus> {
  return {
    rewrite_query: "pending",
    hybrid_retrieve: "pending",
    rerank: "pending",
    expand_context: "pending",
    generate: "pending",
  };
}

function updateCompletedStage(
  previous: Record<ChatStage, StageStatus>,
  stage: ChatStage,
): Record<ChatStage, StageStatus> {
  const next = { ...previous, [stage]: "completed" as const };
  const index = STAGE_ORDER.indexOf(stage);
  const following = STAGE_ORDER[index + 1];
  if (following && next[following] === "pending") next[following] = "active";
  return next;
}

function updateActiveStage(
  previous: Record<ChatStage, StageStatus>,
  stage: ChatStage,
): Record<ChatStage, StageStatus> {
  return previous[stage] === "pending" ? { ...previous, [stage]: "active" } : previous;
}

function finishActiveStages(
  previous: Record<ChatStage, StageStatus>,
  status: "error" | "stopped",
): Record<ChatStage, StageStatus> {
  return Object.fromEntries(
    Object.entries(previous).map(([stage, value]) => [stage, value === "active" ? status : value]),
  ) as Record<ChatStage, StageStatus>;
}

class ChatStreamProtocolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ChatStreamProtocolError";
    this.code = code;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function ChatPage() {
  const { t } = useTranslation(["chat", "evidence", "common"]);
  const { api } = useAuth();
  const [searchParams] = useSearchParams();
  const requestedKnowledgeBaseId = searchParams.get("knowledge_base_id");
  const appliedKnowledgeBaseParam = useRef<string | null>(null);
  const [activeController, setActiveController] = useState<AbortController | null>(null);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [completionKind, setCompletionKind] = useState<CompletionKind>(null);
  const [answer, setAnswer] = useState("");
  const [submittedQuestion, setSubmittedQuestion] = useState("");
  const [rewrittenQuery, setRewrittenQuery] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [streamMetadata, setStreamMetadata] = useState<ChatStreamMetadata>({});
  const [stages, setStages] = useState(initialStages);
  const [runError, setRunError] = useState<unknown>(null);
  const [lastRequest, setLastRequest] = useState<FormValues | null>(null);
  const [activeCitation, setActiveCitation] = useState<number | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const mobileEvidence = useMediaQuery("(max-width: 780px)");
  const [copyNotice, setCopyNotice] = useState(false);

  const knowledgeBases = useQuery({
    queryKey: ["knowledge-bases", "chat-selector"],
    queryFn: () => api.listKnowledgeBases(),
  });

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { knowledgeBaseId: "", question: "" },
  });

  const selectedKnowledgeBaseId = useWatch({ control, name: "knowledgeBaseId" });

  useEffect(() => {
    if (!knowledgeBases.data?.length) return;
    if (
      requestedKnowledgeBaseId &&
      appliedKnowledgeBaseParam.current !== requestedKnowledgeBaseId
    ) {
      appliedKnowledgeBaseParam.current = requestedKnowledgeBaseId;
      if (knowledgeBases.data.some((item) => item.id === requestedKnowledgeBaseId)) {
        setValue("knowledgeBaseId", requestedKnowledgeBaseId, { shouldValidate: true });
        return;
      }
    }
    if (selectedKnowledgeBaseId) return;
    const preferred =
      knowledgeBases.data.find((knowledgeBase) => knowledgeBase.is_default) ??
      knowledgeBases.data[0];
    setValue("knowledgeBaseId", preferred.id, { shouldValidate: true });
  }, [
    knowledgeBases.data,
    requestedKnowledgeBaseId,
    selectedKnowledgeBaseId,
    setValue,
  ]);

  useEffect(
    () => () => {
      activeController?.abort();
    },
    [activeController],
  );

  async function startRun(values: FormValues) {
    if (activeController) return;

    const controller = new AbortController();
    setActiveController(controller);
    let pendingConversationId: string | undefined;
    let pendingCitations: Citation[] = [];
    let streamedAnswer = "";
    let sawDone = false;

    setStatus("streaming");
    setCompletionKind(null);
    setRunError(null);
    setAnswer("");
    setSubmittedQuestion(values.question.trim());
    setRewrittenQuery("");
    setCitations([]);
    setStreamMetadata({});
    setStages({ ...initialStages(), rewrite_query: "active" });
    setActiveCitation(null);
    setEvidenceOpen(false);
    setCopyNotice(false);
    setLastRequest(values);

    const handleEvent = (event: ChatStreamEvent) => {
      switch (event.type) {
        case "metadata":
          if (event.payload.conversation_id) pendingConversationId = event.payload.conversation_id;
          if (event.payload.rewritten_query) setRewrittenQuery(event.payload.rewritten_query);
          if (event.payload.citations) {
            pendingCitations = event.payload.citations;
            setCitations(event.payload.citations);
          }
          setStreamMetadata((previous) => ({ ...previous, ...event.payload }));
          break;
        case "stage":
          setStages((previous) => updateCompletedStage(previous, event.payload.name));
          break;
        case "token":
          streamedAnswer += event.payload.token;
          setStages((previous) => updateActiveStage(previous, "generate"));
          setAnswer((previous) => previous + event.payload.token);
          break;
        case "done":
          sawDone = true;
          setStages({
            rewrite_query: "completed",
            hybrid_retrieve: "completed",
            rerank: "completed",
            expand_context: "completed",
            generate: "completed",
          });
          setCompletionKind(
            streamedAnswer.trim()
              ? pendingCitations.length > 0
                ? "grounded"
                : "no_evidence"
              : "empty",
          );
          setStatus("completed");
          if (pendingConversationId) {
            writeConversationId(values.knowledgeBaseId, pendingConversationId);
          }
          break;
        case "error":
          throw new ChatStreamProtocolError(event.payload.code, event.payload.message);
      }
    };

    try {
      await api.streamChat(
        {
          question: values.question.trim(),
          knowledge_base_id: values.knowledgeBaseId,
          conversation_id: readConversationId(values.knowledgeBaseId),
        },
        handleEvent,
        controller.signal,
      );
      if (!sawDone && !controller.signal.aborted) {
        throw new ChatStreamProtocolError("stream_incomplete", t("chat:streamEndedUnexpectedly"));
      }
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        setStatus("stopped");
        setStages((previous) => finishActiveStages(previous, "stopped"));
      } else {
        if (isApiError(error) && (error.status === 404 || error.status === 409)) {
          clearConversationId(values.knowledgeBaseId);
        }
        setStatus("error");
        setRunError(error);
        setStages((previous) => finishActiveStages(previous, "error"));
      }
    } finally {
      setActiveController((current) => (current === controller ? null : current));
    }
  }

  function stopGeneration() {
    activeController?.abort();
  }

  async function copyAnswer() {
    if (!answer) return;
    try {
      await navigator.clipboard.writeText(answer);
      setCopyNotice(true);
      window.setTimeout(() => setCopyNotice(false), 1500);
    } catch {
      setCopyNotice(false);
    }
  }

  function selectAnswerCitation(index: number) {
    setActiveCitation(index);
    if (mobileEvidence) {
      setEvidenceOpen(true);
      window.setTimeout(() => {
        document.getElementById(`evidence-citation-${index}`)?.scrollIntoView?.({
          block: "nearest",
          behavior: "smooth",
        });
      }, 0);
      return;
    }
    window.requestAnimationFrame(() => {
      document.getElementById(`evidence-citation-${index}`)?.scrollIntoView?.({
        block: "nearest",
        behavior: "smooth",
      });
    });
  }

  function selectEvidenceCitation(index: number) {
    setActiveCitation(index);
    window.requestAnimationFrame(() => {
      document.getElementById(`answer-citation-${index}`)?.scrollIntoView?.({
        block: "center",
        behavior: "smooth",
      });
    });
  }

  const errorTitle = (() => {
    if (!runError) return t("chat:errorGeneric");
    if (isApiError(runError)) {
      if (runError.status === 403) return t("chat:errorForbidden");
      if (runError.status === 404) return t("chat:errorNotFound");
      if (runError.status === 409) return t("chat:errorConflict");
      if (runError.status === 429) return t("chat:errorRateLimited");
      if (runError.status === 503) return t("chat:errorUnavailable");
    }
    return t("chat:errorGeneric");
  })();

  const technicalDetail =
    runError instanceof ChatStreamProtocolError
      ? `${t("chat:streamErrorCode", { code: runError.code })}\n${runError.message}`
      : runError instanceof Error
        ? runError.message
        : null;
  const requestId = isApiError(runError) ? runError.requestId : null;
  const retryAfter = isApiError(runError) ? runError.retryAfter : null;
  const isStreaming = status === "streaming";
  const hasKnowledgeBases = Boolean(knowledgeBases.data?.length);

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.kicker}>{t("chat:kicker")}</div>
          <h1>{t("chat:title")}</h1>
          <p>{t("chat:subtitle")}</p>
        </div>
        <div className={styles.runStatus} aria-live="polite">
          {status === "streaming"
            ? t("chat:streaming")
            : status === "completed"
              ? t("chat:completed")
              : status === "stopped"
                ? t("chat:stopped")
                : status === "error"
                  ? t("chat:failed")
                  : t("chat:ready")}
        </div>
      </header>

      <div className={styles.layout}>
        <section className={styles.workspace} aria-labelledby="chat-answer-title">
          <form className={styles.composer} onSubmit={handleSubmit(startRun)}>
            <div className={styles.field}>
              <label htmlFor="chat-kb">{t("chat:knowledgeBaseLabel")}</label>
              <select
                id="chat-kb"
                {...register("knowledgeBaseId")}
                disabled={isStreaming || knowledgeBases.isLoading || !hasKnowledgeBases}
              >
                <option value="">
                  {knowledgeBases.isLoading
                    ? t("chat:loadingKnowledgeBases")
                    : t("chat:chooseKnowledgeBase")}
                </option>
                {knowledgeBases.data?.map((knowledgeBase) => (
                  <option key={knowledgeBase.id} value={knowledgeBase.id}>
                    {knowledgeBase.name}
                  </option>
                ))}
              </select>
              {errors.knowledgeBaseId ? (
                <span className={styles.validation} role="alert">
                  {t("chat:chooseKnowledgeBase")}
                </span>
              ) : null}
            </div>

            {knowledgeBases.isError ? (
              <div className={styles.inlineError} role="alert">
                <span>{t("chat:errorUnavailable")}</span>
                <Button type="button" variant="secondary" onClick={() => void knowledgeBases.refetch()}>
                  {t("chat:reloadKnowledgeBases")}
                </Button>
              </div>
            ) : null}

            {!knowledgeBases.isLoading && !knowledgeBases.isError && !hasKnowledgeBases ? (
              <div className={styles.noKb}>
                <strong>{t("chat:noKnowledgeBases")}</strong>
                <p>{t("chat:noKnowledgeBasesDetail")}</p>
                <Link to="/app/knowledge-bases">{t("chat:openKnowledgeBases")}</Link>
              </div>
            ) : null}

            <div className={styles.field}>
              <label htmlFor="chat-question">{t("chat:questionLabel")}</label>
              <textarea
                id="chat-question"
                rows={4}
                maxLength={8000}
                {...register("question")}
                placeholder={t("chat:questionPlaceholder")}
                disabled={isStreaming || !hasKnowledgeBases}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                    event.preventDefault();
                    void handleSubmit(startRun)();
                  }
                }}
              />
              <div className={styles.fieldMeta}>
                <span>{t("chat:questionHint")}</span>
                {errors.question ? (
                  <span className={styles.validation} role="alert">
                    {t("chat:questionLabel")}
                  </span>
                ) : null}
              </div>
            </div>

            <div className={styles.composerActions}>
              {isStreaming ? (
                <Button type="button" variant="danger" onClick={stopGeneration}>
                  {t("chat:stop")}
                </Button>
              ) : (
                <Button type="submit" disabled={!hasKnowledgeBases}>
                  {t("chat:send")}
                </Button>
              )}
              {status === "error" || status === "stopped" ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!lastRequest}
                  onClick={() => lastRequest && void startRun(lastRequest)}
                >
                  {t("chat:retry")}
                </Button>
              ) : null}
              <EvidenceDesk
                citations={citations}
                metadata={streamMetadata}
                outcome={completionKind ?? "pending"}
                activeCitation={activeCitation}
                onCitationSelect={selectEvidenceCitation}
                open={evidenceOpen}
                onOpenChange={setEvidenceOpen}
                presentation="mobile"
              />
            </div>
          </form>

          {(submittedQuestion || isStreaming || status === "error" || status === "stopped") && (
            <div className={styles.pipeline}>
              <StagePipeline stages={stages} />
            </div>
          )}

          {runError ? (
            <section className={styles.errorPanel} aria-labelledby="chat-error-title">
              <h2 id="chat-error-title">{errorTitle}</h2>
              <p>{t("chat:recoverAction")}</p>
              {retryAfter ? <p>{t("chat:retryAfter", { seconds: retryAfter })}</p> : null}
              <RequestId requestId={requestId} />
              <TechnicalDetails detail={technicalDetail} />
            </section>
          ) : null}

          <section className={styles.answer} aria-busy={isStreaming}>
            <header className={styles.answerHeader}>
              <div>
                <h2 id="chat-answer-title">{t("chat:answerTitle")}</h2>
                {submittedQuestion ? (
                  <p className={styles.question}>{submittedQuestion}</p>
                ) : null}
              </div>
              {answer ? (
                <Button type="button" variant="secondary" onClick={() => void copyAnswer()}>
                  {copyNotice ? t("chat:answerCopied") : t("chat:copyAnswer")}
                </Button>
              ) : null}
            </header>

            {rewrittenQuery && rewrittenQuery !== submittedQuestion ? (
              <div className={styles.rewritten}>
                <span>{t("chat:rewrittenQuery")}</span>
                <p>{rewrittenQuery}</p>
              </div>
            ) : null}

            {completionKind === "no_evidence" ? (
              <div className={styles.noEvidence} role="status">
                <strong>{t("chat:noEvidenceTitle")}</strong>
                <p>{t("chat:noEvidenceDetail")}</p>
              </div>
            ) : null}

            {answer ? (
              <AnswerMarkdown
                answer={answer}
                citations={citations}
                activeCitation={activeCitation}
                onCitationSelect={selectAnswerCitation}
              />
            ) : (
              <div className={styles.answerEmpty}>
                <h3>
                  {completionKind === "empty"
                    ? t("chat:emptyResponseTitle")
                    : t("chat:noAnswerTitle")}
                </h3>
                <p>
                  {completionKind === "empty"
                    ? t("chat:emptyResponseDetail")
                    : t("chat:noAnswerDetail")}
                </p>
              </div>
            )}
          </section>
        </section>

        <div className={styles.evidenceColumn}>
          <EvidenceDesk
            citations={citations}
            metadata={streamMetadata}
            outcome={completionKind ?? "pending"}
            activeCitation={activeCitation}
            onCitationSelect={selectEvidenceCitation}
            open={evidenceOpen}
            onOpenChange={setEvidenceOpen}
            presentation="desktop"
          />
        </div>
      </div>
    </div>
  );
}
