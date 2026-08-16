# 项目授权与第三方许可证策略

## 项目代码授权边界

当前仓库不提供开源 `LICENSE`。在版权所有者正式选择开源许可证前，项目代码按保留全部权利处理：未经书面授权，不得复制、修改或再分发；企业外部使用需由仓库维护者另行书面授权。该状态不影响内部继续开发和测试，也不代表项目已经授予开源使用权。

## 第三方依赖门禁

`.github/license-policy.json` 是自动检查使用的 SPDX 允许清单。`scripts/check_licenses.py` 同时检查当前 Python 环境与 `frontend/package-lock.json`：

- 缺失许可证元数据会阻断检查；
- 新出现且未在允许清单中的许可证会阻断检查；
- LGPL、MPL、CC-BY 和 OFL 依赖会单独列出，交付制品时必须保留相应许可证、版权或署名声明；
- 允许清单变更必须经过人工审查，不能为了让 CI 通过而直接放宽。

执行命令：

```bash
.venv/bin/python scripts/check_licenses.py
```

Windows：

```powershell
.\.venv\Scripts\python.exe scripts\check_licenses.py
```

面向客户分发镜像、安装包或离线制品前，应从最终制品重新生成依赖清单与第三方声明，确认实际包含版本与本检查一致。未来如果版权所有者决定开源，再单独选择并添加项目 `LICENSE`，不得把第三方许可证误当成项目自身许可证。
