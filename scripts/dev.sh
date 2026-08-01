#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$PROJECT_ROOT/infra/compose.yml"
INFRA_ENV="$PROJECT_ROOT/infra/.env"
ROOT_ENV="$PROJECT_ROOT/.env"
FRONTEND_ENV="$PROJECT_ROOT/frontend/.env"
VENV_DIR="$PROJECT_ROOT/.venv"
VENV_PYTHON="$VENV_DIR/bin/python"
RUNTIME_DIR="$PROJECT_ROOT/.runtime"
PID_DIR="$RUNTIME_DIR/pids"
LOG_DIR="$RUNTIME_DIR/logs"
BACKUP_DIR="$RUNTIME_DIR/backups"
INFRA_SERVICES="postgres redis etcd minio milvus keycloak"

if [ -t 1 ]; then
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    RED='\033[0;31m'
    RESET='\033[0m'
else
    GREEN=''
    YELLOW=''
    RED=''
    RESET=''
fi

info() {
    printf "%b[INFO]%b %s\n" "$GREEN" "$RESET" "$*"
}

warn() {
    printf "%b[WARN]%b %s\n" "$YELLOW" "$RESET" "$*" >&2
}

die() {
    printf "%b[ERROR]%b %s\n" "$RED" "$RESET" "$*" >&2
    exit 1
}

ensure_runtime_dirs() {
    mkdir -p "$PID_DIR" "$LOG_DIR" "$BACKUP_DIR"
}

prepare_writable_cache() {
    cache_name=$1
    cache_dir="$PROJECT_ROOT/$cache_name"
    [ -d "$cache_dir" ] || return 0
    if find "$cache_dir" ! -writable -print -quit | grep -q .; then
        stamp=$(date '+%Y%m%d-%H%M%S')
        backup="$PROJECT_ROOT/.root-owned-backup-$stamp-$$${cache_name}"
        mv "$cache_dir" "$backup"
        mkdir -p "$cache_dir"
        warn "$cache_name 包含不可写文件，已保留到 $backup"
    fi
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"
}

copy_env_if_missing() {
    target=$1
    example=$2
    if [ ! -f "$target" ]; then
        [ -f "$example" ] || die "配置模板不存在：$example"
        cp "$example" "$target"
        info "已创建 ${target#"$PROJECT_ROOT/"}"
    fi
}

ensure_env_files() {
    copy_env_if_missing "$ROOT_ENV" "$PROJECT_ROOT/.env.example"
    copy_env_if_missing "$INFRA_ENV" "$PROJECT_ROOT/infra/.env.example"
    copy_env_if_missing "$FRONTEND_ENV" "$PROJECT_ROOT/frontend/.env.example"
}

sync_local_env() {
    require_command python3
    ensure_runtime_dirs
    ensure_env_files

    python3 - "$ROOT_ENV" "$INFRA_ENV" "$BACKUP_DIR" <<'PY'
from __future__ import annotations

import shutil
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

root_path, infra_path, backup_dir = map(Path, sys.argv[1:])


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


infra = read_env(infra_path)
required = ("POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD", "REDIS_PASSWORD")
missing = [key for key in required if not infra.get(key)]
if missing:
    raise SystemExit(f"infra/.env 缺少配置：{', '.join(missing)}")

pg_user = quote(infra["POSTGRES_USER"], safe="")
pg_password = quote(infra["POSTGRES_PASSWORD"], safe="")
pg_database = quote(infra["POSTGRES_DB"], safe="")
redis_password = quote(infra["REDIS_PASSWORD"], safe="")

updates = {
    "APP_POSTGRES_DSN": (
        f"postgresql+asyncpg://{pg_user}:{pg_password}@127.0.0.1:5432/{pg_database}"
    ),
    "APP_POSTGRES_SYNC_DSN": (
        f"postgresql+psycopg://{pg_user}:{pg_password}@127.0.0.1:5432/{pg_database}"
    ),
    "APP_REDIS_URL": f"redis://:{redis_password}@127.0.0.1:16379/0",
    "APP_CELERY_BROKER_URL": f"redis://:{redis_password}@127.0.0.1:16379/1",
    "APP_CELERY_RESULT_BACKEND": f"redis://:{redis_password}@127.0.0.1:16379/2",
    "APP_MILVUS_URI": "http://127.0.0.1:19530",
}

lines = root_path.read_text(encoding="utf-8").splitlines()
seen: set[str] = set()
changed = False
for index, raw in enumerate(lines):
    if "=" not in raw or raw.lstrip().startswith("#"):
        continue
    key = raw.split("=", 1)[0].strip()
    if key not in updates:
        continue
    seen.add(key)
    replacement = f"{key}={updates[key]}"
    if raw != replacement:
        lines[index] = replacement
        changed = True

for key, value in updates.items():
    if key not in seen:
        lines.append(f"{key}={value}")
        changed = True

if changed:
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    backup = backup_dir / f"env-{stamp}.bak"
    shutil.copy2(root_path, backup)
    root_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"已同步本地中间件连接配置；原配置备份到 {backup}")
