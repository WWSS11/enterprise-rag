# 引用证据支撑基线

日期：2026-07-13

## 目标

原 `citation_precision` 只能判断引用文档是否属于人工标注的允许集合，不能判断引用内容是否真正支撑答案结论。因此低分可能来自两种完全不同的情况：

- ground truth 偏窄：额外文档确实包含直接支持证据。
- 模型冗余引用：文档只提供背景，没有支撑本题必答关键点。

本阶段保留原 Citation Precision，不覆盖历史值，新增独立的确定性证据支撑指标。

## 实现

- 新评测运行从 LangGraph 的 `expanded` 状态提取答案实际引用的父章节与相邻章节上下文。
- `evaluation_results.citation_evidence` 保存引用证据快照、文档/chunk 标识、索引版本和是否重建。
- 历史运行没有快照时，根据持久化 rerank chunk、父章节、相邻窗口和运行配置重建一次，并标记 `reconstructed=true`。
- 证据核验复用人工审计的 `required_key_point_groups`，不调用 Chat、Embedding、Rerank 或裁判模型。

新增指标：

| 指标 | 含义 |
| --- | --- |
| `citation_grounded_key_point_coverage` | 全部必答关键点中，同时在答案与引用证据命中的比例 |
| `citation_key_point_support_rate` | 答案已经表达的关键点中，得到引用证据支撑的比例 |
| `citation_required_point_support_precision` | 被引用 chunk 中，至少支撑一个已表达必答关键点的比例 |

逐用例 metrics 还保存支持/未支持的关键点组、支持/未支持的 chunk ID，以及每组对应的支持引用，便于人工追查。

## 四个历史运行回算

| 运行 | Citation Precision | Grounded Coverage | Key-point Support Rate | Required-point Citation Precision |
| --- | ---: | ---: | ---: | ---: |
| 源码 Control `b809d964-509f-4a0a-a204-2d91420d301e` | 0.816667 | 0.755833 | 0.835833 | 0.875000 |
| Naive diversity `9fbe67dc-9817-4ab1-a2a5-3e9876b49cb7` | 0.800000 | 0.726667 | 0.819167 | 0.875000 |
| Score-aware diversity `6b2e4f43-c583-4a45-a611-cd2d13880129` | 0.825000 | 0.730833 | 0.810833 | 0.900000 |
| 项目架构回归 `5b3d2c51-8b56-480d-a667-e4d4e113751a` | 0.916667 | 0.933333 | 0.975000 | 0.865000 |

本次回算只使用已持久化答案和本地 PostgreSQL 文档章节，没有外部模型调用。四个历史运行的证据快照属于重建结果；之后的新运行会保存实际生成上下文，不再依赖重建。

## Score-aware 引用误差拆分

源码 Score-aware 运行中，可回答问题共有 9 个引用 chunk 不属于该用例的允许引用文档：

- 5 个仍然支撑至少一个已表达的必答关键点，属于 ground truth 偏窄或补充证据。
- 4 个没有支撑任何已表达的必答关键点，属于当前规则下的背景/冗余引用。

典型补充证据包括：

- 文档重投题引用 job-control 注释来支撑 late-ack redelivery。
- reindexing 可用性题引用 documents API 来支撑过渡状态设置。
- 重新索引并发题引用 job-control 实现来支撑活动任务查询。
- Milvus 旧版本清理题引用 Milvus service 来支撑实际删除条件。

典型冗余证据包括：

- Celery 配置题额外引用 documents API 的任务投递背景。
- advisory lock 顺序题额外引用 ingestion 调用位置，但没有覆盖本题顺序关键点。

因此 `0.825` 的 Citation Precision 不能直接解释为 17.5% 的引用错误；新指标显示，被引用 chunk 对必答关键点的支撑精度为 `0.900`，但关键点支撑率只有 `0.810833`，说明当前更明确的瓶颈是部分答案结论没有在所引用证据中形成可确定匹配。

## 边界

当前核验是确定性别名匹配，不具备逻辑推理能力。例如源码通过 `shared=True` 与 `shared=False` 隐含“共享锁/独占锁互斥”，但未出现自然语言“互斥”时会产生假阴性。它也只验证评测集声明的必答关键点，不判断所有背景句是否正确。

因此这些指标适合作为低成本、可重复的质量门禁和人工审计入口，不应命名或解释为完整的语义蕴含分数。未来如加入 LLM-as-Judge，应作为独立指标，并用固定抽样人工复核其误差。
