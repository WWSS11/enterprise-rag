import { commonZh, type CommonDict } from "./common";
import { authZh, type AuthDict } from "./auth";
import { navigationZh, type NavigationDict } from "./navigation";
import { systemZh, type SystemDict } from "./system";
import { errorsZh, type ErrorsDict } from "./errors";
import { chatZh, type ChatDict } from "./chat";
import { evidenceZh, type EvidenceDict } from "./evidence";
import { knowledgeBasesZh, type KnowledgeBasesDict } from "./knowledgeBases";
import { documentsZh, type DocumentsDict } from "./documents";
import { jobsZh, type JobsDict } from "./jobs";
import { evaluationsZh, type EvaluationsDict } from "./evaluations";
import { evaluationCasesZh, type EvaluationCasesDict } from "./evaluationCases";
import { evaluationRunsZh, type EvaluationRunsDict } from "./evaluationRuns";
import { qualityGatesZh, type QualityGatesDict } from "./qualityGates";
import { connectorsZh, type ConnectorsDict } from "./connectors";

export const zhCN = {
  common: commonZh,
  auth: authZh,
  navigation: navigationZh,
  system: systemZh,
  errors: errorsZh,
  chat: chatZh,
  evidence: evidenceZh,
  knowledgeBases: knowledgeBasesZh,
  documents: documentsZh,
  jobs: jobsZh,
  evaluations: evaluationsZh,
  evaluationCases: evaluationCasesZh,
  evaluationRuns: evaluationRunsZh,
  qualityGates: qualityGatesZh,
  connectors: connectorsZh,
} as const;

export type AppResources = {
  common: CommonDict;
  auth: AuthDict;
  navigation: NavigationDict;
  system: SystemDict;
  errors: ErrorsDict;
  chat: ChatDict;
  evidence: EvidenceDict;
  knowledgeBases: KnowledgeBasesDict;
  documents: DocumentsDict;
  jobs: JobsDict;
  evaluations: EvaluationsDict;
  evaluationCases: EvaluationCasesDict;
  evaluationRuns: EvaluationRunsDict;
  qualityGates: QualityGatesDict;
  connectors: ConnectorsDict;
};
