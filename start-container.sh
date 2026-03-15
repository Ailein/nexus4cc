#!/bin/bash
SESSION="${TMUX_SESSION:-main}"

# 确保 tmux session 存在（已存在时静默跳过）
tmux new-session -d -s "$SESSION" 2>/dev/null || true

exec node /app/server.js
