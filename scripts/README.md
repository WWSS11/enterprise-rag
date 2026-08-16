# Linux 开发环境脚本使用指南

本项目在 Linux 上统一使用 `scripts/dev.sh` 管理开发环境。脚本负责安装 Arch Linux
依赖、创建 Python 虚拟环境、安装前后端依赖、管理 Docker 中间件，以及启动和停止
API、Celery Worker、可选的 Celery Beat 与 Vite 前端。

以下命令均在项目根目录执行。

## 支持环境

- Arch Linux：缺少依赖时，`bootstrap` 会使用 `pacman` 安装。
- 其他 Linux 发行版：可以运行脚本，但需要先自行安装依赖。
- Python 3.13：优先由 `uv` 安装和管理，不要求系统预装 `python3`。
- Node.js 20 或更高版本。
- Docker Engine 与 Docker Compose v2 插件。
- `npm`、`curl` 和 POSIX `sh`。

Arch Linux 也可以先手动安装基础工具：

```bash
sudo pacman -S --needed docker docker-compose nodejs npm uv curl
sudo systemctl enable --now docker
```

如果当前用户尚无 Docker 权限，可以使用 `sudo usermod -aG docker "$USER"` 加入
`docker` 组，重新登录后生效。

## 快速开始

赋予脚本执行权限并初始化环境：

```bash
chmod +x scripts/dev.sh
./scripts/dev.sh bootstrap
```

启动常用开发服务：

```bash
./scripts/dev.sh start
```

`start` 会启动全部 Docker 中间件、FastAPI、Celery Worker 和 Vite 前端，但不会启动
非必需的 Celery Beat。需要运行周期任务时再单独执行：

```bash
./scripts/dev.sh start-beat
```

服务入口：

| 服务 | 地址 |
| --- | --- |
| 前端 | <http://localhost:3000> |
| API 文档 | <http://127.0.0.1:8000/docs> |
| API 就绪检查 | <http://127.0.0.1:8000/health/ready> |
| Keycloak | <http://127.0.0.1:18080> |
| MinIO API | <http://127.0.0.1:9000> |
| MinIO Console | <http://127.0.0.1:9001> |

## 命令总览

```text
./scripts/dev.sh [命令] [参数]
```

不传命令时进入交互菜单。CLI 支持以下全部命令：

| 命令 | 参数 | 作用 |
| --- | --- | --- |
| `bootstrap` | 无 | 初始化或更新 Linux 开发环境 |
| `start` | 无 | 启动全部 Docker 组件、API、Worker 和前端，不启动 Beat |
| `start-app` | 无 | 只启动 API、Worker 和前端，不启动 Docker 和 Beat |
| `start-beat` | 无 | 单独启动 Celery Beat |
| `infra-up` | `[服务 ...]` | 不传服务时启动全部 Docker 组件；也可启动一个或多个指定组件 |
| `infra-down` | 无 | 停止全部 Docker 组件，保留持久化数据 |
| `stop-app` | 无 | 停止前端、Beat、Worker 和 API，不停止 Docker 组件 |
| `stop` | 无 | 停止全部本地应用进程和 Docker 组件，保留数据 |
| `status` | 无 | 显示应用 PID 状态和 Docker Compose 服务状态 |
| `check` | 无 | 检查 API、Keycloak、Alembic migration head 和 Milvus |
| `logs` | `<名称>` | 持续跟踪指定应用或 Docker 日志 |
| `help`、`-h`、`--help` | 无 | 显示脚本内置帮助 |

### `bootstrap`：初始化或更新环境

```bash
./scripts/dev.sh bootstrap
```

执行内容：

1. 创建 `.runtime` 日志、PID 和备份目录。
2. 从模板创建缺失的 `.env`、`infra/.env` 和 `frontend/.env`，不覆盖已有文件。
3. 在 Arch Linux 上安装缺少的 Docker、Compose、Node.js、npm、uv 和 curl。
4. 通过 uv 安装 Python 3.13，并创建项目 `.venv`。
5. 根据 `infra/.env` 将本地中间件连接串同步到后端 `.env`。
6. 安装 Python 开发依赖和前端锁定依赖。

依赖或配置模板更新后可以重复执行。被替换的环境文件或不兼容虚拟环境会备份到
`.runtime/backups/`。

### `start`：一键启动开发环境

```bash
./scripts/dev.sh start
```

