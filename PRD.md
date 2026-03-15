# Nexus — AI Agent 终端面板

**版本**: v1.2.0
**状态**: Active
**最后更新**: 2026-03-15

---

## 一句话定义

Nexus 是 ttyd 的极简替代：一个 WebSocket 桥接 tmux，加一个解决移动端交互问题的自定义前端，运行在内置 claude CLI 的 `cc:nexus` 容器中。

---

## 解决的核心问题

1. **统一入口**：一个 URL 访问 tmux 里所有 Agent，浏览器关掉后 Agent 继续运行
2. **按键可用**：PC 和移动端都能可靠发送 Esc / Ctrl+C 等控制字符；移动端滑动屏幕即可浏览历史
3. **快速启动 Agent**：通过会话管理 UI 在任意路径一键启动 claude，无需手动 ssh 进容器

---

## 不做什么

- 不替换 tmux（Session 管理、持久化、scrollback 全部由 tmux 负责）
- 不做 Session 注册或数据库（当前版本）
- 不做多用户认证（单密码 JWT）
- 不暴露 Docker socket 到前端

---

## 容器环境

基础镜像 `cc:latest` 已包含：bash、node 20、git、claude CLI（`/home/claude/.local/bin/claude`）、tmux、python3、make、g++。

`cc:nexus` 在此基础上叠加：Nexus server.js、前端 dist、node-pty（native addon）。

**为什么用 cc:latest 而不是 node:alpine：**
- 需要 bash（alpine 默认无 bash，claude 脚本依赖 bash）
- 需要 claude CLI（cc:latest 已安装并配置好 PATH）
- 避免 node-pty 在 alpine 下的重新编译问题

---

## Session 模型

`WORKSPACE_ROOT`（默认 `/home/librae`）整体挂载进容器，路径与宿主机完全一致。

**命名规则**：相对路径，`/` 替换为 `-`：

```
WORKSPACE_ROOT = /home/librae

相对路径              Session 名（= tmux window 名）
vault             →   vault
projects/blog     →   projects-blog
work/alpha/v2     →   work-alpha-v2
```

**启动命令（两阶段）**：

```bash
# 阶段一：先跑 bash，验证终端交互正常（已支持，默认行为）
tmux new-window -t main -c "/home/librae/vault" -n "vault" "bash"

# 阶段二：直接启动 claude（cc:nexus 已有 claude CLI）
tmux new-window -t main -c "/home/librae/vault" -n "vault" "claude"
```

UI 里"命令"输入框留空 → 默认 `sh`（容器 alpine 兼容）；输入 `bash` 或 `claude` 即可。

---

## 架构

```
Browser（任意设备）
    ↕  WSS /ws?token=<jwt>
Nexus Server（Node.js，/app/server.js）
    ↕  node-pty  →  tmux attach-session -t main
tmux session "main"（运行在 cc:nexus 容器内）
    ├── window vault           （cwd: /home/librae/vault）
    ├── window projects-blog   （cwd: /home/librae/projects/blog）
    └── window work-alpha-v2   （cwd: /home/librae/work/alpha/v2）
```

**浏览器关闭后的行为：** WebSocket 断开 → node-pty detach → tmux 和所有 Claude Code 继续运行。重新打开浏览器 → 重新 attach → 接续输出。

---

## 扩展性设计

```
┌─────────────────────────────────────────────┐
│  前端层   xterm.js + Toolbar + SessionMgr   │  ← v2 可加：Tab Bar、Agent 状态卡片
├─────────────────────────────────────────────┤
│  API 层   REST /api/* + WS /ws             │  ← v2 可加：多 window 路由、claude -p 派发
├─────────────────────────────────────────────┤
│  桥接层   node-pty ↔ tmux                  │  ← v2 可加：ensurePty(windowId) Map 结构
├─────────────────────────────────────────────┤
│  数据层   /app/data/*.json（volume 持久化） │  ← v2 可加：SQLite 存任务历史
└─────────────────────────────────────────────┘
```

---

## 功能需求

### 1. WebSocket 桥（后端核心）

**FR-B-01** 服务启动时通过 `node-pty` 执行 `tmux attach-session -t <TMUX_SESSION>`，`TMUX_SESSION` 通过环境变量配置（默认 `main`）。

**FR-B-02** 浏览器通过 `wss://host/ws?token=<jwt>` 建立连接。后端验证 Token，将 WebSocket 与 PTY 双向绑定：PTY 输出广播给所有连接的客户端；客户端发来的数据写入 PTY stdin。

**FR-B-03** 同一时刻支持多个浏览器连接（多设备同时查看同一 tmux）。

**FR-B-04** 客户端发送 `{type: 'resize', cols, rows}` 时调用 `pty.resize()`；其他消息视为原始键盘输入。

**FR-B-05** 所有客户端断开后，PTY 保持运行，等待下次连接。

**FR-B-06** PTY 退出后（Ctrl+D 等），自动重建 tmux session，前端提示刷新重连。

### 2. Session 管理 API

