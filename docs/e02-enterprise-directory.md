# E02 企业目录用户与群组搜索

## 完成范围

- 知识库 owner 可通过 `GET /api/v1/knowledge-bases/{knowledge_base_id}/directory-principals` 搜索企业用户或群组。
- 查询至少包含 2 个非空白字符，支持 `limit`、`offset`，单次最多返回 50 条。
- 前端等待输入稳定 300 毫秒后发起搜索，每页展示 20 条；必须选择真实目录结果，不能手工填写 OIDC `sub` 或群组字符串。
- 用户授权保存 Keycloak 用户 UUID，与 OIDC `sub` 一致；群组授权保存配置指定的名称或完整路径，必须与 Access Token 的 `groups` claim 一致。
- 禁用用户不会进入结果。Keycloak 异常、无效响应和认证失败统一返回脱敏的 503，不向浏览器暴露上游响应。

## 权限和租户边界

目录搜索先执行知识库 owner 权限校验，再访问 Keycloak。非 owner 返回 403，不存在或不可见的知识库返回 404。

每个 Keycloak 目录配置只绑定一个 `APP_ENTERPRISE_DIRECTORY_TENANT_ID`。请求身份的租户与绑定值不一致时拒绝搜索，避免共享 Realm 中的跨租户目录枚举。需要服务多个租户时，应为各租户提供隔离的目录配置，不应移除此检查。

## 运行时配置

默认 `APP_ENTERPRISE_DIRECTORY_PROVIDER=disabled`，此时搜索接口返回 503，但原有 ACL 数据和后端成员管理接口不受影响。启用 Keycloak 搜索需要由安全的运行时密钥来源提供：

```text
APP_ENTERPRISE_DIRECTORY_PROVIDER=keycloak
APP_ENTERPRISE_DIRECTORY_TENANT_ID=default
APP_ENTERPRISE_DIRECTORY_CLIENT_ID=<只读服务账户客户端>
APP_ENTERPRISE_DIRECTORY_CLIENT_SECRET=<运行时密钥>
APP_ENTERPRISE_DIRECTORY_GROUP_PRINCIPAL=name
```

服务使用 `APP_OIDC_ISSUER` 推导同一 Keycloak Realm 的令牌和 Admin REST 地址。`APP_ENTERPRISE_DIRECTORY_GROUP_PRINCIPAL` 可设为 `name` 或 `path`：

- OIDC 群组 mapper 使用 `full.path=false` 时选择 `name`。
- OIDC 群组 mapper 使用 `full.path=true` 时选择 `path`。

配置值必须与实际 `groups` claim 完全一致，否则目录选择虽可创建授权，但用户令牌无法命中该群组授权。

服务账户只需要目录只读权限。Keycloak `realm-management` 中应按实际版本授予查询用户和群组所需的最小角色，例如 `view-users`/`query-users` 与 `query-groups`；不要授予 `manage-users` 或 `realm-admin`。客户端密钥不得写入仓库、日志或浏览器配置。

## API 示例

```http
GET /api/v1/knowledge-bases/{id}/directory-principals?type=user&q=mei&limit=20&offset=0
Authorization: Bearer <user-access-token>
```

```json
[
  {
    "principal_type": "user",
    "principal_id": "11111111-1111-4111-8111-111111111111",
    "display_name": "Mei Lin",
    "secondary_text": "mei.lin · mei@example.com"
  }
]
```

目录服务自己的 client-credentials Token 仅存在后端内存中并按有效期复用，不会返回给调用者。

## 验证边界

自动化测试使用生成的脱敏用户、群组和模拟 Keycloak HTTP 响应，覆盖令牌复用、分页参数、禁用用户、嵌套群组、租户隔离、上游错误脱敏、owner 权限及浏览器选择流程。启用真实企业目录时，仍需由管理员使用获批的只读服务账户完成一次环境内连通性验收。
