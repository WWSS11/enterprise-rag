# T13 真实业务评测包与基线操作

本文档只覆盖应用层真实链路和业务质量基线，不涉及部署环境建设。真实业务资料、访问令牌、
模型密钥和运行日志不得提交到仓库。

## 1. 评测包安全边界

把已脱敏资料和清单保存在受控目录，例如 `/secure/t13-baseline/`。`source_path` 相对于
`--repository-root` 解析，因此清单和资料都可以位于仓库之外。

T13 清单必须声明：

- `profile` 为 `business-baseline`；
- 10～50 份文档、20～50 条用例，其中 5～10 条为拒答题；
- 数据不是纯合成数据，且已批准发送给当前测试环境使用的外部模型；
- 已检查模型供应商的训练使用、数据保留和删除规则；
- 每条可回答问题具有权威文档和必答关键点，拒答题不得绑定文档或关键点。

安全声明是执行前的机器门禁，不代替真实审批。`approval_reference` 只填写内部审批编号或
工单编号，不要填写审批内容、人员隐私或任何凭据。

清单结构示例：

```json
{
  "schema_version": "1.0",
  "profile": "business-baseline",
  "name": "脱敏业务基线 v1",
  "description": "经业务负责人确认的标准问题集",
  "knowledge_base": {
    "slug": "business-baseline-v1",
    "name": "脱敏业务基线 v1",
    "description": "仅用于 T13 评测",
    "access_mode": "restricted"
  },
  "safety": {
    "data_classification": "internal-sanitized",
    "approved_for_external_models": true,
    "provider_training_use_reviewed": true,
    "provider_retention_reviewed": true,
    "provider_review_outcome": "approved",
    "provider_review_notes": "审批结论摘要，不得包含凭据或敏感内容",
    "approval_reference": "TICKET-1234"
  },
  "documents": [
    {
      "source_path": "documents/policy-a.pdf",
      "upload_name": "policy-a.pdf",
      "sha256": "可选的64位小写SHA-256"
    }
  ],
  "cases": [
    {
      "question": "已批准的业务问题",
      "reference_answer": "由业务负责人确认的标准答案",
      "expected_document_names": ["policy-a.pdf"],
      "acceptable_citation_document_names": ["policy-a.pdf"],
      "required_key_points": ["关键事实"],
      "required_key_point_groups": [["关键事实", "允许的同义表达"]],
      "should_refuse": false,
      "tags": ["business", "policy"]
    },
    {
      "question": "资料中不存在的信息是什么？",
      "reference_answer": "知识库没有足够信息回答。",
      "expected_document_names": [],
      "required_key_points": [],
      "should_refuse": true,
      "tags": ["business", "refusal"]
    }
  ]
}
```

示例只展示字段，实际清单仍须达到 T13 的数量门槛。

`provider_review_outcome` 通常必须为 `approved`。只有资料本身已经公开、不含个人信息或商业
秘密，且风险负责人明确接受供应商条款无法完全核验的剩余风险时，才能使用
`public-data-exception`；该例外对 `internal-sanitized` 数据无效，`blocked` 会直接阻止执行。

## 2. 只校验，不上传

先执行无副作用校验：

```bash
.venv/bin/python scripts/validate_evaluation_package.py \
  /secure/t13-baseline/manifest.json \
  --repository-root /secure/t13-baseline \
  --require-t13
```

也可以使用导入工具的默认 dry-run。未传 `--apply` 时工具不会调用 API：

```bash
.venv/bin/python scripts/import_evaluation_package.py \
  /secure/t13-baseline/manifest.json \
  --repository-root /secure/t13-baseline
```

## 3. 导入并启动首个 Baseline

确认 API、Worker、Milvus 和三个真实模型均可用后，把短期测试 Access Token 放入当前进程
环境变量。不要把 Token 写进命令参数、清单、Shell 脚本或日志。

```bash
export T13_ACCESS_TOKEN='<short-lived-test-token>'
.venv/bin/python scripts/import_evaluation_package.py \
  /secure/t13-baseline/manifest.json \
  --repository-root /secure/t13-baseline \
  --apply \
  --start-run
unset T13_ACCESS_TOKEN
```

`--apply` 会依次创建受限知识库、上传文档、等待每个真实入库任务成功、创建评测数据集、
批量写入用例。`--start-run` 还会启动并等待首个真实评测运行，成功后输出
`baseline_run_id` 和摘要指标。工具不会输出令牌或模型密钥。

这是一项持久化操作。若中途失败，工具不会自动删除已经写入的数据；应根据输出和审计日志
确认精确目标，删除已上传文档并归档该知识库后再重试，避免误删其他评测记录。

## 4. 冻结基线和比较 Candidate

首个运行成功后，在评测报告中人工复核失败用例、答案和证据。通过验收后记录：

- 评测集 ID、Baseline 运行 ID、知识库 ID和审批编号；
- Retrieval Recall@K、MRR、Rerank Recall；
- Citation Precision/Recall、证据支撑率和关键点覆盖率；
- 拒答准确率、首 Token 延迟和总延迟；
- 失败用例明细及是否接受；
- 运行中冻结的模型、分块、TopK、阈值和提示配置快照；
- 文档上传、重新入库、删除和索引重建的任务与审计记录；
- 首批数据规模和增长预估。

后续在同一评测集创建 Candidate 运行，在控制台选择 Baseline 比较并执行质量门禁。只有两次
运行都成功且属于同一评测集时才能比较。门禁通过返回 HTTP 200，指标回退返回 HTTP 409，
回退报告会列出失败指标。

全量索引重建会影响当前租户的完整索引，不纳入默认自动化测试。它只能在确认没有其他评测或
入库任务运行、明确记录影响范围并获得人工批准后单独验证。

## 5. 当前自动化覆盖

- 评测包 Schema、数量、拒答比例、安全声明、文档引用、路径越界和可选校验和检查；
- 从上传文件名到真实文档 ID 的评测用例转换；
- 显式 `--apply` 才允许写入，令牌只从指定环境变量读取；
- 浏览器真实 OIDC、创建知识库、上传与 Worker 入库、Embedding、Milvus 混合检索、
  Rerank、真实模型流式回答、引用证据、重新入库、异步删除和知识库归档。

T13 只有在真实脱敏业务包完成 Baseline 和 Candidate 运行、质量门禁通过且高影响的全量索引
重建得到人工验证后才能标记完成。

当前已使用公共、非敏感法规包完成链路预验收，v2 的 Baseline/Candidate 默认门禁通过，结果
记录在 `docs/evaluation-baselines/public-compliance-v2-2026-08-04.md`。公共数据例外只验证
工程链路，不能替代本节要求的内部脱敏业务包审批与验收。
