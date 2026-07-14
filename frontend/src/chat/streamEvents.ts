import { z } from "zod";
import { citationSchema, chatStageSchema, type Citation, type ChatStage } from "@/api/types";
import type { SseEvent } from "@/api/sse";

const metadataSchema = z.object({
  conversation_id: z.string().uuid().optional(),
  rewritten_query: z.string().optional(),
  citations: z.array(citationSchema).optional(),
  retrieved_count: z.number().int().nonnegative().optional(),
  reranked_count: z.number().int().nonnegative().optional(),
  citation_diagnostics: z.record(z.string(), z.unknown()).optional(),
});

const wireStageSchema = z.enum([
  "rewrite_query",
  "retrieve",
  "hybrid_retrieve",
  "rerank",
  "expand_context",
  "generate",
]);

const stageSchema = z.object({
  name: wireStageSchema,
  status: z.string(),
});

function normalizeStage(name: z.infer<typeof wireStageSchema>): ChatStage {
  return name === "retrieve" ? "hybrid_retrieve" : chatStageSchema.parse(name);
}

const tokenSchema = z.object({ token: z.string() });
const doneSchema = z.object({ status: z.string() });
const errorSchema = z.object({ code: z.string(), message: z.string() });

export type ChatStreamEvent =
  | { type: "metadata"; payload: z.infer<typeof metadataSchema> }
  | { type: "stage"; payload: { name: ChatStage; status: string } }
  | { type: "token"; payload: { token: string } }
  | { type: "done"; payload: { status: string } }
  | { type: "error"; payload: { code: string; message: string } };

export type ChatStreamMetadata = z.infer<typeof metadataSchema>;

export type FinalChatMetadata = {
  conversationId?: string;
  rewrittenQuery?: string;
  citations?: Citation[];
  retrievedCount?: number;
  rerankedCount?: number;
  citationDiagnostics?: Record<string, unknown>;
};

export function parseChatStreamEvent(event: SseEvent): ChatStreamEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(event.data);
  } catch {
    return null;
  }

  switch (event.event) {
    case "metadata": {
      const parsed = metadataSchema.safeParse(json);
      return parsed.success ? { type: "metadata", payload: parsed.data } : null;
    }
    case "stage": {
      const parsed = stageSchema.safeParse(json);
      return parsed.success
        ? {
            type: "stage",
            payload: { name: normalizeStage(parsed.data.name), status: parsed.data.status },
          }
        : null;
    }
    case "token": {
      const parsed = tokenSchema.safeParse(json);
      return parsed.success ? { type: "token", payload: parsed.data } : null;
    }
    case "done": {
      const parsed = doneSchema.safeParse(json);
      return parsed.success ? { type: "done", payload: parsed.data } : null;
    }
    case "error": {
      const parsed = errorSchema.safeParse(json);
      return parsed.success ? { type: "error", payload: parsed.data } : null;
    }
    default:
      return null;
  }
}
