export const navigationZh = {
  primaryNav: "主导航",
  application: "应用",
  navigation: "导航",
  openNavigation: "打开导航",
  closeNavigation: "关闭导航",
  collapseSidebar: "收起侧栏",
  expandSidebar: "展开侧栏",
  collapse: "收起",
  expand: "展开",
  sessionContext: "会话上下文",
  chat: "智能问答",
  knowledgeBases: "知识库",
  documents: "文档",
  evaluations: "质量评测",
  jobs: "任务中心",
  connectors: "连接器",
  system: "系统状态",
} as const;

export type NavigationDict = { readonly [K in keyof typeof navigationZh]: string };
