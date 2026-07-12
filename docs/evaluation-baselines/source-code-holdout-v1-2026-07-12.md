# 源码实现独立验证集 v1

日期：2026-07-12  
知识库：`源码实现独立验证集 v1`  
知识库 ID：`7d05fa39-d8c0-4dfb-848c-233e6f936ddd`  
数据集 ID：`09473116-ce04-457e-9d2a-d80607132928`  
运行 ID：`b809d964-509f-4a0a-a204-2d91420d301e`

## 验证目的

本轮不复用项目架构基线的 7 份说明文档和 25 条问题，直接使用当前实现源码建立独立语料，检验多粒度分块、Dense + BM25 混合召回、rerank、父级扩展、引用和拒答在源码类长文档上的泛化能力。

问题和 ground truth 在文档入库与运行评测前固定。运行结束后不修改本报告中的原始指标，避免把审计修正伪装成系统质量提升。

## 语料与规模

语料包含 10 份此前未进入评测知识库的实现文件：

- chunking、ingestion、job control、Milvus、rerank 和 evaluation service
- LangGraph 工作流
- Celery 配置
- 文档重新索引 API
- 并发唯一约束迁移

源码通过 `.txt` 上传名进入现有纯文本解析链路，没有为本轮增加代码专用解析器或调整 chunk 参数。

| 层级 | 数量 |
| --- | ---: |
| 文档 | 10 |
| Atomic unit | 320 |
| Parent section | 62 |
| Retrieval chunk | 185 |
| 评测用例 | 25（20 条可回答、5 条应拒答） |

数据集定义见 [`source-code-holdout-v1.json`](../evaluation-datasets/source-code-holdout-v1.json)。

## 配置

- Atomic：160 tokens
- Retrieval：320 tokens，overlap 48
- Parent：960 tokens
- Embedding context：400 tokens
- Semantic break：差异最大的 15%，阈值 0.58
- Hybrid retrieval：Top40，Dense + BM25 + RRF
- Rerank：Top8，最多 2 次尝试
- Context：最多 5 组、4000 tokens、相邻窗口 1

## 原始结果

| 指标 | Holdout v1 |
| --- | ---: |
| Retrieval Recall@K | 1.0000 |
| Retrieval MRR | 0.7601 |
| Rerank Recall@K | 0.9750 |
| Rerank MRR | 0.9167 |
| Citation Precision | 0.8167 |
| Citation Recall | 0.9250 |
| Key-point Coverage | 0.7858 |
| 综合拒答准确率 | 0.9200 |
| 无答案问题正确拒答率 | 1.0000（5/5） |
| 可回答问题错误拒答 | 2/20 |
| Rerank Retry Rate | 0.0800（2/25） |
| Rerank Fallback Rate | 0.0000 |
| 平均首 token | 18,100 ms |
| 平均总耗时 | 23,536 ms |
| 首 token P50 / P95 | 12,991 / 46,472 ms |
| 总耗时 P50 / P95 | 19,490 / 49,398 ms |
| 执行成功 | 25/25 |

## 与项目架构开发集对比

| 指标 | 项目架构 V2.3 | 源码 Holdout v1 |
| --- | ---: | ---: |
| Retrieval Recall@K | 1.0000 | 1.0000 |
| Retrieval MRR | 0.7850 | 0.7601 |
| Rerank Recall@K | 1.0000 | 0.9750 |
| Rerank MRR | 0.9500 | 0.9167 |
| Citation Precision | 0.8917 | 0.8167 |
| Citation Recall | 1.0000 | 0.9250 |
| Key-point Coverage | 0.9375 | 0.7858 |
| 综合拒答准确率 | 1.0000 | 0.9200 |

当前方案没有只记住原开发集：在 185 个源码 retrieval chunk 上仍保持 100% 预召回和 91.67% rerank MRR。但生成、引用和多文档问题出现了明显下降，因此“开发集 100% Recall”不能继续被解释为全局最优。

## 主要发现

### 1. 预召回泛化良好，但 Top40 仍然较宽

