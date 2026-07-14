import { commonZh, type CommonDict } from "./common";
import { authZh, type AuthDict } from "./auth";
import { navigationZh, type NavigationDict } from "./navigation";
import { systemZh, type SystemDict } from "./system";
import { errorsZh, type ErrorsDict } from "./errors";
import { chatZh, type ChatDict } from "./chat";
import { evidenceZh, type EvidenceDict } from "./evidence";

export const zhCN = {
  common: commonZh,
  auth: authZh,
  navigation: navigationZh,
  system: systemZh,
  errors: errorsZh,
  chat: chatZh,
  evidence: evidenceZh,
} as const;

export type AppResources = {
  common: CommonDict;
  auth: AuthDict;
  navigation: NavigationDict;
  system: SystemDict;
  errors: ErrorsDict;
  chat: ChatDict;
  evidence: EvidenceDict;
};