else:
    print("本地中间件连接配置已一致")
PY
}

install_arch_prerequisites() {
    missing=""
    command -v docker >/dev/null 2>&1 || missing="$missing docker"
    docker compose version >/dev/null 2>&1 || missing="$missing docker-compose"
    command -v node >/dev/null 2>&1 || missing="$missing nodejs"
    command -v npm >/dev/null 2>&1 || missing="$missing npm"
    command -v uv >/dev/null 2>&1 || missing="$missing uv"

    [ -z "$missing" ] && return 0
    command -v pacman >/dev/null 2>&1 || {
        die "缺少依赖：$missing。请先安装后重新运行。"
    }
    require_command sudo
    info "将通过 pacman 安装：$missing"
    sudo pacman -S --needed $missing
}

check_node_version() {
    require_command node
    major=$(node -p 'Number(process.versions.node.split(".")[0])')
    [ "$major" -ge 20 ] || die "Vite 需要 Node.js 20+；当前版本：$(node --version)"
}

valid_venv_python() {
    [ -x "$VENV_PYTHON" ] && "$VENV_PYTHON" -c \
        'import sys; raise SystemExit(sys.version_info[:2] != (3, 13))' >/dev/null 2>&1
}

backup_incompatible_venv() {
    [ ! -e "$VENV_DIR" ] && return 0
    ensure_runtime_dirs
    stamp=$(date '+%Y%m%d-%H%M%S')
    backup="$BACKUP_DIR/venv-incompatible-$stamp-$$"
    mv "$VENV_DIR" "$backup"
    warn "现有 .venv 不是 Linux Python 3.13 环境，已保留到 $backup"
}

create_venv() {
    if valid_venv_python; then
        if ! "$VENV_PYTHON" -m pip --version >/dev/null 2>&1; then
            command -v uv >/dev/null 2>&1 || die "虚拟环境缺少 pip，且找不到 uv"
            uv pip install --python "$VENV_PYTHON" pip
        fi
        return 0
    fi
    backup_incompatible_venv

    if command -v uv >/dev/null 2>&1; then
        info "安装/确认 Python 3.13 运行时"
        if [ -n "${UV_PYTHON_MIRROR:-}" ]; then
            uv python install 3.13 --mirror "$UV_PYTHON_MIRROR"
        else
            uv python install 3.13
        fi
        uv venv --seed --python 3.13 "$VENV_DIR"
    elif command -v python3.13 >/dev/null 2>&1; then
        python3.13 -m venv "$VENV_DIR"
    else
        die "找不到 Python 3.13。Arch Linux 推荐先安装 uv：sudo pacman -S uv"
    fi

    valid_venv_python || die "Python 3.13 虚拟环境创建失败"
}

install_backend() {
    egg_info="$PROJECT_ROOT/rag_study_helper_enterprise.egg-info"
    if [ -d "$egg_info" ] && [ ! -w "$egg_info" ]; then
        stamp=$(date '+%Y%m%d-%H%M%S')
        # A root-owned directory cannot be moved across parent directories
        # without write permission on the directory itself. Renaming it in
        # place is safe and keeps it covered by the *.egg-info ignore rule.
        backup="$PROJECT_ROOT/.root-owned-backup-$stamp-$$.egg-info"
        mv "$egg_info" "$backup"
        warn "现有 egg-info 不可写，已保留到 $backup"
    fi
    info "安装后端开发依赖"
    if command -v uv >/dev/null 2>&1; then
        uv pip install --python "$VENV_PYTHON" -e "${PROJECT_ROOT}[dev]"
    else
        "$VENV_PYTHON" -m pip install --upgrade pip
        "$VENV_PYTHON" -m pip install -e "${PROJECT_ROOT}[dev]"
    fi
}

