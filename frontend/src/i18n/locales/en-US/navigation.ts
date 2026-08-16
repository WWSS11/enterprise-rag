import type { NavigationDict } from "../zh-CN/navigation";

export const navigationEn = {
  primaryNav: "Primary",
  application: "Application",
  navigation: "Navigation",
  openNavigation: "Open navigation",
  closeNavigation: "Close navigation",
  collapseSidebar: "Collapse sidebar",
  expandSidebar: "Expand sidebar",
  collapse: "Collapse",
  expand: "Expand",
  sessionContext: "Session context",
  chat: "Chat",
  knowledgeBases: "Knowledge bases",
  documents: "Documents",
  evaluations: "Evaluations",
  jobs: "Jobs",
  connectors: "Connectors",
  system: "System",
} as const satisfies NavigationDict;
