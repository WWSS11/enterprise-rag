# OIDC/JWT 认证验证报告

日期：2026-07-13

## 实现边界

FastAPI 是 OAuth 2.0 Resource Server，不处理用户名密码登录。登录由标准 OIDC Provider 完成，API 只接受 `Authorization: Bearer <access_token>`。本地开发使用 Keycloak 26.7.0，认证实现只依赖 Discovery、JWKS 和标准 JWT claims，不调用 Keycloak 私有管理接口。

认证依赖按四层拆分：HTTP Bearer 提取、OIDC/JWKS Token 验证、`RequestIdentity` 映射、知识库授权。业务 API 只依赖 `RequestIdentity`，因此生产环境可以把 Keycloak 替换成其他兼容 OIDC Provider。

## 强制验证规则

- 只允许显式算法白名单，默认 `RS256`，拒绝 `alg=none`。
- JWT Header 必须包含受支持的 `typ` 和有效 `kid`。
- 使用 OIDC Discovery 获取 `jwks_uri`，并校验 Discovery 返回的 issuer 与配置完全相等。
- 签名、`iss`、`aud`、`exp`、`iat`、`sub` 均为强制项。
- `aud` 必须包含 `enterprise-rag-api`，`azp` 不能替代 audience。
- OIDC 模式拒绝 `X-Tenant-Id`、`X-User-Id`、`X-Identity-Secret`，防止浏览器伪造身份。
- tenant、roles 和 groups 从已验证 claims 映射；`rag-admin` 映射为全局管理员。
- JWKS 有 TTL 缓存；遇到未知 `kid` 时强制刷新一次，支持签名密钥轮换。

Audience 强制校验依据 [RFC 9068 第 4 节](https://www.rfc-editor.org/rfc/rfc9068.html#section-4)：资源服务器必须确认 `aud` 包含自身资源标识，不匹配必须拒绝。

## 本地 Keycloak 数据

- Realm：`enterprise-rag`
- API Audience：`enterprise-rag-api`
- 公共开发客户端：`enterprise-rag-web`
- 管理员角色：`rag-admin`
- 测试组：`engineering`
- 测试用户：`rag-admin`、`rag-user`

Realm 中的 Audience Mapper 只把 `enterprise-rag-api` 写入 Access Token，不写入 ID Token。tenant mapper 写入 `tenant_id=default`，group mapper写入 `groups=["engineering"]`。

Direct Access Grant 和仓库中的演示密码只用于本地自动验证；正式前端必须使用 Authorization Code Flow + PKCE，并删除演示用户或强制修改密码。

## 真实端到端结果

使用 Keycloak 实际签发的 Token 启动本地 FastAPI 后验证：

| 场景 | 结果 |
| --- | --- |
| Access Token 的 `aud` | `enterprise-rag-api` |
| 无 Bearer Token | HTTP 401 |
| OIDC 模式提交可信身份 Header | HTTP 400 |
| 使用 ID Token 调用 API | HTTP 401，因 audience 不匹配 |
| 管理员 Access Token | tenant=`default`，`is_admin=true` |
| 普通用户 Access Token | `is_admin=false` |
| roles 映射 | `rag-admin`、`rag-user` 正确读取 |
| groups 映射 | `engineering` 正确读取 |
| group ACL | `engineering` 成员可以读取授权的 restricted 知识库 |

自动测试使用临时 RSA 密钥，不依赖运行中的 Keycloak，覆盖正确 audience、错误 audience、过期 Token、错误 issuer、错误签名、OIDC Header 欺骗、身份映射和认证配置不变量。

## 版本依据

- Keycloak 官方下载页在本次实现时提供 26.7.0：[Keycloak Downloads](https://www.keycloak.org/downloads)
- JWT 验证库固定为 PyJWT 2.13.0：[PyJWT](https://pypi.org/project/PyJWT/)
