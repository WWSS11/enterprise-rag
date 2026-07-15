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
} as const satisfies AppResources;