如果尚未初始化，脚本会先自动执行 `bootstrap`。随后启动以下组件：

- Docker：PostgreSQL、Redis、etcd、MinIO、Milvus、Keycloak。
- 本地进程：FastAPI、Celery Worker、Vite。

脚本会执行 `alembic upgrade head`，等待 API、Worker 和前端真正就绪。任一新进程启动
失败时，只回滚本次新启动的应用进程，不会停止调用脚本前已经运行的进程。

Celery Beat 不属于默认开发环境，使用 `start-beat` 按需启动。

### `start-app`：只启动前后端

```bash
./scripts/dev.sh start-app
```

适合 Docker 中间件已经运行的场景。该命令会同步本地连接配置、执行数据库迁移，并依次
启动 API、Worker 和前端。它不会启动 Docker 组件，也不会启动 Beat。

### `start-beat`：启动周期任务调度器

```bash
./scripts/dev.sh start-beat
```

Beat 只负责发布定时任务，实际任务仍由 Worker 执行。因此运行周期任务前应确保 Redis 和
Worker 已启动。普通 API、检索、上传和前端开发不依赖 Beat。

### `infra-up`：启动 Docker 组件

启动全部组件：

```bash
./scripts/dev.sh infra-up
```

启动一个或多个指定组件：

```bash
./scripts/dev.sh infra-up postgres redis
./scripts/dev.sh infra-up etcd minio milvus
./scripts/dev.sh infra-up keycloak
```

支持的服务参数：

| 参数 | 组件 | 说明 |
| --- | --- | --- |
| `postgres` | PostgreSQL | 应用数据库，宿主机端口 `5432` |
| `redis` | Redis | 缓存和 Celery broker/backend，宿主机端口 `16379` |
| `etcd` | etcd | Milvus 元数据依赖 |
| `minio` | MinIO | Milvus 对象存储依赖，端口 `9000`、`9001` |
| `milvus` | Milvus | 向量数据库，端口 `19530`、`9091`；Compose 会自动拉起 etcd 和 MinIO |
| `keycloak` | Keycloak | 本地 OIDC 身份服务，端口 `18080` |

参数可以按空格组合。未知服务名会直接报错，不支持逗号分隔。

### 停止命令

仅停止应用进程，保留 Docker 中间件：

```bash
./scripts/dev.sh stop-app
```

仅停止 Docker 中间件，保留持久化数据：

```bash
./scripts/dev.sh infra-down
```

停止应用和 Docker 中间件：

```bash
./scripts/dev.sh stop
```

这些命令不会删除 `infra/volumes/` 中的数据。

### `status`：查看状态

```bash
./scripts/dev.sh status
```

输出 API、Worker、Beat、Frontend 的运行状态和 PID，并显示 Docker Compose 组件状态。
Docker CLI、Compose v2 插件或 Docker daemon 不可用时会显示对应提示。

### `check`：检查开发环境

```bash
./scripts/dev.sh check
```

检查项目包括：

- API `/health/ready` 是否可访问；
- Keycloak OIDC discovery 是否可访问；
- 数据库是否已经应用全部 Alembic heads；
- Milvus 是否可以连接。

任一检查失败时命令返回非零退出码。

### `logs`：跟踪日志

```bash
./scripts/dev.sh logs <名称>
```

支持的名称参数：

| 参数 | 日志来源 |
| --- | --- |
| `api` | FastAPI 标准输出和错误日志 |
| `worker` | Celery Worker 标准输出和错误日志 |
| `beat` | Celery Beat 标准输出和错误日志 |
| `frontend` | Vite 标准输出和错误日志 |
| `infra` | 全部 Docker Compose 服务日志 |

示例：

```bash
./scripts/dev.sh logs api
./scripts/dev.sh logs worker
./scripts/dev.sh logs infra
```

应用日志保存在 `.runtime/logs/`。日志命令会持续跟踪输出，按 `Ctrl+C` 退出。

## 交互菜单全部选项

直接运行脚本会进入菜单：

```bash
./scripts/dev.sh
```

