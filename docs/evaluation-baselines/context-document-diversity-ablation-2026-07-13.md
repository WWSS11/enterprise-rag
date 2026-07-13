# 上下文文档多样性消融实验

日期：2026-07-13

## 实验目标

源码 holdout v1 暴露出一个明确问题：目标文档已经进入 Rerank Top8，但同一文档的多个高排名 retrieval chunk 会先占满 5 个 parent group / 4000 tokens，导致排名稍后的跨文档证据没有进入有效生成上下文。

本实验保持以下项目不变：

- atomic / retrieval / parent chunk 参数
- 已入库向量和 Milvus alias
- Dense + BM25 + RRF Retrieval Top40
- Rerank Top8
- 相邻章节窗口、上下文数量和 token 预算
- Chat、Embedding 和 Rerank 模型

唯一变量是 rerank 后进入 parent 扩展的候选顺序。

## 实验策略

### Control：原始 rerank 顺序

完全按照 rerank 返回顺序扩展 parent。重复命中同一文档时，可以连续消耗多个上下文位置。

### Naive diversity：无条件文档多样性

先为每个不同文档选择一个候选，再补充重复文档。该策略能够覆盖跨文档证据，但也会把极低分噪声提前。

### Score-aware diversity：分数感知文档多样性

仅当候选分数不低于最高 rerank 分数的 10% 时，才参与“每个文档优先一个”的排序；其余候选保持在后续原始顺序中。

```text
eligible_score >= max_rerank_score * 0.1
```

该策略不增加模型调用、检索数量或上下文预算，只进行 O(n) 的稳定重排。

## 源码 Holdout 对比

数据集：`源码实现独立验证集 v1`  
Control 运行：`b809d964-509f-4a0a-a204-2d91420d301e`  
Naive diversity：`9fbe67dc-9817-4ab1-a2a5-3e9876b49cb7`  
Score-aware diversity：`6b2e4f43-c583-4a45-a611-cd2d13880129`

| 指标 | Control | Naive | Score-aware |
| --- | ---: | ---: | ---: |
| Retrieval Recall@K | 1.0000 | 1.0000 | 1.0000 |
| Retrieval MRR | 0.7601 | 0.7601 | 0.7601 |
| Rerank Recall@K | 0.9750 | 0.9750 | 0.9750 |
| Rerank MRR | 0.9167 | 0.9167 | 0.9167 |
| Citation Precision | 0.8167 | 0.8000 | **0.8250** |
| Citation Recall | 0.9250 | **0.9750** | **0.9750** |
| Key-point Coverage | 0.7858 | 0.7442 | **0.7958** |
| Refusal Accuracy | 0.9200 | **0.9600** | **0.9600** |
| Rerank Retry Rate | 0.0800 | 0.1600 | 0.1200 |
| Rerank Fallback Rate | 0.0000 | 0.0000 | 0.0000 |
| 平均首 token | 18,100 ms | 24,050 ms | 18,843 ms |
| 平均总耗时 | 23,536 ms | 29,383 ms | 24,746 ms |

> 上表的 Refusal Accuracy 是三次运行结束时的原始规则结果。首结论句拒答规则确定性重算后，Control / Naive / Score-aware 分别为 0.9600 / 1.0000 / 1.0000；其他指标不变。详见 [`refusal-detection-recalculation-2026-07-13.md`](refusal-detection-recalculation-2026-07-13.md)。

Retrieval 和 Rerank 指标完全一致，证明实验没有改变召回与排序层。Naive diversity 虽然提高 Citation Recall 和拒答准确率，但 Citation Precision 与关键点覆盖下降，说明无条件提升低分文档会引入噪声。

Score-aware diversity 保留了跨文档召回收益，同时 Citation Precision 和关键点覆盖均高于 Control。本轮 retry rate 不同来自外部 rerank 的瞬时重试，策略本身没有增加网络请求。

## 目标问题验证

问题：`文档处于 reindexing 状态时，查询链路为什么仍能使用旧索引？`

Control 中，`rag-graph.py.txt` 已进入 rerank，但排在多个 documents/ingestion chunk 之后，没有进入有效生成上下文：

| 指标 | Control | Score-aware |
| --- | ---: | ---: |
| Citation Recall | 0.0000 | **1.0000** |
| Key-point Coverage | 0.5000 | **1.0000** |
| Refusal Correct | false | **true** |

Score-aware 策略将符合 10% 分数门槛的 `rag-graph` 首个候选提前到第三个文档位置，回答成功引用查询过滤代码，并消除错误拒答。

对照问题 `Dense 与 BM25 两路召回结果如何融合？` 中，Milvus 候选最高分为约 0.94，而其他文档只有约 0.0014，低于 10% 门槛，因此顺序保持不变，Citation Precision、Citation Recall 和关键点覆盖继续保持 1.0。

## 项目架构回归验证

数据集：`项目架构质量基线 v1`  
参考结果：V2.3 ground-truth 审计口径  
Score-aware 运行：`5b3d2c51-8b56-480d-a667-e4d4e113751a`

| 指标 | V2.3 | Score-aware |
| --- | ---: | ---: |
| Retrieval Recall@K | 1.0000 | 1.0000 |
| Retrieval MRR | 0.7850 | 0.7892 |
| Rerank Recall@K | 1.0000 | 1.0000 |
| Rerank MRR | 0.9500 | 0.9500 |
| Citation Precision | 0.8917 | **0.9167** |
| Citation Recall | 1.0000 | 1.0000 |
| Key-point Coverage | 0.9375 | **0.9583** |
| Refusal Accuracy | 1.0000 | 1.0000 |
| 平均首 token | 13,317 ms | 15,284 ms |
| 平均总耗时 | 16,162 ms | 18,685 ms |

回归集没有出现质量下降。生成指标存在模型随机性，延迟也受到本轮 12% rerank retry rate 影响；排序函数本身不增加外部调用，计算开销相对可以忽略。

## 决策

默认启用 Score-aware document diversity：

```text
APP_CONTEXT_DOCUMENT_DIVERSITY_ENABLED=true
APP_CONTEXT_DOCUMENT_DIVERSITY_MIN_SCORE_RATIO=0.1
```

保留配置开关以便回退或继续消融。Naive diversity 不启用。

这次结果进一步说明，当前瓶颈不是 chunk token 参数，而是 rerank 后有限上下文预算的分配方式。下一阶段应单独处理评测器对“讨论拒答机制”类元问题的误判，不继续修改分块大小。