20 条可回答问题的所有权威文档都进入了 40 条混合候选。Retrieval MRR 为 0.7601，说明正确文档通常较靠前，但源码中的英文标识符、相似函数名和中文问题会降低原始排序。

当前 Top40 占 185 个 retrieval chunk 的约 21.6%。这一结果证明混合召回没有失效，但仍需通过更大知识库验证候选比例下降后的表现。

### 2. 小型迁移文件在跨文档问题中被 rerank 漏掉

“重新索引接口和数据库迁移分别如何阻止同一文档出现两个活动任务？”要求同时命中 API 和迁移文件。迁移文件进入 Retrieval Top40，但文档级位置为第 36，未进入 Rerank Top8，导致该题 Rerank Recall 和 Citation Recall 均为 0.5。

这说明小型代码/配置文档仅依靠文件名和原始代码 embedding 时，中文意图可能不足以把它提升到 rerank 前列。文档级摘要、代码结构元数据或查询扩展是候选方案，但需要消融实验后才能启用。

### 3. 上下文扩展缺少文档多样性约束

“reindexing 状态为什么仍能使用旧索引”中，`rag-graph.py.txt` 已被 rerank 命中，但前面存在多个 `documents-api` 和 `ingestion-service` chunk。当前扩展按 rerank 顺序消费最多 5 个 parent group 和 4000 tokens，没有优先覆盖不同文档，最终回答没有使用查询过滤代码，并错误表示资料不足。

下一轮最值得验证的改动不是继续调 chunk 大小，而是对上下文扩展做文档多样性消融：第一轮每个文档最多选择一个 parent，剩余预算再补同文档的第二个 parent。

### 4. 关键点覆盖的精确字符串规则低估了部分正确答案

20 条可回答题中有 11 条 Key-point Coverage 低于 0.8。人工检查发现多项属于同义表达或代码等价表达，例如：

- “对话历史”没有匹配“历史消息”；
- “至少比旧值大 1”没有匹配“至少增加 1”；
- `1.0 / first_rank` 没有匹配“倒数”；
- “反向释放”没有匹配“相反顺序”。

因此 0.7858 是严格词面覆盖率，不等同于语义正确率。后续可为关键点增加同义词组，或增加独立的可选语义裁判，但不能直接改写本轮原始结果。

### 5. 拒答检测存在元问题误判

5 条真正无答案问题全部正确拒答。两个错误拒答中，一条是“拒答检测为什么只检查答案开头”，答案为了说明实现而在开头出现“无法回答/拒答”等术语，被确定性拒答检测误判。这属于评测器对元问题的误判，不是模型真的拒绝回答。

另一条是真实生成问题：reindexing 查询题没有获得足够直接的查询代码上下文，模型在回答开头表达资料不足。

### 6. 引用问题同时包含标注缺口和真实冗余

7 条可回答题 Citation Precision 低于 1.0。其中部分补充文档确实直接支持结论，例如旧版本清理同时引用 ingestion 调用方和 Milvus 删除条件；另一些则是模型把背景实现一并引用，例如 Celery 配置题额外引用 job control 和 documents API。

本报告保留运行前固定的允许引用集合。后续可以单独发布 ground-truth 审计结果，但不得覆盖本轮 0.8167 的原始基线。

## 结论

当前多粒度 chunk 与 hybrid retrieval 路线仍然有效，没有陷入无效循环：它在独立源码语料上保持了 100% 预召回、97.5% rerank recall 和 5/5 无答案拒答。

同时，本轮已经找到比继续修改 `160/320/48/960` 更明确的下一实验方向：

1. 上下文扩展增加文档多样性策略，并与当前顺序策略做消融。
2. 为小型代码/配置文档验证文档级摘要或结构上下文是否能提升跨文档 rerank。
3. 修复拒答检测对“讨论拒答机制”这类元问题的误判。
4. 关键点指标保持原始词面分数，同时增加独立的审计层，不覆盖历史结果。

在完成消融前，不继续调整 chunk token 参数，也不引入神经 sparse 模型。
