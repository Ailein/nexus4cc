# Nexus: AI Terminal Bridge

[![Node.js](https://img.shields.io/badge/Node.js-v20+-green)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18-blue)](https://react.dev/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE.md)

**English** | [中文](#中文)

WebSocket tmux bridge for AI terminal access. Run Claude Code from any device, manage agents from anywhere.

## Features

- **WebSocket tmux Bridge** — Multiple PTY sessions, one per tmux window
- **Web Terminal** — xterm.js with mobile touch support (swipe, pinch-to-zoom)
- **Configurable Toolbar** — Server-persisted button layouts
- **Task Panel** — Claude SSE streaming for async tasks
- **File Browser** — Browse, edit, upload workspace files (sort by name / modified / size)
- **Multi-session** — Switch between tmux sessions instantly
- **Telegram Bot** — Control AI agents from mobile
- **PWA** — Installable, dark/light themes

## Quick Start

```bash
# 1. Clone
git clone <repo> nexus && cd nexus

# 2. Configure
cp .env.example .env
# Edit .env:
#   JWT_SECRET=$(openssl rand -hex 32)
#   ACC_PASSWORD_HASH=$(node -e "console.log(require('bcrypt').hashSync('yourpass', 12))")
#   WORKSPACE_ROOT=/workspace

# 3. Install & Build
npm install
cd frontend && npm install && npm run build && cd ..

# 4. Start
npm start
# Or with PM2: pm2 start ecosystem.config.cjs

# 5. Open http://localhost:59000
```

## Requirements

- Node.js 20+
- tmux
- Linux/WSL2 (Windows host accessible via WSL2)

## Architecture

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) and [NORTH-STAR.md](docs/NORTH-STAR.md).

```
┌─────────────┐     WebSocket      ┌──────────────┐
│   Browser   │ ◄────────────────► │   Nexus      │
│  (xterm.js) │                    │  (server.js) │
└─────────────┘                    └──────┬───────┘
                                          │
                              ┌───────────┼───────────┐
                              ▼           ▼           ▼
                         ┌───────┐   ┌────────┐  ┌────────┐
                         │ tmux  │   │ Tasks  │  │Telegram│
                         └───────┘   └────────┘  └────────┘
```

## Security Notes

- **Single-user design**: No rate limiting, bcrypt 12 rounds — use behind firewall/VPN
- **WS token in URL**: Token passed via query string for WebSocket auth
- **File system access**: Full WORKSPACE_ROOT access — isolate if needed
- **History note**: Commit `b3905e5` contains old test JWT_SECRET (rotated, historical only)

## Development

```bash
# Backend watch
npm run dev

# Frontend dev server
cd frontend && npm run dev
```

## Documentation

- [NORTH-STAR.md](docs/NORTH-STAR.md) — Core principles and constraints
- [PRD.md](docs/PRD.md) — Feature specifications
- [ROADMAP.md](docs/ROADMAP.md) — Future plans

## License

MIT — See [LICENSE.md](LICENSE.md)

---

# 中文

AI 终端 WebSocket 桥接。从任何设备运行 Claude Code，随时随地管理 Agent。

## 功能

- **WebSocket tmux 桥接** — 多 PTY 会话，每个 tmux window 一个
- **网页终端** — xterm.js + 移动端触控（滑动切换、双指缩放）
- **可配置工具栏** — 服务端持久化按键布局
- **任务面板** — Claude SSE 流式输出异步任务
- **文件浏览器** — 浏览、编辑、上传工作区文件
- **多会话管理** — 秒切 tmux session
- **Telegram 机器人** — 移动端控制 AI Agent
- **PWA** — 可安装、深色/浅色主题

## 快速启动

```bash
# 1. 克隆
git clone <repo> nexus && cd nexus

# 2. 配置
cp .env.example .env
# 编辑 .env:
#   JWT_SECRET=$(openssl rand -hex 32)
#   ACC_PASSWORD_HASH=$(node -e "console.log(require('bcrypt').hashSync('密码', 12))")
#   WORKSPACE_ROOT=/workspace

# 3. 安装构建
npm install
cd frontend && npm install && npm run build && cd ..

# 4. 启动
npm start
# 或 PM2: pm2 start ecosystem.config.cjs

# 5. 访问 http://localhost:59000
```

## 环境要求

- Node.js 20+
- tmux
- Linux/WSL2（Windows 主机通过 WSL2 访问）

## 架构

参见 [ARCHITECTURE.md](docs/ARCHITECTURE.md) 和 [NORTH-STAR.md](docs/NORTH-STAR.md)。

## 安全说明

- **单用户设计**：无速率限制，bcrypt 12轮 — 建议防火墙/VPN后使用
- **WS token 在 URL**：WebSocket 认证通过 query string 传递 token
- **文件系统访问**：完整的 WORKSPACE_ROOT 访问权限 — 按需隔离
- **历史备注**：Commit `b3905e5` 包含旧测试 JWT_SECRET（已轮换，仅历史记录）

## 开发

```bash
# 后端监听
npm run dev

# 前端开发服务器
cd frontend && npm run dev
```

## 文档

- [NORTH-STAR.md](docs/NORTH-STAR.md) — 核心原则和约束
- [PRD.md](docs/PRD.md) — 功能规格
- [ROADMAP.md](docs/ROADMAP.md) — 未来计划

## 许可

MIT — 见 [LICENSE.md](LICENSE.md)
