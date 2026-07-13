# 最少充分引用策略设计

日期：2026-07-13

## 目标

引用证据审计确认，源码 Score-aware 运行的 9 个允许集合之外引用中，5 个提供了有效补充证据，4 个属于背景或冗余引用。本阶段目标是在不损害 Citation Recall 和关键证据覆盖的前提下减少冗余引用。

## 被否决的自动过滤方案

### 仅使用 rerank 相对分数

候选方案：删除分数低于本题最高引用分数 10% 的引用。

| 运行 | 移除引用 | 移除预期引用 | Citation Precision | Citation Recall | Key-point Support Rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| 源码 Score-aware | 3 | 0 | 0.825000 → 0.858333 | 0.975000 → 0.975000 | 0.810833 → 0.810833 |
| 项目架构回归 | 10 | 5 | 0.916667 → 0.950000 | 1.000000 → 0.950000 | 0.975000 → 0.910000 |

该策略在源码集上看似有效，但在项目架构回归集误删 5 个预期引用，并同时降低 Citation Recall 与关键点支撑率，因此不能作为全局规则。

### 相对分数与绝对分数双门槛

即使只删除“相对分数低于 10%，且绝对分数低于 0.0025”的引用，项目架构回归仍会移除 2 个预期且支持关键点的引用。rerank 分数跨问题不可直接比较，绝对门槛同样不安全。

### 在生成前过滤上下文

对 rerank 候选应用 5%～20% 相对门槛，会丢失源码并发迁移题的低排名预期文档；项目架构集也会丢失自动评测或认证题的预期文档。因此保留完整 rerank/父级扩展上下文，不通过硬阈值换取表面 Citation Precision。

## 策略迭代

### `minimal-sufficient-v1`：未通过质量门禁

首个真实运行 `bc1fe9b2-38da-44fd-bddd-400d604a70ac` 与旧 Score-aware 基线使用完全相同的 Chat、Embedding、Rerank 和检索配置，唯一新增变量是引用策略。运行完成 25/25，期间一个 Chat 连接瞬断通过精确续跑恢复。

| 指标 | 旧 Score-aware | v1 | 变化 |
| --- | ---: | ---: | ---: |
| Citation Precision | 0.825000 | 0.816667 | -0.008333 |
| Citation Recall | 0.975000 | 0.925000 | -0.050000 |
| Key-point Group Coverage | 0.915833 | 0.841667 | -0.074166 |
| Citation Key-point Support Rate | 0.810833 | 0.845833 | +0.035000 |
| Refusal Accuracy | 1.000000 | 1.000000 | 0 |

v1 的结构解析结果为：有效率 1.0、策略合规率 1.0、无效/歧义/不精确/连续重复标记均为 0。但它通过减少答案覆盖提高了“已回答关键点支撑率”，同时损害整体关键点覆盖和 Citation Recall，不属于真实质量提升。

根因用例是 reindexing 查询：模型看到了低排名但唯一包含查询过滤逻辑的 `rag-graph` 证据，却受到显式“证据优先级”提示影响而声称资料未提供查询代码，Citation Recall 从 1 降为 0。

### `minimal-sufficient-v2`：仍未通过质量门禁

v2 移除显式证据优先级，并强调完整性和低排名唯一证据。真实运行 `782f7d91-a208-45d8-8a69-ad6c4e9303b9` 完成 25/25：

| 指标 | 旧 Score-aware | v1 | v2 |
| --- | ---: | ---: | ---: |
| Citation Precision | 0.825000 | 0.816667 | 0.825000 |
| Citation Recall | 0.975000 | 0.925000 | 0.975000 |
| Key-point Group Coverage | 0.915833 | 0.841667 | 0.861667 |
| Citation Key-point Support Rate | 0.810833 | 0.845833 | 0.827500 |
| Refusal Accuracy（确定性重算后） | 1.000000 | 1.000000 | 1.000000 |
| Average First Token | 18843.13 ms | 23749.40 ms | 15325.34 ms |
| Average Total Latency | 24746.02 ms | 27440.59 ms | 19491.54 ms |

v2 恢复了 Citation Recall 和 Citation Precision，并显著降低延迟，但关键点覆盖仍低于控制版本，且没有获得引用质量净增益，因此仍不部署。原始运行中的唯一拒答错误来自评测器未识别答案开头“无法提供”；新增拒答标记后无模型重算恢复为 1.0。

### 部署方案：`citation-integrity-v1`

两轮 prompt 实验都被质量门禁拒绝。默认恢复到旧 Score-aware 基线使用的生成提示，只部署不会改变回答内容的引用完整性能力：

- 严格解析来源文件与 chunk。
- 记录无效、歧义、不精确、连续重复和跨结论重复标记。
- 在聊天 metadata、SSE、审计日志和评测汇总中暴露诊断。
- 在配置快照中保存策略版本。

将 `citation-integrity-v1` 解析器离线应用到旧 Score-aware 基线的 25 条持久化答案后，25 个用例的引用集合全部与原结果一致。共解析 114 个标记：invalid、ambiguous、imprecise、同一连续引用簇 duplicate 均为 0；69 个标记属于同一来源在不同结论中的合法重复就近引用。

### 严格解析

- 精确文件名与 chunk 匹配才进入 citations。
- 省略 chunk 编号时，只有该文件在当前上下文中恰好对应一个候选才能解析。
- 同一文件存在多个候选时不猜测，记为 ambiguous。
- 只有一个候选时可以兼容解析省略 chunk 的标记，但仍记为 imprecise。
- 不存在的文件/chunk 记为 invalid。
- 同一 chunk 重复出现时只返回一次，并记录 duplicate。
- 同一来源在不同结论中再次就近标注记录为 repeated，不视为连续重复违规。

### 可观测字段

`citation_diagnostics` 保存：

- `policy_version`
- `markers_seen`
- `valid_markers`
- `compliant_markers`
- `invalid_markers`
- `ambiguous_markers`
- `imprecise_markers`
- `duplicate_markers`
- `repeated_markers`

评测汇总增加标记有效率、策略合规率、重复率以及各类异常数量。聊天非流式 metadata、SSE 最终 metadata 和审计日志也返回同一诊断。无检索结果的拒答同样返回全零诊断和当前策略版本。

## 验证边界

Chat、Embedding 和 Rerank 已完成真实连通性验证。两轮实验共同证明“引用结构合规”或更低延迟不能替代答案完整性；任何未来引用 prompt 改造都必须同时满足覆盖率、Recall、拒答和引用诊断门槛。

上线门槛建议保持：Citation Recall 不下降，关键点支撑率不下降，无效/歧义标记为 0，并观察 Citation Precision 与重复标记率是否改善。