install_frontend() {
    check_node_version
    require_command npm
    info "安装前端锁定依赖"
    (cd "$PROJECT_ROOT/frontend" && npm ci)
}

bootstrap() {
    ensure_runtime_dirs
    prepare_writable_cache ".ruff_cache"
    prepare_writable_cache ".mypy_cache"
    prepare_writable_cache ".pytest_cache"
    ensure_env_files
    install_arch_prerequisites
    sync_local_env
    create_venv
    install_backend
    install_frontend
    info "开发环境初始化完成（Python：$($VENV_PYTHON --version 2>&1)，Node：$(node --version)）"
}

compose() {
    ensure_env_files
    docker compose --env-file "$INFRA_ENV" -f "$COMPOSE_FILE" "$@"
}

ensure_docker() {
    require_command docker
    docker compose version >/dev/null 2>&1 || die "Docker Compose 插件不可用"
    if ! docker info >/dev/null 2>&1; then
        if command -v systemctl >/dev/null 2>&1; then
            die "Docker daemon 未运行。请执行：sudo systemctl enable --now docker"
        fi
        die "Docker daemon 未运行"
    fi
}

assert_service_name() {
    case " $INFRA_SERVICES " in
        *" $1 "*) ;;
        *) die "未知 Docker 组件：$1（可选：$INFRA_SERVICES）" ;;
    esac
}

check_docker_clock() {
    container=$(compose ps -q keycloak 2>/dev/null || true)
    [ -n "$container" ] || return 0
    host_epoch=$(date -u +%s)
    container_epoch=$(docker exec "$container" date +%s 2>/dev/null || true)
    case "$container_epoch" in
        ''|*[!0-9]*) die "无法读取 Keycloak 容器时钟" ;;
    esac
    drift=$((container_epoch - host_epoch))
    [ "$drift" -lt 0 ] && drift=$((-drift))
    [ "$drift" -le 60 ] || die "容器与宿主机时钟相差 ${drift}s，OIDC token 将失效"
    info "Docker 时钟正常（偏差 ${drift}s）"
}

prepare_keycloak_volume() {
    info "确认 Keycloak 数据目录权限"
    compose --progress quiet run --rm --no-deps --user 0 --entrypoint /bin/sh keycloak \
        -c 'find /opt/keycloak/data -path /opt/keycloak/data/import -prune -o -exec chown 1000:0 {} +'
}

infra_up() {
    ensure_docker
    sync_local_env
    prepare_keycloak=0
    if [ "$#" -eq 0 ]; then
        set -- $INFRA_SERVICES
    else
        for service in "$@"; do
            assert_service_name "$service"
        done
    fi
    for service in "$@"; do
        [ "$service" = "keycloak" ] && prepare_keycloak=1
    done
    [ "$prepare_keycloak" -eq 0 ] || prepare_keycloak_volume
    info "启动 Docker 组件：$*"
    compose --progress quiet up --detach --wait --wait-timeout 300 "$@"
    check_docker_clock
    info "Docker 组件已就绪"
}

infra_down() {
    ensure_docker
    compose down
    info "Docker 组件已停止；数据卷目录未删除"
}

process_matches() {
    name=$1
    pid=$2
    [ -r "/proc/$pid/cmdline" ] || return 1
    command_line=$(tr '\000' ' ' <"/proc/$pid/cmdline")
    case "$name" in
        api) pattern="uvicorn app.main:app" ;;
        worker) pattern="celery -A app.workers.celery_app:celery_app worker" ;;
        beat) pattern="celery -A app.workers.celery_app:celery_app beat" ;;
        frontend) pattern="npm run dev" ;;
        *) return 1 ;;
    esac
    case "$command_line" in
        *"$pattern"*) return 0 ;;
        *) return 1 ;;
    esac
}

running_pid() {
    name=$1
    pid_file="$PID_DIR/$name.pid"
    [ -f "$pid_file" ] || return 1
    pid=$(sed -n '1p' "$pid_file")
    case "$pid" in
        ''|*[!0-9]*) return 1 ;;
    esac
    kill -0 "$pid" 2>/dev/null && process_matches "$name" "$pid"
}

