# 项目架构质量基线 v1

## 基线身份

- 运行时间：2026-07-11
- 知识库：`项目架构真实基线`
- 知识库 ID：`6a688c70-5449-483b-bbe1-179133114955`
- 数据集：`项目架构质量基线 v1`
- 数据集 ID：`c07be0ee-9c23-4452-9f35-115c5fc57e88`
- 运行 ID：`b96bae56-ccb6-4a1b-9d0e-77f451e90cec`
- 用例：25 条，其中 20 条可回答、5 条应拒答
- 执行状态：25/25 成功，0 个任务错误
- 总运行时间：约 5 分 49 秒

评测集源文件见 [`project-architecture-v1.json`](../evaluation-datasets/project-architecture-v1.json)。

## 真实语料

| 文档 | 分块数 | 内容范围 |
| --- | ---: | --- |
| `enterprise-overview.md` | 21 | 当前企业版能力、API、配置、自动评测和飞书同步 |
| `enterprise-architecture.md` | 6 | 存储边界、RAG、入库 Saga、蓝绿重建、权限和异步运行时 |
| `legacy-capability-decisions.md` | 4 | 旧项目能力的保留、重做和拒绝决策 |
| `legacy-project-overview.md` | 48 | 旧版完整功能、运行方式、向量库、入库和接口说明 |
| `enterprise-tech-stack.md` | 3 | 企业技术栈及选型理由 |
| `legacy-pom.xml` | 4 | 旧版 Java 版本和 Maven 依赖 |
| `legacy-frontend.html` | 1 | 旧版前端页面可见文本 |

首次使用 `chunk_size=800` 入库时，3 份文档因 embedding 接口返回 `20015 parameter invalid` 而失败。失败分块长度约 750～830 字符，超过 BGE 512-token 级模型的安全输入范围。本基线统一改为 `chunk_size=480`、`chunk_overlap=80` 后，7 份文档全部成功索引，共 87 个分块。

## 配置快照

| 配置 | 值 |
| --- | --- |
| Chat | `gpt-5.5` |
| Embedding | `BAAI/bge-large-zh-v1.5`，1024 维 |
| Rerank | `BAAI/bge-reranker-v2-m3` |
| Retrieval TopK | 20 |
| Rerank TopK | 5 |
| 向量分数阈值 | 0.55 |
| Chunk | 480 / overlap 80 |
| Milvus alias | `rag_chunks_current` |

## 汇总结果

| 指标 | 结果 |
| --- | ---: |
| Retrieval Recall@K | 0.4000 |
| Retrieval MRR | 0.3875 |
| Rerank Recall@K | 0.4000 |
| Rerank MRR | 0.3917 |
| Citation Precision | 0.4722 |
| Citation Recall | 0.4000 |
| 关键点覆盖率 | 0.3725 |
| 综合拒答准确率 | 0.6800 |
| 无答案问题正确拒答率 | 1.0000（5/5） |
| 可回答问题正常回答率 | 0.6000（12/20） |
| 可回答问题错误拒答 | 8/20 |
| 完整召回 / 部分召回 / 零召回 | 7 / 2 / 11 |
| 平均首 Token 延迟 | 12,409 ms |
| 平均总延迟 | 13,953 ms |
| 总延迟 P50 / P95 | 8,506 ms / 35,179 ms |

## 主要发现

### 1. 向量阈值在 rerank 前过滤过严

11 个零召回问题中，有 10 个问题的预期文档实际位于未经阈值过滤的原始向量结果前 4 名，但相似度在约 0.439～0.530 之间，被当前 `score_threshold=0.55` 提前删除。典型情况：

| 问题 | 预期文档原始排名 | 原始分数 |
| --- | ---: | ---: |
| 三种向量数据库运行模式 | 3 | 0.4683 |
| 启动扫描替代方案 | 4 | 0.4473 |
| 自动评测确定性指标 | 1、2 | 0.4532、0.4047 |
| 权限模式和等级 | 4 | 0.5058 |
| Java 版本和 LangChain4j 依赖 | 3 | 0.4702 |
| HTTP 200 设计取舍 | 3 | 0.5156 |
| embedding 部分失败策略 | 1、4 | 0.5303、0.4454 |
| 评测配置冻结与会话隔离 | 2 | 0.4720 |
| 旧版文档导入方式 | 2 | 0.5019 |
| X-Forwarded-For 设计取舍 | 2 | 0.4389 |

这说明 embedding 已经把相关资料排进候选集，但固定阈值让 rerank 没有机会纠正排序。当前 Recall 和拒答问题主要是检索策略问题，不是生成模型不可用。

### 2. 旧版与企业版文档存在语义重叠

企业版 README、架构说明和旧版完整 README 对 Milvus、Redis、文档入库等主题存在重复描述。回答虽然有时正确，但同时引用非标准来源，导致 Citation Precision 只有 0.4722。后续需要：

- 为文档增加 `system_version`、`document_role` 等元数据；
- 对“当前企业版”和“旧版”问题加入版本过滤或查询路由；
- 在标准答案确实允许多个来源时完善预期文档集合。

### 3. 小文档召回不足

`legacy-frontend.html` 解析后只有 1 个分块，“页面标题和知识库区域”问题的目标分块没有进入原始 Top20。需要扩大预召回候选，或为短文档增加标题、文件名和结构字段参与 embedding。

### 4. 延迟主要来自生成和外部模型

无召回时通常在约 0.14～8.5 秒返回固定拒答；正常生成问题的首 Token 经常需要 15～34 秒。P95 总延迟达到约 35.2 秒。后续应分别记录 embedding、Milvus、rerank、LLM 首 Token 和生成耗时，才能确定具体瓶颈。

## 下一轮实验建议

保持本数据集和模型不变，只调整检索参数，建立可比较的 v2：

1. 将向量预过滤阈值从 `0.55` 降至 `0.40`，或取消 rerank 前的固定阈值。
2. 将 Retrieval TopK 从 20 提升到 40，让短文档和低分相关分块进入候选。
3. 保持 Rerank TopK=5，观察 rerank 是否能恢复正确文档并控制噪声。
4. 增加分阶段延迟指标和原始候选分数持久化。
5. 重新运行同一数据集，对比 Recall、错误拒答、引用精度和 P95 延迟。

这份报告是未人工美化结果的首个真实基线，应保留作为后续参数和模型改动的对照组。
