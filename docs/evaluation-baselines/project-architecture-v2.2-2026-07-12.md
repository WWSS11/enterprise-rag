# 项目架构知识库 V2.2 稳定性基线

日期：2026-07-12  
数据集：`project-architecture-v1`（25 条）  
V2.1 运行：`a6b18d0c-22c4-4fda-aea6-fd2f4d36d6a2`  
V2.2 运行：`20d04037-cd76-4e70-a1ea-4ef12527bc89`

## 目标

V2.1 已达到 100% 检索召回，但外部 rerank 服务偶发断连只能直接回退 RRF。本阶段验证短重试能否吸收瞬时故障，并把 retry/fallback 从日志事件提升为可统计指标。

## 改动

- rerank 请求超时默认 30 秒。
- 最多尝试 2 次，第一次失败后按 0.5 秒指数退避。
- 仅对 timeout、网络传输错误、HTTP 429 和 HTTP 5xx 重试；HTTP 4xx 与响应格式错误直接 fallback。
- 每条 reranked document 保存 `rerank_status`、`rerank_attempts` 和 `rerank_fallback_reason`。
- 评测汇总增加 `rerank_retry_rate` 与 `rerank_fallback_rate`。
- Prometheus 增加 rerank operation、HTTP attempt 和端到端耗时指标。

## 稳定性结果

| 指标 | V2.2 |
| --- | ---: |
| 首次尝试成功 | 24/25 |
| 发生重试 | 1/25 |
| 重试后成功 | 1/1 |
| Rerank Retry Rate | 0.0400 |
| Rerank Fallback Rate | 0.0000 |
| 评测失败 | 0/25 |

本轮发生的一次瞬时故障被第二次请求恢复，没有进入 RRF fallback，说明短重试对当前服务有效。

## 质量结果

| 指标 | V2.1 | V2.2 |
| --- | ---: | ---: |
| Retrieval Recall@K | 1.0000 | 1.0000 |
| Retrieval MRR | 0.7850 | 0.7850 |
| Rerank Recall@K | 1.0000 | 1.0000 |
| Rerank MRR | 0.9500 | 0.9500 |
| Citation Precision | 0.7167 | 0.6917 |
| Citation Recall | 0.9750 | 1.0000 |
| Key-point Coverage | 0.9625 | 0.9375 |
| Refusal Accuracy | 1.0000 | 1.0000 |
| 平均首 token | 11,979 ms | 13,317 ms |
| 平均总耗时 | 15,050 ms | 16,162 ms |

检索与排序指标完全稳定；生成类指标的小幅波动来自聊天模型输出随机性。一次重试使平均延迟略增，但没有牺牲可用性。

## Prometheus 验证

真实在线 `/api/v1/chat` 请求已在 API 进程中生成以下样本：

- `rag_rerank_requests_total{outcome="success",reason="none"}`
- `rag_rerank_attempts_total{outcome="success"}`
- `rag_rerank_duration_seconds`

在线聊天 rerank 在 API 进程执行，因此由 API `/metrics` 暴露。Celery 离线评测发生在 Worker 进程，其稳定性通过 PostgreSQL 中的逐用例 metrics 和评测汇总统计；当前不伪装成 API 进程的 Prometheus 样本。

## 结论

V2.2 在不改变检索质量的前提下，把本轮 fallback 从潜在的 4% 降到 0，并提供了可追踪的失败分类。当前不需要增加更多重试次数：超过 2 次会显著放大尾延迟，服务持续故障时应快速 fallback 到 RRF。

下一步应审查 Citation Precision 剩余的多文档引用是否属于评测标注不完整，并为 fallback rate、retry rate 和 rerank P95 延迟配置告警阈值。
