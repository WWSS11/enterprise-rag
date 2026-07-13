# 评测运行对比与质量门禁验证

日期：2026-07-13

## 目标

把已经建立的 RAG 指标转化为可执行发布门禁：候选策略可以改善部分指标或延迟，但只要核心 Recall、关键点覆盖、拒答或稳定性发生不可接受回退，API 必须返回失败并允许 CI/CD 阻止发布。

## API

- `POST /api/v1/evaluations/runs/{candidate_run_id}/compare`
- `POST /api/v1/evaluations/runs/{candidate_run_id}/gate`

请求至少包含：

```json
{
  "baseline_run_id": "6b2e4f43-c583-4a45-a611-cd2d13880129"
}
```

对比接口始终返回指标 delta、relative delta 和配置快照差异。门禁接口通过时返回 200；任一规则失败时写入审计日志并返回 HTTP 409，Problem Details 响应的 `data` 字段包含全部通过/失败检查。

## 默认规则

| 类型 | 指标 | 默认阈值 |
| --- | --- | ---: |
| 最大回退 | Retrieval Recall@K | 0 |
| 最大回退 | Rerank Recall@K | 0 |
| 最大回退 | Citation Recall | 0 |
| 最大回退 | Key-point Group Coverage | 0.02 |
| 最大回退 | Citation Key-point Support Rate | 0.02 |
| 最大回退 | Required-point Citation Precision | 0.02 |
| 最大回退 | Refusal Accuracy | 0 |
| 绝对下限 | Retrieval Recall@K | 0.95 |
| 绝对下限 | Rerank Recall@K | 0.90 |
| 绝对下限 | Refusal Accuracy | 0.95 |
| 最大增长 | Average First Token | 25% |
| 最大增长 | Average Total Latency | 20% |
| 稳定性 | Failed Cases | 必须为 0 |

## 真实运行验证

基线：Score-aware diversity `6b2e4f43-c583-4a45-a611-cd2d13880129`。

### 基线对比自身

结果：通过。所有 delta 为 0，证明默认门禁不会误拒绝相同结果。

### minimal-sufficient-v1

候选：`bc1fe9b2-38da-44fd-bddd-400d604a70ac`。

结果：拒绝。

| 失败指标 | 实际回退/增长 | 允许阈值 |
| --- | ---: | ---: |
| Citation Recall | 0.050000 | 0 |
| Key-point Group Coverage | 0.074166 | 0.020000 |
| Required-point Citation Precision | 0.025000 | 0.020000 |
| Average First Token | +26.04% | +25% |

### minimal-sufficient-v2

候选：`782f7d91-a208-45d8-8a69-ad6c4e9303b9`。

结果：拒绝。

| 失败指标 | 实际回退 | 允许阈值 |
| --- | ---: | ---: |
| Key-point Group Coverage | 0.054166 | 0.020000 |
| Required-point Citation Precision | 0.025000 | 0.020000 |

v2 的 Citation Recall、Citation Precision 和延迟优于 v1，但仍不能用这些局部收益交换关键点覆盖，因此门禁正确拒绝。

## 结论

门禁已经能复现本轮人工决策：控制运行通过，两个存在真实质量回退的 prompt 策略自动失败。后续 CI/CD 可以先创建候选评测运行，等待成功后调用 `/gate`；HTTP 409 直接终止部署，200 才允许进入下一阶段。

阈值可按数据集覆盖，但不建议在看到失败结果后临时放宽。应先解释回退原因、修复策略并重新运行，否则会把门禁退化为形式检查。
