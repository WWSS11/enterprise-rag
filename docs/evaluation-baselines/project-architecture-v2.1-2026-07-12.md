# 项目架构知识库 V2.1 质量基线

日期：2026-07-12  
数据集：`project-architecture-v1`（20 条可回答、5 条应拒答）  
V2 运行：`5688d38e-160a-4ec6-891a-b673811b687b`  
V2.1 运行：`a6b18d0c-22c4-4fda-aea6-fd2f4d36d6a2`

## 目标

V2 留下两个明确问题：

1. `legacy-frontend.html` 的页面标题问题是唯一零召回用例。
2. API 把所有生成上下文都作为 citations 返回，Citation Precision 只有 0.4167。

## 改动

- HTML 解析增加页面概览块，提取 `<title>`、品牌元素以及 `h1/h2/h3` 主要界面区域。
- `legacy-frontend.html` 新增包含“RAG 智能问答 / RAG Chat / 知识库”的 metadata retrieval chunk。
- 生成阶段保留全部候选为 `context_sources`，但 citations 只返回答案中实际出现的 `[来源:文件名#chunk-N]`。
- 拒答判断只检查答案开头的主结论，避免把后半段“未提供更多细节”的局部保留说明误判为整题拒答。

## 结果

| 指标 | V2 | V2.1 | 变化 |
| --- | ---: | ---: | ---: |
| Retrieval Recall@K | 0.9500 | 1.0000 | +0.0500 |
| Retrieval MRR | 0.7725 | 0.7850 | +0.0125 |
| Rerank Recall@K | 0.9500 | 1.0000 | +0.0500 |
| Rerank MRR | 0.9000 | 0.9500 | +0.0500 |
| Citation Precision | 0.4167 | 0.7167 | +0.3000 |
| Citation Recall | 0.9500 | 0.9750 | +0.0250 |
| Key-point Coverage | 0.8708 | 0.9625 | +0.0917 |
| Refusal Accuracy | 1.0000 | 1.0000 | 不变 |
| 平均首 token | 14,190 ms | 11,979 ms | -2,211 ms |
| 平均总耗时 | 17,387 ms | 15,050 ms | -2,337 ms |
| 成功用例 | 25/25 | 25/25 | 不变 |

目标 HTML 文档在对应问题的 40 条混合候选中排名第 4，零召回问题已经消失。

## 结论

页面级 metadata chunk 对标题、品牌、导航区域类问题有直接增益，不需要引入全量 summary chunk。把上下文来源与答案实际引用分离后，Citation Precision 提升 30 个百分点，同时 Citation Recall 继续提升。

V2.1 已达到当前数据集的 100% retrieval/rerank recall、100% 拒答准确率和 96.25% 关键点覆盖率。下一阶段不应继续扩大召回，而应聚焦答案级引用约束和外部 rerank 稳定性。

## 剩余问题

1. Citation Precision 为 0.7167，部分答案仍主动引用多个提供互补信息的文档，其中有些不属于评测集标注的唯一预期文档。需要区分“真实冗余引用”和“评测集 ground truth 标注不完整”。
2. 一条用例 Citation Recall 为 0.5，需要检查答案是否漏标一个必要来源，或该用例是否错误地要求两个文档都必须引用。
3. SiliconFlow rerank 偶发断连仍由 RRF fallback 吸收；应增加短重试和 fallback 计数指标。
