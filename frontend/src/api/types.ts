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

const apiDateTimeSchema = z.iso.datetime({ offset: true });

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
  created_at: apiDateTimeSchema,
  updated_at: apiDateTimeSchema,
});

export const knowledgeBaseListSchema = z.array(knowledgeBaseSchema);
export type KnowledgeBase = z.infer<typeof knowledgeBaseSchema>;

export const knowledgeBaseCreateSchema = z.object({
  slug: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1).max(255),
  description: z.string().max(4000).nullable(),
  access_mode: z.enum(["tenant", "restricted"]),
});
export type KnowledgeBaseCreate = z.infer<typeof knowledgeBaseCreateSchema>;

export const documentStatusSchema = z.enum([
  "pending",
  "queued",
  "processing",
  "reindexing",
  "deleting",
  "ready",
  "failed",
]);

export const documentSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string(),
  knowledge_base_id: z.string().uuid(),
  name: z.string(),
  source_type: z.string(),
  source_key: z.string().nullable(),
  source_uri: z.string().nullable(),
  source_updated_at: apiDateTimeSchema.nullable(),
  content_type: z.string().nullable(),
  size_bytes: z.number().int().nonnegative(),
  status: documentStatusSchema,
  chunk_count: z.number().int().nonnegative(),
  index_version: z.string().nullable(),
  indexed_at: apiDateTimeSchema.nullable(),
  error_message: z.string().nullable(),
  extra_metadata: z.record(z.string(), z.unknown()),
  created_at: apiDateTimeSchema,
  updated_at: apiDateTimeSchema,
});
export const documentListSchema = z.array(documentSchema);
export type DocumentRecord = z.infer<typeof documentSchema>;

export const jobStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);

export const jobSchema = z.object({
  id: z.string().uuid(),
  document_id: z.string().uuid().nullable(),
  task_id: z.string().nullable(),
  job_type: z.string(),
  status: jobStatusSchema,
  progress: z.number().int().min(0).max(100),
  result: z.record(z.string(), z.unknown()),
  error_message: z.string().nullable(),
  created_at: apiDateTimeSchema,
  updated_at: apiDateTimeSchema,
});
export type Job = z.infer<typeof jobSchema>;

export const documentUploadAcceptedSchema = z.object({
  document: documentSchema,
  job_id: z.string().uuid(),
  task_id: z.string(),
});
export type DocumentUploadAccepted = z.infer<typeof documentUploadAcceptedSchema>;

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