**FR-S-01** `POST /api/sessions` — 在 tmux 中新建 window，参数 `{rel_path, command}`：
- `rel_path` 为绝对路径（直接用）或相对 WORKSPACE_ROOT 的路径
- `command` 默认 `sh`，可传 `bash` / `claude` / 任意命令

**FR-S-02** `GET /api/sessions` — 列出当前 tmux session 的所有 window（index、name、active）。

**FR-S-03** 前端会话管理面板（`SessionManager`）：
- 展示 window 列表，点击切换（发送 `\x02{index}`）
- 新建 session 表单：路径 + 命令
- 退出登录

### 3. 认证

**FR-A-01** 单密码 JWT 认证，密码以 bcrypt hash 存环境变量 `ACC_PASSWORD_HASH`，Token 有效期 30 天。

**FR-A-02** WebSocket 通过 `?token=` 验证；REST API 通过 `Authorization: Bearer` 验证。

**FR-A-03** 登录页：输入密码 → `POST /api/auth/login` → Token 存 localStorage → 跳转终端页。

### 4. 终端前端

**FR-T-01** xterm.js 渲染，连接到 `/ws?token=<jwt>`，支持 256 色 / True Color / Unicode。

**FR-T-02** 初始化：`scrollback: 10000`，字体大小默认 16px，支持双指捏合调整字号（8–32px），持久化 localStorage。

**FR-T-03** 每次 WebSocket 建立时先 `fitAddon.fit()` 再发送 resize 消息，确保以当前设备实际尺寸初始化 PTY。

**FR-T-04** ResizeObserver + orientationchange 监听容器尺寸变化，自动 fit 并通知后端。

**FR-T-05** 桌面端通过 `attachCustomKeyEventHandler` 拦截浏览器默认快捷键并转发：Ctrl+W/T/N/L/R。

### 5. 控制工具栏

PC 和移动端均显示，固定在终端底部。

**FR-K-01** 配置分两区：**固定行**（始终显示）+ **展开区**（可折叠），均可拖拽排序。

**FR-K-02** 出厂默认固定行：`Esc Tab ^C ↑ ↓ ← → ↵ ^L ^R`

**FR-K-03** 出厂默认展开区：`^D ^U ^K ^Y ^B ^O ^T ^F ^G ^J S-Tab M-B M-F / ! @ ^V ↓↓`

