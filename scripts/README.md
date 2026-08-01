# 项目脚本使用教程

本目录提供项目唯一推荐的启动、关闭和数据库迁移入口。所有命令都应在项目根目录执行。

## 脚本一览

| 脚本 | 用途 | 何时执行 |
| --- | --- | --- |
| `dev-setup.ps1` | 创建 `.venv`、安装 Python 与前端依赖、生成本地配置 | 首次开发或依赖更新后 |
| `dev-up.ps1` | 启动中间件、迁移数据库，并启动 API、Worker、Beat、Vite | 日常开发启动 |
| `dev-down.ps1` | 关闭开发进程和中间件，不删除持久化数据 | 日常开发结束 |
| `prod-up.ps1` | 校验生产配置、拉取/构建镜像、迁移并启动全部容器 | 完整容器部署 |
| `prod-down.ps1` | 关闭完整容器部署，默认保留数据 | 部署关闭或维护 |
| `db-migrate.ps1` | 将空库或已有数据库升级到最新 Alembic head | 新环境、版本发布、维护窗口 |
| `_common.ps1` | 上述脚本共用的内部函数 | 不要手动执行 |

## 配置文件模板

| 环境 | 应用配置 | 基础设施配置 | 前端本地配置 |
| --- | --- | --- | --- |
| 开发 | `.env.example` → `.env` | `infra/.env.example` → `infra/.env` | `frontend/.env.example` → `frontend/.env` |
| 生产 | `.env.production.example` → `.env.production` | `infra/.env.production.example` → `infra/.env.production` | 使用根生产配置中的 `VITE_*` 构建参数 |

开发配置中的 PostgreSQL、Redis 密码必须与 `infra/.env` 保持一致。完整容器部署会以 `infra/.env.production` 的中间件密码覆盖容器内部连接串。

## 本地开发

### 1. 首次初始化

需要 Python 3.13、当前 Node.js LTS、Docker Desktop 和 PowerShell。

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-setup.ps1
```

脚本只在配置缺失时复制开发模板，不会覆盖已有 `.env`。依赖发生变化时可以重新执行。

### 2. 启动

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-up.ps1
```

启动顺序为：

1. 等待 PostgreSQL、Redis、etcd、MinIO、Milvus、Keycloak 健康。
2. 检查 Windows 与 Docker 时间，避免 OIDC Token 因时间漂移失效。
3. 执行 `alembic upgrade head` 并验证数据库版本。
4. 后台启动 FastAPI、Celery Worker、Celery Beat 和 Vite。
5. 等待 API `/health/ready` 与前端首页返回成功。

常用选项：

```powershell
# 不启动飞书定时调度
.\scripts\dev-up.ps1 -SkipBeat

# 只开发后端
.\scripts\dev-up.ps1 -SkipFrontend
```

运行日志位于 `.runtime/logs/`，PID 状态位于 `.runtime/dev-processes.json`。

### 3. 关闭

```powershell
# 关闭应用和中间件，保留数据
.\scripts\dev-down.ps1

# 只关闭 API/Worker/Beat/前端，保留中间件运行
.\scripts\dev-down.ps1 -KeepInfrastructure
```

脚本只结束由 `dev-up.ps1` 记录的进程，不会按进程名称误杀其他项目。

## 完整容器部署

### 1. 生成生产配置

```powershell
Copy-Item .\.env.production.example .\.env.production
Copy-Item .\infra\.env.production.example .\infra\.env.production
```

至少完成以下配置后才能启动：

- `APP_ENV=production`、`APP_DEBUG=false`；
- `APP_CORS_ORIGINS` 设置为真实前端域名；
- `APP_OIDC_ISSUER`、`VITE_APP_ORIGIN`、`VITE_API_BASE_URL`、`VITE_OIDC_AUTHORITY` 使用真实 HTTPS 地址；
- 修改所有 `CHANGE_ME` 密码；
- 填写聊天、Embedding、Rerank 所需 API Key；
- 生产发布建议设置不可变的 `APP_IMAGE_TAG`，例如 Git commit SHA。

### 2. 启动全部容器

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\prod-up.ps1
```

该脚本执行生产安全检查、拉取基础镜像、构建后端和前端、运行迁移，再使用 Compose 健康检查等待整个服务栈就绪。

可选参数：

```powershell
.\scripts\prod-up.ps1 -SkipPull       # 离线或镜像已准备好
.\scripts\prod-up.ps1 -SkipBuild      # 使用已经构建的应用镜像
.\scripts\prod-up.ps1 -WaitTimeoutSeconds 600
```

`-AllowInsecureConfiguration` 只用于本机完整容器冒烟测试，不得用于真实生产。

### 3. 关闭

```powershell
.\scripts\prod-down.ps1
```

默认保留数据库和其他持久化数据。`-RemoveVolumes` 会删除 Compose 命名卷，但不会删除 `infra/volumes` 下的绑定目录；执行任何数据清理前都应先备份。

仓库自带 Keycloak 使用 `start-dev`，只用于自包含验证。公网环境应接入企业 IdP，或部署带外部数据库、HTTPS、反向代理和备份的独立生产级 Keycloak。

## 数据库迁移

### 容器部署或新环境

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\db-migrate.ps1
```

默认读取 `.env.production` 和 `infra/.env.production`，启动并等待 PostgreSQL，构建迁移镜像，执行 `alembic upgrade head`，最后使用 `alembic current --check-heads` 校验。

### 本地开发

```powershell
.\scripts\db-migrate.ps1 -Runtime Local
```

迁移脚本是幂等入口：空数据库会从首个版本创建，已有数据库只执行尚未应用的升级。不要把 `alembic stamp` 当成正常初始化方式，也不要在没有备份和回滚方案时执行 downgrade。

## 常见问题

- 提示缺少 `.env.production`：先从生产模板复制，并填写必填值。
- 提示 `Unsafe production configuration`：根据错误逐项修复，不能通过修改脚本绕过。
- API 未就绪：查看 `.runtime/logs/api.err.log` 或 `docker compose logs api`。
- Worker/Beat 异常：查看对应开发日志，或执行 `docker compose logs worker beat`。
- OIDC Token 时间错误：重启 Docker Desktop/WSL 并同步 Windows 时间，不要扩大 JWT clock skew 掩盖问题。
- 端口被占用：检查 `3000`、`8000`、`5432`、`6379`、`18080`、`19530`、`9000`、`9001`。
