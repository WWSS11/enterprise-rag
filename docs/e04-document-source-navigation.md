# E04 原文预览、下载与引用定位

## 完成范围

E04 将回答引用从 Chunk 摘要扩展为可核验的原文入口：

- 文档列表中的 reader、editor 和 owner 均可预览当前已发布索引中的结构化原文；只有存在受控源文件时才可下载。
- 当前回答和历史会话的引用会显示页码、幻灯片、段落范围、工作表单元格范围或章节位置，并可直接打开对应 Chunk 的原文及相邻内容。
- PDF、PPTX 沿用解析器已有的页码和幻灯片号；TXT、Markdown、DOCX 增加段落号；CSV、XLS/XLSX 增加工作表、表格和单元格范围。
- 旧文档缺少精确元数据时回退到章节路径或章节序号，不伪造页码、段落或单元格位置。

预览内容来自 PostgreSQL 中当前 `index_version` 对应的 section/chunk，不直接把服务器文件暴露给浏览器。引用定位信息由检索阶段按白名单投影后进入 `context_sources`、回答 `citations` 和会话记录。

## API

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET` | `/api/v1/documents/{document_id}/preview` | 返回当前索引前 20 个 section；可传 `chunk_id` 返回命中 section 及相邻 section |
| `GET` | `/api/v1/documents/{document_id}/download` | 权限校验后以 attachment 返回原文件，响应禁止缓存 |

两个接口至少要求知识库 reader 权限，并同时校验租户。跨租户、无访问权限或不属于该文档当前版本的 Chunk 均不会暴露资源是否存在。预览最多返回 20 个 section、50,000 个字符，并通过 `truncated` 明确表示截断。

`DocumentRead` 只返回 `source_available`，不再返回 `source_uri`。预览和引用位置也只允许以下稳定字段：

- `page`、`slide`
- `paragraph_start`、`paragraph_end`
- `sheet`、`table`、`cell_range`
- `section_index`、`heading_path`

解析器内部路径、任意源元数据和服务器文件位置不会进入 API。下载文件名会去除路径和换行符，并记录 `documents.downloaded` 审计；预览记录 `documents.previewed` 审计。

## 前端行为

文档详情的“查看原文”打开受焦点约束的响应式对话框；“下载原文件”通过带 Bearer Token 的 API 客户端读取二进制，再交给浏览器下载。Token 仍只保存在 `sessionStorage`，不会写入下载 URL 或 `localStorage`。

Evidence Desk 和历史会话均显示本地化的位置标签。“查看原文”携带 `document_id` 和 `chunk_id` 请求后端，因此打开的是引用命中位置，而不是仅打开文档首页。移动端会先关闭证据抽屉，再显示原文对话框，避免嵌套焦点陷阱。

## 验证记录

- 后端：Ruff、mypy、pip check 和 159 条 pytest 通过；覆盖位置字段白名单、页码预览、下载响应头、审计和跨租户隐藏。
- 前端：typecheck、ESLint、生产构建、148 条 Vitest 和 10 条 Chromium Playwright 通过。
- 浏览器：覆盖从回答引用进入指定段落、文档列表预览工作表单元格范围，以及鉴权二进制下载。
- 依赖：`npm audit` 通过，无活动例外。

本任务复用现有 `source_metadata` JSON 和源文件存储，不需要数据库迁移，也未修改任何部署配置。
