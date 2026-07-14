import { z } from "zod";

export const currentIdentitySchema = z.object({
  user_id: z.string(),
  tenant_id: z.string(),
  roles: z.array(z.string()),
  groups: z.array(z.string()),
  auth_method: z.enum(["trusted_header", "oidc"]),
  is_admin: z.boolean(),
});

export type CurrentIdentity = z.infer<typeof currentIdentitySchema>;

export const healthResponseSchema = z.object({
  status: z.string(),
  service: z.string(),
  version: z.string(),
  dependencies: z.record(z.string(), z.unknown()).default({}),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const knowledgeBaseSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  access_mode: z.string(),
  status: z.string(),
  is_default: z.boolean(),
  created_by: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const knowledgeBaseListSchema = z.array(knowledgeBaseSchema);
export type KnowledgeBase = z.infer<typeof knowledgeBaseSchema>;

export const citationSchema = z.object({
  document_id: z.string(),
  document_name: z.string(),
  chunk_id: z.string(),
  score: z.number(),
  content_preview: z.string(),
});
export type Citation = z.infer<typeof citationSchema>;

export const chatRequestSchema = z.object({
  question: z.string().min(1).max(8000),
  conversation_id: z.string().uuid().nullable().optional(),
  knowledge_base_id: z.string().uuid().nullable().optional(),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const chatStageSchema = z.enum([
  "rewrite_query",
  "hybrid_retrieve",
  "rerank",
  "expand_context",
  "generate",
]);
export type ChatStage = z.infer<typeof chatStageSchema>;

export const problemDetailsSchema = z.object({
  type: z.string().optional(),
  title: z.string().optional(),
  status: z.number().optional(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  request_id: z.string().nullable().optional(),
  errors: z.unknown().optional(),
  data: z.unknown().optional(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