start_process() {
    name=$1
    workdir=$2
    shift 2
    ensure_runtime_dirs

    if running_pid "$name"; then
        pid=$(sed -n '1p' "$PID_DIR/$name.pid")
        info "$name 已在运行（PID $pid）"
        return 0
    fi
    rm -f "$PID_DIR/$name.pid"

    (
        cd "$workdir"
        nohup setsid "$@" >>"$LOG_DIR/$name.out.log" 2>>"$LOG_DIR/$name.err.log" &
        echo "$!" >"$PID_DIR/$name.pid"
    )
    sleep 2
    if ! running_pid "$name"; then
        warn "$name 启动失败，最近错误日志："
        tail -n 30 "$LOG_DIR/$name.err.log" >&2 || true
        return 1
    fi
    pid=$(sed -n '1p' "$PID_DIR/$name.pid")
    info "$name 已启动（PID $pid）"
}

stop_process() {
    name=$1
    pid_file="$PID_DIR/$name.pid"
    if ! running_pid "$name"; then
        rm -f "$pid_file"
        info "$name 未运行"
        return 0
    fi

    pid=$(sed -n '1p' "$pid_file")
    /bin/kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    count=0
    while kill -0 "$pid" 2>/dev/null && [ "$count" -lt 20 ]; do
        sleep 1
        count=$((count + 1))
    done
    if kill -0 "$pid" 2>/dev/null; then
        warn "$name 未在 20 秒内退出，发送 KILL"
        /bin/kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
    info "$name 已停止"
}

require_initialized() {
    valid_venv_python || die "Linux Python 3.13 虚拟环境未初始化，请先选择“初始化开发环境”"
    [ -d "$PROJECT_ROOT/frontend/node_modules" ] || {
        die "前端依赖未初始化，请先选择“初始化开发环境”"
    }
    ensure_env_files
}

run_migrations() {
    info "执行 Alembic 数据库迁移"
    (cd "$PROJECT_ROOT" && "$VENV_PYTHON" -m alembic upgrade head)
}

start_app() {
    require_initialized
    sync_local_env
    run_migrations
    start_process api "$PROJECT_ROOT" \
        "$VENV_PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
    start_process worker "$PROJECT_ROOT" \
        "$VENV_PYTHON" -m celery -A app.workers.celery_app:celery_app worker \
        --loglevel=INFO --pool=prefork --concurrency=2
    start_process frontend "$PROJECT_ROOT/frontend" npm run dev
    info "前后端已启动：Web http://localhost:3000 ｜ API http://127.0.0.1:8000/docs"
}

start_all() {
    if ! valid_venv_python || [ ! -d "$PROJECT_ROOT/frontend/node_modules" ]; then
        warn "检测到环境尚未初始化，将先执行初始化"
        bootstrap
    fi
    infra_up
    start_app
}

start_beat() {
    require_initialized
    start_process beat "$PROJECT_ROOT" \
        "$VENV_PYTHON" -m celery -A app.workers.celery_app:celery_app beat --loglevel=INFO
}

stop_app() {
    ensure_runtime_dirs
    stop_process frontend
    stop_process beat
    stop_process worker
    stop_process api
}

stop_all() {
    stop_app
    infra_down
}

app_status_line() {
    name=$1
    if running_pid "$name"; then
        pid=$(sed -n '1p' "$PID_DIR/$name.pid")
        printf '  %-10s running (PID %s)\n' "$name" "$pid"
    else
        printf '  %-10s stopped\n' "$name"
    fi
}

status_all() {
    ensure_runtime_dirs
    printf '应用进程：\n'
    app_status_line api
    app_status_line worker
    app_status_line beat
    app_status_line frontend
    printf '\nDocker 组件：\n'
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        compose ps
    else
        printf '  Docker daemon 未运行\n'
    fi
}

check_url() {
    label=$1
    url=$2
    if curl --fail --silent --show-error --max-time 10 "$url" >/dev/null; then
        info "$label 正常：$url"
    else
        warn "$label 不可用：$url"
        return 1
    fi
}

dev_check() {
    require_initialized
    require_command curl
    failed=0
    check_url "API 存活检查" "http://127.0.0.1:8000/health/live" || failed=1
    check_url "Keycloak OIDC" \
        "http://127.0.0.1:18080/realms/enterprise-rag/.well-known/openid-configuration" \
        || failed=1
    (cd "$PROJECT_ROOT" && "$VENV_PYTHON" -m alembic current) || failed=1
    (cd "$PROJECT_ROOT" && "$VENV_PYTHON" -c \
        "import asyncio; from app.services.milvus_service import milvus_service; print('milvus:', asyncio.run(milvus_service.ping()))") \
        || failed=1
    [ "$failed" -eq 0 ] || die "开发环境检查未全部通过"
    info "开发环境检查通过"
}

