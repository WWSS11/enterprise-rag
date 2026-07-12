# 项目架构知识库 V2.3 引用标注审计

日期：2026-07-12  
基于运行：`20d04037-cd76-4e70-a1ea-4ef12527bc89`

## 问题

原评测模型只保存 `expected_document_ids`，同时用它计算检索召回和引用精度。这会把两种不同语义混在一起：

- 检索主文档：问题必须召回的权威来源，用于 Recall 和 MRR。
- 允许引用文档：能够直接支持答案的补充来源，用于 Citation Precision。

例如“为什么 Worker 复用持久事件循环”的权威说明在架构文档中，但 README 也明确写了相同事实。模型引用 README 不应降低 Citation Precision，但 README 也不应因此成为 Recall 的必选主文档。

## 改动

- EvaluationCase 新增 `acceptable_citation_document_ids`。
- `expected_document_ids` 继续只用于 Retrieval/Rerank Recall、MRR 和 Citation Recall。
- Citation Precision 使用允许引用集合；主文档始终自动包含在允许引用集合中。
- 拒答用例不能设置主文档或允许引用文档。
- 新增 Alembic 迁移，已有用例默认将主文档复制为允许引用文档。
- 指标可以基于持久化答案和 citations 直接重算，不需要再次调用模型。

## 审计原则

只在文档内容确实直接支持问题时加入允许引用集合。本次增加了 8 条用例的支持文档，例如：

- 存储组件角色：架构说明为主文档，README 和技术栈表为支持文档。
- HTTP 200 设计取舍：能力决策为主文档，旧项目说明和企业版概览为支持文档。
- Java/LangChain4j 版本：POM 为主文档，旧项目 README 为支持文档。

没有把仅因同属一个项目、但引用 chunk 不支持具体结论的文档加入集合。

## 重算结果

| 指标 | 审计前 | 审计后 |
| --- | ---: | ---: |
| Citation Precision | 0.6917 | 0.8917 |
| Citation Recall | 1.0000 | 1.0000 |
| Retrieval Recall@K | 1.0000 | 1.0000 |
| Rerank MRR | 0.9500 | 0.9500 |
| Key-point Coverage | 0.9375 | 0.9375 |
| Refusal Accuracy | 1.0000 | 1.0000 |

## 剩余真实冗余引用

仍有 5 条用例 Citation Precision 低于 1.0：

1. 当前身份 Header 为什么不能直接作为最终生产认证方案？
2. 为什么 Celery Worker 子进程要复用持久异步事件循环？
3. 旧项目的启动时自动扫描目录在企业版中被替换成什么方案？
4. 企业版知识库有哪些访问模式和成员权限等级？
5. 企业版飞书 Wiki 增量同步的主要流程是什么？

这些用例中仍存在与相邻结论关联较弱的来源，未通过修改 ground truth 消除。下一阶段应约束模型使用“最少充分引用”，或增加答案生成后的引用核验，而不是继续放宽评测标注。