所有按键对应的序列见 `toolbarDefaults.ts`，与 [Claude Code 交互模式文档](https://code.claude.com/docs/en/interactive-mode) 对齐。

**FR-K-04** 特殊 action：
- `^V`：读取系统剪贴板（`navigator.clipboard.readText()`），将文本发送到终端
- `↓↓`：滚动到终端底部

**FR-K-05** 工具栏配置持久化：
- 实时保存到 `POST /api/toolbar-config`（Docker volume 持久化，跨设备共享）
- 同时写 localStorage 作即时加载缓存
- 启动时优先从服务端加载，覆盖本地缓存

**FR-K-06** 编辑模式：支持"存为默认"（保存当前布局为个人默认）和"重置"（还原到个人默认或出厂配置）。

**FR-K-07** 触摸防护：工具栏所有区域触摸时不弹出软键盘（native `touchstart` preventDefault）。编辑区滚动不受影响。

**FR-K-08** "会话"按钮呼出 `SessionManager` 面板。

### 6. 移动端滚动

**FR-M-01** 触摸事件由 Terminal 容器原生监听器接管，xterm.js 自身触摸处理通过 `pointer-events: none` 禁用。

**FR-M-02** 单指滑动：根据 deltaY 调用 `terminal.scrollLines(n)`，行高动态从 xterm 内部获取（`_renderService.dimensions.css.cell.height`），确保不同字号下灵敏度一致。

**FR-M-03** 双指捏合：调整终端字体大小（8–32px），实时 fit 并通知后端 resize。

**FR-M-04** 有新输出时自动滚到底部，除非用户正在向上浏览（`viewportY < baseY`）。

**FR-M-05** 点击终端区域（tap，位移 < 8px）弹出输入法（通过 hidden input proxy 实现）。

### 7. PWA

**FR-P-01** `manifest.json`，`display: standalone`，支持 iOS Safari / Android Chrome 添加主屏。

**FR-P-02** Service Worker 缓存静态资源，不缓存 WebSocket 和 /api 请求。

---

## 已知限制

**多客户端 resize 冲突**：多设备同时连接时，PTY 尺寸以最后收到的 resize 为准，可能导致部分设备布局错乱。实际使用通常只有一个活跃窗口，v2 可用"取最小尺寸"策略解决。

**单 PTY 架构**：所有客户端共享同一个 tmux attach PTY，切换 tmux window 时所有设备同步切换。v2 可改为 window 级别独立 PTY（Map 结构），但复杂度大幅上升。

**Claude 配置隔离**：容器内 claude 用户的配置在 `/home/claude/.claude/`，与宿主机的 `/home/librae/.claude/` 相互独立。如需共享配置（API key、settings），需额外挂载。

**文件权限**：`/home/librae` 挂载进容器后，文件所有者是宿主机用户（UID 1000/librae）。容器内 `claude` 用户的 UID 需与宿主机一致，否则写文件时会遇到权限问题。

---

## 部署

### 目录结构

```
nexus/
├── server.js
├── package.json
├── frontend/
│   └── src/
│       ├── App.tsx              # 登录页 + 路由
│       ├── Terminal.tsx         # xterm.js + WebSocket + 触摸处理
│       ├── Toolbar.tsx          # 工具栏（配置化按键）
│       ├── SessionManager.tsx   # 会话管理面板
│       └── toolbarDefaults.ts   # 按键定义和出厂配置
├── public/manifest.json
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

### docker-compose.yml

```yaml
version: "3.9"
services:
  nexus:
    build:
      context: .
      dockerfile: Dockerfile
    image: cc:nexus
    container_name: nexus
    restart: unless-stopped
    environment:
      JWT_SECRET: ${JWT_SECRET}
      ACC_PASSWORD_HASH: ${ACC_PASSWORD_HASH}
      TMUX_SESSION: ${TMUX_SESSION:-main}
      WORKSPACE_ROOT: ${WORKSPACE_ROOT:-/home/librae}
      PORT: 3000
    ports:
      - "59000:3000"
    volumes:
      - /home/librae:/home/librae      # 宿主机工作区，可写（claude 需要写文件）
      - nexus-data:/app/data           # 持久化配置（toolbar 等）

volumes:
  nexus-data:
```

### .env.example

```bash
JWT_SECRET=           # openssl rand -hex 32
ACC_PASSWORD_HASH=    # htpasswd -bnBC 12 "" yourpassword | tr -d ':\n'
TMUX_SESSION=main     # 要 attach 的 tmux session 名
WORKSPACE_ROOT=/home/librae   # 容器内工作区根目录
PORT=3000
```

### 构建与启动

```bash
# 1. 构建前端
cd frontend && npm run build && cd ..

# 2. 构建镜像并启动
docker compose build   # 生成 cc:nexus 镜像
docker compose up -d

# 3. 在会话管理 UI 里新建 session，选择路径，命令填 claude
#    或手动：docker exec -it nexus tmux new-window -t main -c /home/librae/myproject -n myproject claude
```

---

## 尚未对齐 / 待确认的问题

> 这里列出当前实现中需要用户决策或可能踩坑的点。

### ⚠️ 文件权限问题（重要）

容器内以 `claude` 用户运行。`/home/librae` 是宿主机 `librae` 用户（UID 1000）的目录。

- 如果容器内 `claude` 用户的 UID ≠ 1000，claude 在编辑文件时会遇到 `Permission denied`
- **验证方法**：`docker exec nexus id` 看 UID，与宿主机 `id librae` 比较
- **修复方法**：在 Dockerfile 里 `usermod -u 1000 claude`，或用 `USER root` 以 root 运行（有安全风险）

### ⚠️ Claude API 配置未挂载

容器内 claude 的配置目录是 `/home/claude/.claude/`（在镜像里）。宿主机上的 `/home/librae/.claude/`（含 API key、settings、memory）没有挂载进来。

- 新建 session 运行 `claude` 时，使用的是镜像内的配置，而不是你平时在主机上用的配置
- **若需共享**：在 docker-compose.yml volumes 里加 `/home/librae/.claude:/home/claude/.claude`

### ⚠️ 单 PTY 切换所有设备同步

当前架构只有一个 PTY（`tmux attach`），tmux window 切换是全局的——手机和 PC 同时连接时，在会话管理里切换 window 会让所有设备同步切换到同一个 window。这是 v1 的已知限制。

### 💡 启动 claude 的推荐命令

在会话管理创建 session 时，命令字段填 `claude`（而不是 `bash ~/scripts/run-claude.sh`，PRD 旧版里的脚本，cc:nexus 已不需要）。

---

## 迭代路径

### 当前状态（v1.2）

已完成：
- WebSocket 桥 + JWT 认证
- xterm.js 终端（移动端滚动、双指缩放、屏幕旋转 resize）
- 可配置工具栏（固定行 + 展开区、拖拽排序、存为默认、服务端持久化）
- 会话管理 UI（列表、切换、新建）
- cc:nexus 容器，bash + claude CLI 可用

### v2：Tab Bar 与独立 window PTY

```
前端：SessionManager → 顶部 Tab Bar，实时显示所有 window，点击切换
后端：ensurePty(windowId) 返回 Map 中的独立 PTY 实例
WS：/ws?window=0 连接特定 window，多设备连接互不干扰
```

### v3：claude -p 非交互派发

```
POST /api/tasks  { window, prompt }
→ spawn('claude', ['-p', prompt], { cwd })
→ 流式返回结果
→ 前端显示结果卡片（不占用交互 PTY）
```

### v4：IM Bot

```
POST /api/webhooks/telegram
→ 解析消息，调用 /api/tasks
→ 结果回传 Telegram
```
