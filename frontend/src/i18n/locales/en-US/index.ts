import { commonEn } from "./common";
import { authEn } from "./auth";
import { navigationEn } from "./navigation";
import { systemEn } from "./system";
import { errorsEn } from "./errors";
import { chatEn } from "./chat";
import { evidenceEn } from "./evidence";
import type { AppResources } from "../zh-CN";

export const enUS = {
  common: commonEn,
  auth: authEn,
  navigation: navigationEn,
  system: systemEn,
  errors: errorsEn,
  chat: chatEn,
  evidence: evidenceEn,
} as const satisfies AppResources;