| 选项 | 操作 | 对应 CLI 命令 |
| --- | --- | --- |
| `1` | 初始化/更新开发环境 | `bootstrap` |
| `2` | 启动 Docker、API、Worker 和前端，不含 Beat | `start` |
| `3` | 启动 API、Worker 和前端，不启动 Docker | `start-app` |
| `4` | 启动全部 Docker 组件 | `infra-up` |
| `5` | 交互选择一个 Docker 组件或全部组件 | `infra-up [服务 ...]` |
| `6` | 启动 Celery Beat | `start-beat` |
| `7` | 查看状态 | `status` |
| `8` | 运行开发环境检查 | `check` |
| `9` | 交互选择并跟踪日志 | `logs <名称>` |
| `10` | 停止前后端和 Beat | `stop-app` |
| `11` | 停止应用与全部 Docker 组件 | `stop` |
| `0` | 退出菜单 | 无 |

菜单选项 5 提供 PostgreSQL、Redis、Milvus、MinIO、Keycloak 和全部组件。选择 Milvus
时，Docker Compose 会自动启动它依赖的 etcd 与 MinIO。

## 配置与运行文件

| 路径 | 用途 |
| --- | --- |
| `config/rag.yaml` | 版本化的模型、分块、检索、rerank 和上下文默认值 |
| `.env` | 后端应用环境变量；由 `.env.example` 创建且不提交 Git |
| `infra/.env` | Docker 中间件账号、密码和镜像编排配置 |
| `frontend/public/config.json` | 浏览器启动时加载的公开运行配置 |
| `frontend/.env` | Vite 本地兼容回退配置 |
| `.venv/` | Linux Python 3.13 虚拟环境 |
| `.runtime/pids/` | 由脚本管理的应用 PID 文件 |
| `.runtime/logs/` | API、Worker、Beat、Frontend 日志 |
| `.runtime/backups/` | 自动生成的配置、缓存或旧虚拟环境备份 |
| `infra/volumes/` | Docker 中间件持久化数据 |

开发环境的 PostgreSQL 和 Redis 密码以 `infra/.env` 为准。`bootstrap` 与 `start-app`
会据此生成连接串并同步到后端 `.env`，修改前的文件保存在 `.runtime/backups/`。

后端配置优先级从高到低为：显式初始化值、进程环境变量、`.env`、
`config/rag.yaml`、代码默认值。所有环境文件和环境备份都会被脚本设置为仅当前用户可读写。

## T13 真实业务评测包

`validate_evaluation_package.py` 只校验评测清单和本地文档，不调用 API。传入
`--require-t13` 时，还会强制检查真实业务基线所需的文档数、用例数、拒答题和安全声明。

`import_evaluation_package.py` 默认同样只校验；只有显式传入 `--apply` 才会创建知识库、上传
文档和创建评测集，追加 `--start-run` 可以启动首个 Baseline。访问令牌只从
`T13_ACCESS_TOKEN` 或 `--token-env` 指定的环境变量读取。

完整清单格式、安全约束和命令见 [T13 真实业务评测包与基线操作](../docs/t13-business-baseline.md)。

## 常见问题

- Docker 未运行：执行 `sudo systemctl enable --now docker`。
- 当前用户无 Docker 权限：将用户加入 `docker` 组并重新登录，或按本机安全策略配置权限。
- Node.js 版本过低：升级到 Node.js 20 或更高版本，再执行 `bootstrap`。
- API 启动失败：查看 `.runtime/logs/api.err.log`。
- Worker 或 Beat 异常：分别查看 `.runtime/logs/worker.err.log`、`.runtime/logs/beat.err.log`。
- 前端启动失败：查看 `.runtime/logs/frontend.err.log`，并确认端口 `3000` 未被占用。
- OIDC Token 时间错误：检查 Linux 宿主机与 Docker 容器时间，确保时间偏差不超过 60 秒。
- 中间件异常：运行 `./scripts/dev.sh logs infra` 查看 Compose 日志。
- 数据库迁移未到 head：确认 PostgreSQL 正常后执行 `./scripts/dev.sh start-app`。
## T14/T15 安全与容量探针

以下命令只执行非破坏性 HTTP 请求，不修改部署配置：

```bash
.venv/bin/python scripts/security_dast.py --base-url http://127.0.0.1:8000
.venv/bin/python scripts/t15_load_probe.py \
  --base-url http://127.0.0.1:8000 \
  --path /health/live \
  --path /health/ready \
  --requests 500 \
  --concurrency 50
```

访问受保护端点时，只能通过 `--token-env` 指定的环境变量提供短期 Access Token；Token 不得
写入命令参数或输出。真实 OIDC 和并发 Chat 使用显式 `E2E_T15_LOAD=1` 的 Playwright 用例，
默认测试不会产生模型调用。
