export const evidenceZh = {
  title: "引用证据",
  subtitle: "回答明确引用的真实来源。选择证据可定位到回答中的引用标记。",
  emptyTitle: "尚无引用证据",
  emptyDetail: "完成问答后，此处将展示 API 返回的文档、Chunk 与内容预览。",
  noEvidenceTitle: "本次回答未引用证据",
  noEvidenceDetail: "后端已完成响应，但没有返回引用来源。这通常表示未检索到足够资料或系统选择了拒答，请勿将其视为有证据支持的结论。",
  document: "文档",
  chunk: "Chunk",
  score: "相关度",
  preview: "证据预览",
  locateInAnswer: "定位到回答",
  closeDrawer: "关闭引用证据",
  openDrawer: "打开引用证据",
  evidenceItem: "证据 {{index}}",
  citationInAnswer: "引用 {{index}}",
  unmatchedMarker: "回答中的引用未能匹配返回的证据",
  sourceCount: "共 {{count}} 条真实来源",
  retrievedCount: "初始检索",
  rerankedCount: "重排保留",
  diagnostics: "引用诊断",
} as const;

export type EvidenceDict = { readonly [K in keyof typeof evidenceZh]: string };
