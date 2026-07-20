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

export const knowledgeBaseUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(4000).nullable().optional(),
  access_mode: z.enum(["tenant", "restricted"]).optional(),
});
export type KnowledgeBaseUpdate = z.infer<typeof knowledgeBaseUpdateSchema>;

export const knowledgeBaseMemberUpsertSchema = z.object({
  principal_type: z.enum(["user", "group"]),
  principal_id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/),
  permission: z.enum(["reader", "editor", "owner"]),
});
export type KnowledgeBaseMemberUpsert = z.infer<typeof knowledgeBaseMemberUpsertSchema>;

export const knowledgeBaseMemberSchema = z.object({
  id: z.string().uuid(),
  knowledge_base_id: z.string().uuid(),
  principal_type: z.string(),
  principal_id: z.string(),
  permission: z.string(),
  created_at: apiDateTimeSchema,
  updated_at: apiDateTimeSchema,
});
export type KnowledgeBaseMember = z.infer<typeof knowledgeBaseMemberSchema>;
export const knowledgeBaseMemberListSchema = z.array(knowledgeBaseMemberSchema);

export const knowledgeBasePermissionSchema = z.object({
  knowledge_base_id: z.string().uuid(),
  permission: z.enum(["reader", "editor", "owner"]),
  source: z.enum(["admin", "tenant", "creator", "membership"]),
});
export type KnowledgeBasePermission = z.infer<typeof knowledgeBasePermissionSchema>;

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
  knowledge_base_id: z.string().uuid().nullish().transform((value) => value ?? null),
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
export const jobPageSchema = z.object({
  items: z.array(jobSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type JobPage = z.infer<typeof jobPageSchema>;

export const documentUploadAcceptedSchema = z.object({
  document: documentSchema,
  job_id: z.string().uuid(),
  task_id: z.string(),
});
export type DocumentUploadAccepted = z.infer<typeof documentUploadAcceptedSchema>;

export const localScanRequestSchema = z.object({
  root_alias: z.string().min(1).max(64),
  knowledge_base_id: z.string().uuid().nullable().optional(),
});
export type LocalScanRequest = z.infer<typeof localScanRequestSchema>;

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

export const evaluationDatasetCreateSchema = z.object({
  knowledge_base_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(4000).nullable().optional(),
});
export type EvaluationDatasetCreate = z.infer<typeof evaluationDatasetCreateSchema>;

export const evaluationDatasetSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string(),
  knowledge_base_id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  created_by: z.string(),
  created_at: apiDateTimeSchema,
  updated_at: apiDateTimeSchema,
});
export const evaluationDatasetListSchema = z.array(evaluationDatasetSchema);
export type EvaluationDataset = z.infer<typeof evaluationDatasetSchema>;

export const evaluationCaseCreateSchema = z.object({
  question: z.string().min(1).max(8000),
  reference_answer: z.string().min(1).max(32000),
  expected_document_ids: z.array(z.string().uuid()).max(100).optional(),
  acceptable_citation_document_ids: z.array(z.string().uuid()).max(100).optional(),
  required_key_points: z.array(z.string()).max(100).optional(),
  required_key_point_groups: z.array(z.array(z.string()).max(20)).max(100).optional(),
  should_refuse: z.boolean().optional(),
  tags: z.array(z.string()).max(50).optional(),
});
export type EvaluationCaseCreate = z.infer<typeof evaluationCaseCreateSchema>;

export const evaluationCaseBulkCreateSchema = z.object({
  cases: z.array(evaluationCaseCreateSchema).min(1).max(500),
});
export type EvaluationCaseBulkCreate = z.infer<typeof evaluationCaseBulkCreateSchema>;

export const evaluationCaseSchema = z.object({
  id: z.string().uuid(),
  dataset_id: z.string().uuid(),
  question: z.string(),
  reference_answer: z.string(),
  expected_document_ids: z.array(z.string()),
  acceptable_citation_document_ids: z.array(z.string()),
  required_key_points: z.array(z.string()),
  required_key_point_groups: z.array(z.array(z.string())),
  should_refuse: z.boolean(),
  tags: z.array(z.string()),
  created_at: apiDateTimeSchema,
  updated_at: apiDateTimeSchema,
});
export const evaluationCaseListSchema = z.array(evaluationCaseSchema);
export type EvaluationCase = z.infer<typeof evaluationCaseSchema>;

export const evaluationRunCreateSchema = z.object({
  dataset_id: z.string().uuid(),
});
export type EvaluationRunCreate = z.infer<typeof evaluationRunCreateSchema>;

export const evaluationRunSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string(),
  knowledge_base_id: z.string().uuid(),
  dataset_id: z.string().uuid(),
  created_by: z.string(),
  task_id: z.string().nullable(),
  status: z.string(),
  progress: z.number().int().min(0).max(100),
  total_cases: z.number().int().nonnegative(),
  completed_cases: z.number().int().nonnegative(),
  failed_cases: z.number().int().nonnegative(),
  config_snapshot: z.record(z.string(), z.unknown()),
  summary: z.record(z.string(), z.unknown()),
  started_at: apiDateTimeSchema.nullable(),
  completed_at: apiDateTimeSchema.nullable(),
  error_message: z.string().nullable(),
  created_at: apiDateTimeSchema,
  updated_at: apiDateTimeSchema,
});
export type EvaluationRun = z.infer<typeof evaluationRunSchema>;
export const evaluationRunPageSchema = z.object({
  items: z.array(evaluationRunSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type EvaluationRunPage = z.infer<typeof evaluationRunPageSchema>;

export const conversationSchema = z.object({
  id: z.string().uuid(),
  knowledge_base_id: z.string().uuid(),
  title: z.string().nullable(),
  status: z.string(),
  created_at: apiDateTimeSchema,
  updated_at: apiDateTimeSchema,
});
export type Conversation = z.infer<typeof conversationSchema>;
export const conversationPageSchema = z.object({
  items: z.array(conversationSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type ConversationPage = z.infer<typeof conversationPageSchema>;

export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  role: z.string(),
  content: z.string(),
  citations: z.array(z.record(z.string(), z.unknown())),
  token_usage: z.record(z.string(), z.unknown()),
  created_at: apiDateTimeSchema,
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export const chatMessagePageSchema = z.object({
  items: z.array(chatMessageSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  has_more: z.boolean(),
});
export type ChatMessagePage = z.infer<typeof chatMessagePageSchema>;

export const auditLogSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().nullable(),
  action: z.string(),
  resource_type: z.string(),
  resource_id: z.string().nullable(),
  request_id: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
  created_at: apiDateTimeSchema,
});
export type AuditLog = z.infer<typeof auditLogSchema>;
export const auditLogPageSchema = z.object({
  items: z.array(auditLogSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type AuditLogPage = z.infer<typeof auditLogPageSchema>;

export const evaluationResultSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  case_id: z.string().uuid(),
  status: z.string(),
  rewritten_query: z.string().nullable(),
  answer: z.string().nullable(),
  retrieved_documents: z.array(z.record(z.string(), z.unknown())),
  reranked_documents: z.array(z.record(z.string(), z.unknown())),
  citations: z.array(z.record(z.string(), z.unknown())),
  citation_evidence: z.array(z.record(z.string(), z.unknown())),
  metrics: z.record(z.string(), z.unknown()),
  first_token_ms: z.number().nullable().optional(),
  total_latency_ms: z.number().nullable().optional(),
  error_message: z.string().nullable(),
  created_at: apiDateTimeSchema,
  updated_at: apiDateTimeSchema,
});
export type EvaluationResult = z.infer<typeof evaluationResultSchema>;

export const evaluationResultReportSchema = evaluationResultSchema.extend({
  question: z.string(),
  reference_answer: z.string(),
  expected_document_ids: z.array(z.string()),
  acceptable_citation_document_ids: z.array(z.string()),
  required_key_points: z.array(z.string()),
  required_key_point_groups: z.array(z.array(z.string())),
  should_refuse: z.boolean(),
  tags: z.array(z.string()),
});
export type EvaluationResultReport = z.infer<typeof evaluationResultReportSchema>;

export const evaluationReportSchema = z.object({
  run: evaluationRunSchema,
  dataset: evaluationDatasetSchema,
  results: z.array(evaluationResultReportSchema),
});
export type EvaluationReport = z.infer<typeof evaluationReportSchema>;

export const evaluationRunComparisonRequestSchema = z.object({
  baseline_run_id: z.string().uuid(),
});
export type EvaluationRunComparisonRequest = z.infer<
  typeof evaluationRunComparisonRequestSchema
>;

const optionalNullableMetricSchema = z.number().nullable().optional();

export const evaluationMetricComparisonSchema = z.object({
  metric: z.string(),
  baseline: optionalNullableMetricSchema,
  candidate: optionalNullableMetricSchema,
  delta: optionalNullableMetricSchema,
  relative_delta: optionalNullableMetricSchema,
});
export type EvaluationMetricComparison = z.infer<typeof evaluationMetricComparisonSchema>;

export const evaluationConfigDifferenceSchema = z.object({
  key: z.string(),
  baseline: z.unknown(),
  candidate: z.unknown(),
});
export type EvaluationConfigDifference = z.infer<typeof evaluationConfigDifferenceSchema>;

export const evaluationRunComparisonSchema = z.object({
  baseline_run_id: z.string().uuid(),
  candidate_run_id: z.string().uuid(),
  dataset_id: z.string().uuid(),
  metrics: z.array(evaluationMetricComparisonSchema),
  config_differences: z.array(evaluationConfigDifferenceSchema),
});
export type EvaluationRunComparison = z.infer<typeof evaluationRunComparisonSchema>;

export const evaluationQualityGateThresholdsSchema = z.object({
  max_metric_regressions: z.record(z.string(), z.number()).optional(),
  minimum_candidate_metrics: z.record(z.string(), z.number()).optional(),
  max_latency_increase_ratios: z.record(z.string(), z.number()).optional(),
  require_zero_failed_cases: z.boolean().optional(),
});
export type EvaluationQualityGateThresholds = z.infer<
  typeof evaluationQualityGateThresholdsSchema
>;

export const DEFAULT_EVALUATION_QUALITY_GATE_THRESHOLDS = {
  max_metric_regressions: {
    retrieval_recall_at_k: 0.0,
    rerank_recall_at_k: 0.0,
    citation_recall: 0.0,
    key_point_group_coverage: 0.02,
    citation_key_point_support_rate: 0.02,
    citation_required_point_support_precision: 0.02,
    refusal_accuracy: 0.0,
  },
  minimum_candidate_metrics: {
    retrieval_recall_at_k: 0.95,
    rerank_recall_at_k: 0.9,
    refusal_accuracy: 0.95,
  },
  max_latency_increase_ratios: {
    average_first_token_ms: 0.25,
    average_total_latency_ms: 0.2,
  },
  require_zero_failed_cases: true,
} satisfies EvaluationQualityGateThresholds;

export const evaluationQualityGateRequestSchema = evaluationRunComparisonRequestSchema.extend({
  thresholds: evaluationQualityGateThresholdsSchema.optional(),
});
export type EvaluationQualityGateRequest = z.infer<typeof evaluationQualityGateRequestSchema>;

export const evaluationQualityGateCheckSchema = z.object({
  metric: z.string(),
  rule: z.string(),
  threshold: z.number(),
  baseline: optionalNullableMetricSchema,
  candidate: optionalNullableMetricSchema,
  actual: optionalNullableMetricSchema,
  passed: z.boolean(),
  reason: z.string(),
});
export type EvaluationQualityGateCheck = z.infer<typeof evaluationQualityGateCheckSchema>;

export const evaluationQualityGateReportSchema = z.object({
  passed: z.boolean(),
  comparison: evaluationRunComparisonSchema,
  checks: z.array(evaluationQualityGateCheckSchema),
});
export type EvaluationQualityGateReport = z.infer<typeof evaluationQualityGateReportSchema>;

export type EvaluationQualityGateResult = {
  report: EvaluationQualityGateReport;
  request_id: string | null;
  conflict: boolean;
};

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
