export const errorsZh = {
  forbiddenCode: "403",
  forbiddenTitle: "无权访问",
  forbiddenBody:
    "当前身份没有访问该资源的权限。授权依据 /api/v1/auth/me（角色、用户组、管理员），而非前端猜测。",
  notFoundCode: "404",
  notFoundTitle: "页面不存在",
  notFoundBody:
    "该路由不属于企业知识工作台。请使用侧栏进入智能问答、知识库、文档、质量评测、任务中心或系统状态。",
  boundaryTitle: "控制台发生异常",
  boundaryBody:
    "应用遇到意外的客户端错误。会话未被记录。可重新加载以恢复，或在页面重置后继续。",
  reloadApp: "重新加载应用",
  tryContinue: "尝试继续",
  titleUnauthorized: "未授权",
  titleForbidden: "无权访问",
  titleNotFound: "资源不存在",
  titleConflict: "请求冲突",
  titleTooManyRequests: "请求过于频繁",
  titleServiceUnavailable: "服务暂不可用",
  titleBadRequest: "请求无效",
  titleServerError: "服务内部错误",
  titleNetwork: "网络错误",
  titleUnknown: "请求失败",
  actionUnauthorized: "请重新登录后重试。",
  actionForbidden: "如需访问，请联系知识库所有者或管理员。",
  actionNotFound: "检查路径是否正确，或返回可用页面。",
  actionConflict: "刷新状态后按冲突提示处理（HTTP 409）。",
  actionTooManyRequests: "请稍后再试。{{retryAfter}}",
  actionServiceUnavailable: "依赖服务暂时不可用，请稍后重试。",
  actionServerError: "请稍后重试；若持续失败请携带 request_id 联系支持。",
  actionNetwork: "检查网络连接后重试。",
  actionGeneric: "请稍后重试。",
  retryAfterSeconds: "建议等待约 {{seconds}} 秒。",
  retryAfterUnknown: "请稍后再试。",
} as const;

export type ErrorsDict = { readonly [K in keyof typeof errorsZh]: string };
