# 公开企业合规法规基线 v2 — 2026-08-04

## 结论

`public-compliance-v2` 的真实 Baseline 和 Candidate 均完成 25/25 条用例，失败用例为 0。
两轮运行配置快照完全一致；重算后默认质量门禁返回 HTTP 200，审计记录为 `passed: true`，
可以作为公共、非敏感法规语料的后续候选版本比较基线。

本结果不代表内部脱敏业务资料已获准发送给当前模型链路。当前 Chat 中转服务仍无可公开核验的
数据条款，因此本轮继续只对公开法律文本使用 `public-data-exception`。

## 固定输入与运行标识

- 清单：`docs/evaluation-datasets/public-compliance-v2.json`
- 清单 SHA-256：`2d940cb1682f13b994c7ecd73ad0008377ac7d1e041c97541eacc00c2b7e8c46`
- 文档：10 份公开法规摘录；沿用 v1 的权威来源与逐文件 SHA-256。
- 用例：25 条；20 条可回答、5 条拒答，运行前已固定关键点同义组。
- 知识库 ID：`ca280832-8e56-42d6-b215-ba7be115e8f8`
- 评测集 ID：`a998bdd5-6a8b-4439-bb15-108d8e23c1fe`
- Baseline 运行 ID：`fc12e749-a660-490c-a841-4f0bff25ca06`
- Candidate 运行 ID：`55c22d15-ed89-4bf5-987f-61475a637b8e`
- 已验证的租户级全量重建任务 ID：`ca14c984-3147-4238-a252-83df5e5c0788`
- 两次运行配置快照差异：无。

v2 没有修改已参与评测的 v1 数据集。它在首次导入前，根据 v1 暴露的真实等价表达补充数字、
介词和常见改写同义组，然后作为新的不可变评测集运行。

## 指标

| 指标 | Baseline | Candidate | 结果 |
| --- | ---: | ---: | --- |
| Retrieval Recall@K | 1.000000 | 1.000000 | 通过 |
| Retrieval MRR | 1.000000 | 1.000000 | 通过 |
| Rerank Recall@K | 1.000000 | 1.000000 | 通过 |
| Rerank MRR | 1.000000 | 1.000000 | 通过 |
| Citation Precision | 1.000000 | 1.000000 | 通过 |
| Citation Recall | 1.000000 | 1.000000 | 通过 |
| Key Point Coverage | 0.950000 | 0.966667 | 通过 |
| Key Point Group Coverage | 1.000000 | 1.000000 | 通过 |
| Citation-grounded Key Point Coverage | 0.983333 | 0.983333 | 通过 |
| Citation Key Point Support Rate | 0.983333 | 0.983333 | 通过 |
| Citation Required Point Precision | 1.000000 | 1.000000 | 通过 |
| Refusal Accuracy（重算后） | 1.000000 | 1.000000 | 通过 |
| 平均首 Token 延迟 | 7833.57 ms | 7417.92 ms | 改善约 5.31% |
| 平均总延迟 | 8787.98 ms | 7881.14 ms | 改善约 10.32% |
| 失败用例 | 0 | 0 | 通过 |

## 拒答重算与门禁证据

Candidate 首次计算仅有一条拒答误判：答案开头明确写明“根据给定资料，无法得知……资料中
没有提供……”，但检测器缺少“无法得知”这一等价表达。增加该表达及回归测试后，只对两轮
已持久化答案按同一逻辑重算指标，没有重跑模型、修改答案或放宽阈值。

- 2026-08-04 07:22（Asia/Shanghai）Candidate 重算完成。
- 随后的质量门禁审计记录：`passed: true`、`failed_metrics: []`。
- 显式维护 Playwright：1/1 通过，门禁必须返回 HTTP 200。

## 适用边界与后续动作

该基线证明公开法规集的真实 OIDC、入库、Embedding、Milvus、检索、Rerank、Chat、引用、
评测比较和质量门禁链路可以闭环。它不能替代企业内部业务验收，也不能将公共数据例外扩展到
内部资料。

T13 后续只剩外部输入：取得经业务与安全负责人批准的内部脱敏资料、模型供应商数据处理结论
和首批业务规模预估，再按同一流程建立内部 Baseline/Candidate。完成前 T13 保持
`in_progress`。
