#!/bin/bash
# nexus-run-claude.sh — 以指定配置 profile 启动 claude，HOME 隔离到项目目录
# 用法: nexus-run-claude.sh <profile_id> <project_absolute_path>
#
# 每次 claude 退出：提示用户确认后自动以 -c（续接上次会话）重启
# Ctrl+C 退出循环

set -e

PROFILE="$1"
PROJECT="$2"

if [ -z "$PROFILE" ] || [ -z "$PROJECT" ]; then
    echo "[Nexus] Usage: nexus-run-claude.sh <profile> <project_path>"
    exit 1
fi

CONFIG_FILE="/app/data/configs/${PROFILE}.json"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "[Nexus] Config profile '${PROFILE}' not found at ${CONFIG_FILE}"
    exit 1
fi

# 用 python3 读取 JSON 配置（python3 已在 cc:nexus 中安装）
cfg() {
    python3 -c "import json; d=json.load(open('${CONFIG_FILE}')); print(d.get('$1',''))"
}

BASE_URL=$(cfg BASE_URL)
AUTH_TOKEN=$(cfg AUTH_TOKEN)
API_KEY=$(cfg API_KEY)
DEFAULT_MODEL=$(cfg DEFAULT_MODEL)
THINK_MODEL=$(cfg THINK_MODEL)
LONG_CONTEXT_MODEL=$(cfg LONG_CONTEXT_MODEL)
DEFAULT_HAIKU_MODEL=$(cfg DEFAULT_HAIKU_MODEL)
API_TIMEOUT_MS=$(cfg API_TIMEOUT_MS)
LABEL=$(cfg label)

# ── 每个项目独立的 claude home（存 API config、会话历史、memory） ──
DATA_DIR="${PROJECT}/.claude-data"
mkdir -p "$DATA_DIR"

# 自动把 .claude-data 加入 .gitignore
GITIGNORE="${PROJECT}/.gitignore"
if [ -d "${PROJECT}/.git" ] || [ -f "$GITIGNORE" ]; then
    if ! grep -q "\.claude-data" "$GITIGNORE" 2>/dev/null; then
        printf '\n# Claude Code per-project data\n.claude-data/\n' >> "$GITIGNORE"
    fi
fi

# ── 导出所有环境变量 ──
export HOME="$DATA_DIR"
export LANG="C.UTF-8"
export LC_ALL="C.UTF-8"
export ANTHROPIC_BASE_URL="$BASE_URL"
export ANTHROPIC_AUTH_TOKEN="$AUTH_TOKEN"
export ANTHROPIC_API_KEY="$API_KEY"
export ANTHROPIC_MODEL="$DEFAULT_MODEL"
export ANTHROPIC_SMALL_FAST_MODEL="$DEFAULT_MODEL"
export ANTHROPIC_DEFAULT_SONNET_MODEL="$DEFAULT_MODEL"
export ANTHROPIC_DEFAULT_OPUS_MODEL="$DEFAULT_MODEL"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="$DEFAULT_HAIKU_MODEL"
export ANTHROPIC_THINK_MODEL="$THINK_MODEL"
export ANTHROPIC_LONG_CONTEXT_MODEL="$LONG_CONTEXT_MODEL"
export API_TIMEOUT_MS="$API_TIMEOUT_MS"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
export DOCKER_HOST="tcp://host.docker.internal:2375"

cd "$PROJECT"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  Nexus · Claude Session"
echo "║  Profile : ${LABEL:-$PROFILE}"
echo "║  Project : $PROJECT"
echo "║  Data    : $DATA_DIR"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 主循环：退出后提示续接 ──
while true; do
    # -c = continue last session（从 DATA_DIR 里的历史续接）
    claude -c --dangerously-skip-permissions || true
    echo ""
    echo "[Nexus] Claude exited.  r=restart(continue)  n=new session  q=quit"
    read -r REPLY
    case "$REPLY" in
        n) continue ;;  # 不带 -c，开新会话
        q|"") break ;;
        *) continue ;;  # 默认续接
    esac
done

echo "[Nexus] Session ended."
