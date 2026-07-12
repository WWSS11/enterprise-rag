# 项目架构知识库 V2 质量基线

日期：2026-07-12  
数据集：`project-architecture-v1`（25 条：20 条可回答、5 条应拒答）  
旧运行：`b96bae56-ccb6-4a1b-9d0e-77f451e90cec`  
V2 运行：`5688d38e-160a-4ec6-891a-b673811b687b`

## 本次变更

- 结构解析保留 Markdown、HTML、DOCX 标题路径，以及 PDF 页码、PPT 幻灯片、Excel Sheet 等位置元数据。
- PostgreSQL 持久化 atomic、retrieval、parent 三层关系。
- retrieval chunk 使用文档名、章节路径和位置上下文生成 embedding。
- Milvus 使用 Dense Vector + 内置 BM25，并通过 RRF 融合 40 条候选。
- reranker 选出 8 条 retrieval chunk 后，再扩展父节及前后相邻章节，最终最多使用 5 组上下文。
- 取消 rerank 前的 `0.55` dense 硬阈值。
- 语义断点只保留相邻 atomic 差异最大的 15%，避免长文档被过度切碎。

最终 7 份文档生成 362 个 atomic unit、91 个 parent section 和 112 个 retrieval chunk。parent section 的 token 中位数为 98，平均值为 154；调优前的中间版本曾产生 201 个 parent、216 个 retrieval chunk，中位数只有 33 tokens。

## 结果对比

旧运行也使用当前拒答判定规则重新计算，保证比较口径一致。指标重算只使用已经持久化的答案、排序和引用，不再次调用模型。

| 指标 | V1 | V2 | 变化 |
| --- | ---: | ---: | ---: |
| Retrieval Recall@K | 0.4000 | 0.9500 | +0.5500 |
| Retrieval MRR | 0.3875 | 0.7725 | +0.3850 |
| Rerank Recall@K | 0.4000 | 0.9500 | +0.5500 |
| Rerank MRR | 0.3917 | 0.9000 | +0.5083 |
| Citation Precision | 0.4722 | 0.4167 | -0.0556 |
| Citation Recall | 0.4000 | 0.9500 | +0.5500 |
| Key-point Coverage | 0.3725 | 0.8708 | +0.4983 |
| Refusal Accuracy | 0.5200 | 1.0000 | +0.4800 |
| 平均首 token | 12,409 ms | 14,190 ms | +1,781 ms |
| 平均总耗时 | 13,953 ms | 17,387 ms | +3,434 ms |
| 成功用例 | 25/25 | 25/25 | 不变 |

## 结论

V2 已解决原基线最主要的问题：相关文档在 rerank 前被硬阈值删除。Recall@K、引用召回、关键点覆盖和拒答均出现显著提升，证明上下文感知多粒度分块与 Dense+BM25 混合召回适合当前项目。

延迟增长约 25%，来自候选数增加、rerank 和父/邻节扩展；当前仍在可接受的质量优先阶段。SiliconFlow rerank 接口在运行期间偶尔断开，系统按设计回退到 RRF 顺序，25 条用例没有失败。

## 未解决问题

1. `旧版前端页面的标题是什么，并包含哪个主要管理区域？` 仍然是唯一的零召回可回答问题。需要检查 HTML 标题、短文本和管理区域是否应合并到同一 retrieval chunk，或为文档级标题增加独立检索字段。
2. Citation Precision 降至 0.4167。当前 API 将提供给模型的上下文来源全部作为 citations 返回，而不是只保留答案实际引用的来源。下一阶段应解析答案中的 `[来源:...]` 标记，区分 `context_sources` 与 `answer_citations`。
3. 外部 rerank 服务存在偶发断连。后续应增加短重试、熔断统计和 rerank fallback 指标，避免只在日志中观察。

## 下一步

优先修复引用精度和唯一零召回用例，然后使用同一数据集运行 V2.1。暂不增加 summary chunk 或第二套神经 sparse 模型，除非评测证明它们能继续提升剩余问题。
