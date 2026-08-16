import { commonEn } from "./common";
import { authEn } from "./auth";
import { navigationEn } from "./navigation";
import { systemEn } from "./system";
import { errorsEn } from "./errors";
import { chatEn } from "./chat";
import { evidenceEn } from "./evidence";
import { knowledgeBasesEn } from "./knowledgeBases";
import { documentsEn } from "./documents";
import { jobsEn } from "./jobs";
import { evaluationsEn } from "./evaluations";
import { evaluationCasesEn } from "./evaluationCases";
import { evaluationRunsEn } from "./evaluationRuns";
import { qualityGatesEn } from "./qualityGates";
import { connectorsEn } from "./connectors";
import type { AppResources } from "../zh-CN";

export const enUS = {
  common: commonEn,
  auth: authEn,
  navigation: navigationEn,
  system: systemEn,
  errors: errorsEn,
  chat: chatEn,
  evidence: evidenceEn,
  knowledgeBases: knowledgeBasesEn,
  documents: documentsEn,
  jobs: jobsEn,
  evaluations: evaluationsEn,
  evaluationCases: evaluationCasesEn,
  evaluationRuns: evaluationRunsEn,
  qualityGates: qualityGatesEn,
  connectors: connectorsEn,
} as const satisfies AppResources;