show_logs() {
    name=${1:-}
    case "$name" in
        api|worker|beat|frontend)
            ensure_runtime_dirs
            touch "$LOG_DIR/$name.out.log" "$LOG_DIR/$name.err.log"
            tail -n 100 -F "$LOG_DIR/$name.out.log" "$LOG_DIR/$name.err.log"
            ;;
        infra)
            ensure_docker
            compose logs --tail=100 --follow
            ;;
        '') die "请指定日志名称：api、worker、beat、frontend 或 infra" ;;
        *) die "未知日志名称：$name" ;;
    esac
}

choose_infra() {
    printf '\n选择 Docker 组件：\n'
    printf '  1) PostgreSQL\n'
    printf '  2) Redis\n'
    printf '  3) Milvus（自动包含 etcd、MinIO）\n'
    printf '  4) MinIO\n'
    printf '  5) Keycloak\n'
    printf '  6) 全部组件\n'
    printf '  0) 返回\n'
    printf '请选择：'
    read -r choice
    case "$choice" in
        1) infra_up postgres ;;
        2) infra_up redis ;;
        3) infra_up milvus ;;
        4) infra_up minio ;;
        5) infra_up keycloak ;;
        6) infra_up ;;
        0) return 0 ;;
        *) warn "无效选项：$choice" ;;
    esac
}

choose_logs() {
    printf '\n选择日志：1) API  2) Worker  3) Beat  4) 前端  5) Docker\n'
    printf '请选择（Ctrl+C 退出日志）：'
    read -r choice
    case "$choice" in
        1) show_logs api ;;
        2) show_logs worker ;;
        3) show_logs beat ;;
        4) show_logs frontend ;;
        5) show_logs infra ;;
        *) warn "无效选项：$choice" ;;
    esac
}

menu() {
    while :; do
        printf '\nEnterprise RAG · Arch Linux 开发环境\n'
        printf '  1) 初始化/更新开发环境\n'
        printf '  2) 一键启动完整开发环境\n'
        printf '  3) 一键启动前后端（不启动 Docker）\n'
        printf '  4) 启动全部 Docker 组件\n'
        printf '  5) 选择 Docker 组件启动\n'
        printf '  6) 启动 Celery Beat\n'
        printf '  7) 查看状态\n'
        printf '  8) 运行开发环境检查\n'
        printf '  9) 查看日志\n'
        printf ' 10) 停止前后端\n'
        printf ' 11) 停止全部服务\n'
        printf '  0) 退出\n'
        printf '请选择：'
        read -r choice || return 0
        case "$choice" in
            1) bootstrap ;;
            2) start_all ;;
            3) start_app ;;
            4) infra_up ;;
            5) choose_infra ;;
            6) start_beat ;;
            7) status_all ;;
            8) dev_check ;;
            9) choose_logs ;;
            10) stop_app ;;
            11) stop_all ;;
            0) return 0 ;;
            *) warn "无效选项：$choice" ;;
        esac
    done
}

usage() {
    cat <<'EOF'
用法：scripts/dev.sh [命令] [参数]

不带参数时打开交互菜单。可用命令：
  bootstrap                 初始化/更新开发环境
  start                     启动全部 Docker 组件和前后端
  start-app                 启动 API、Worker 和前端
  start-beat                启动 Celery Beat
  infra-up [服务...]        启动全部或指定 Docker 组件
  infra-down                停止 Docker 组件（保留数据）
  stop-app                  停止本地应用进程
  stop                      停止本地应用和 Docker 组件
  status                    查看状态
  check                     检查 API、Keycloak、数据库和 Milvus
  logs <名称>               跟踪 api/worker/beat/frontend/infra 日志
  help                      显示帮助
EOF
}

cd "$PROJECT_ROOT"

case "${1:-menu}" in
    menu) menu ;;
    bootstrap) bootstrap ;;
    start) start_all ;;
    start-app) start_app ;;
    start-beat) start_beat ;;
    infra-up) shift; infra_up "$@" ;;
    infra-down) infra_down ;;
    stop-app) stop_app ;;
    stop) stop_all ;;
    status) status_all ;;
    check) dev_check ;;
    logs) shift; show_logs "${1:-}" ;;
    help|-h|--help) usage ;;
    *) usage >&2; exit 2 ;;
esac
