# T14 应用安全加固记录 — 2026-08-04

## 范围

本轮只修改应用代码、应用配置校验和测试，不修改容器、反向代理或其他部署配置。目标是收紧
OIDC/JWT、跨域、浏览器运行时配置、租户授权和文档上传边界。

## 身份与租户边界

- 保留既有 JWT 签名、`kid`、`iss`、`aud`、`exp`、`iat`、`sub` 和令牌类型校验。
- OIDC 仅允许 RSA、PSS、ECDSA 和 EdDSA 非对称签名算法，拒绝 `none` 和 HMAC 算法。
- JWK 的 `use` 必须为空或 `sig`，`key_ops` 必须允许 `verify`，声明的 `alg` 必须在配置白名单中。
- Discovery/JWKS 地址拒绝非 HTTP(S)、用户信息和片段；生产环境强制 HTTPS。
- OIDC 模式继续拒绝可信身份请求头，可信请求头模式继续拒绝 Bearer Token。
- 知识库授权先验证租户，再应用管理员、创建者和成员权限；管理员不能跨租户访问资源。
- 创建者 Owner 授权不能降级或移除，最后一个 Owner 授权不能删除。

## CORS、跳转与浏览器策略

- CORS 只接受明确的 HTTP(S) Origin，拒绝通配符、路径、查询、用户信息和重复项；生产环境
  Origin 必须使用 HTTPS。
- API 只允许实际使用的 HTTP 方法和请求头，不再使用方法或请求头通配符。
- 前端 `appOrigin` 必须与浏览器当前 Origin 完全一致；非本地 API 与 OIDC 地址必须使用 HTTPS。
- OIDC Scope 必须包含 `openid`，Client ID 使用有界字符集。
- 登录返回路径只允许 `/app` 下的同源路径，拒绝绝对地址、协议相对地址、反斜线、编码后的
  双斜线、控制字符和过长值。
- 前端在加载运行配置后、导入应用前安装 CSP，允许当前应用、明确的 API 与 OIDC Origin，
  不允许任意脚本源或对象嵌入；策略保留 OIDC 静默续期所需的 `frame-src` 和网络连接。
- API 响应统一加入 CSP、`X-Content-Type-Options`、`X-Frame-Options`、
  `Referrer-Policy`、`Permissions-Policy`；API 数据默认 `Cache-Control: no-store`。
- 外部请求 ID 只接受 1～64 位安全字符，异常值替换为服务端 UUID，避免日志污染。

静态前端入口的 HTTP 响应头仍由其实际静态文件服务器负责。本轮遵守“不修改部署相关内容”
的限制，因此没有调整 Nginx 或其他反向代理配置；应用内 CSP 会在 Bootstrap 后约束后续动态
模块、OIDC iframe 和 API 连接。

## 上传保护

- 继续执行后端扩展名白名单、50 MB 上限、空文件和内容 SHA-256 重复检查。
- 新增声明 MIME 与扩展名匹配检查；允许未声明或通用二进制 MIME，但仍必须通过内容签名。
- PDF、旧版 Excel 和 OOXML 文档必须具有匹配的文件签名或容器结构。
- JSON 必须为有效 UTF-8 JSON；文本文件拒绝二进制 NUL；XML/HTML 必须具有文本签名。
- Office ZIP 容器限制条目数、展开体积和压缩比，并拒绝路径穿越、加密条目、符号链接、
  VBA 宏、ActiveX 与嵌入对象。
- 停止接受宏启用的 `.xlsm`，避免把主动内容带入解析链路。

这些检查用于减少伪装文件和资源耗尽风险，不等同于企业恶意软件扫描。若以后接入真实内部
附件，还应在进入应用前使用组织批准的杀毒或内容消毒服务。

## 验收用例

集中测试覆盖：

- 错误 Issuer/Audience/签名、过期令牌、HMAC/`none`、非签名 JWK 和 Header 欺骗；
- CORS 非法 Origin、未批准请求头、安全响应头和请求 ID 污染；
- 跨租户管理员访问、创建者降级和最后 Owner 保护；
- 开放跳转、非 HTTPS 远程端点和缺少 `openid` Scope；
- 文件签名伪装、MIME 不匹配、无效 JSON、ZIP 路径穿越、符号链接、宏和压缩炸弹。

最终测试结果在本阶段所有实现完成后统一写入 `PROJECT_PROGRESS.md`。
