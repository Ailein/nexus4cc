# Nexus - The AI Command Center Product Requirements Document

**版本**: v0.1.0  
**状态**: Draft  
**作者**: —  
**最后更新**: 2026-03-14

---

## 目录

1. [背景与目标](https://claude.ai/chat/1463e262-bb7e-4f56-be5e-cd072353aa62#1-%E8%83%8C%E6%99%AF%E4%B8%8E%E7%9B%AE%E6%A0%87)
2. [用户与场景](https://claude.ai/chat/1463e262-bb7e-4f56-be5e-cd072353aa62#2-%E7%94%A8%E6%88%B7%E4%B8%8E%E5%9C%BA%E6%99%AF)
3. [现有方案痛点](https://claude.ai/chat/1463e262-bb7e-4f56-be5e-cd072353aa62#3-%E7%8E%B0%E6%9C%89%E6%96%B9%E6%A1%88%E7%97%9B%E7%82%B9)
4. [产品范围](https://claude.ai/chat/1463e262-bb7e-4f56-be5e-cd072353aa62#4-%E4%BA%A7%E5%93%81%E8%8C%83%E5%9B%B4)
5. [功能需求](https://claude.ai/chat/1463e262-bb7e-4f56-be5e-cd072353aa62#5-%E5%8A%9F%E8%83%BD%E9%9C%80%E6%B1%82)
    - 5.1 [Terminal 核心交互 (v1)](https://claude.ai/chat/1463e262-bb7e-4f56-be5e-cd072353aa62#51-terminal-%E6%A0%B8%E5%BF%83%E4%BA%A4%E4%BA%92-v1)
    - 5.2 [Session 管理 (v1)](https://claude.ai/chat/1463e262-bb7e-4f56-be5e-cd072353aa62#52-session-%E7%AE%A1%E7%90%86-v1)
    - 5.3 [PWA 与移动端适配 (v1)](https://claude.ai/chat/1463e262-bb7e-4f56-be5e-cd072353aa62#53-pwa-%E4%B8%8E%E7%A7%BB%E5%8A%A8%E7%AB%AF%E9%80%82%E9%85%8D-v1)
    - 5.4 [认证与安全 (v1)](https://claude.ai/chat/1463e262-bb7e-4f56-be5e-cd072353aa62#54-%E8%AE%A4%E8%AF%81%E4%B8%8E%E5%AE%89%E5%85%A8-v1)
    - 5.5 [IM Bridge (v2)](https://claude.ai/chat/1463e262-bb7e-4f56-be5e-cd072353aa62#55-im-bridge-v2)
    - 5.6 [Agent Manager (v2)](https://claude.ai/chat/1463e262-bb7e-4f56-be5e-cd072353aa62#56-agent-manager-v2)
    - 5.7 [Skill Registry (v3)](https://claude.ai/chat/1463e262-bb7e-4f56-be5e-cd072353aa62#57-skill-registry-v3)
    - 5.8 [Agent 间通信与任务调度 (v3)](https://claude.ai/chat/1463e262-bb7e-4f56-be5e-cd072353aa62#58-agent-%E9%97%B4%E9%80%9A%E4%BF%A1%E4%B8%8E%E4%BB%BB%E5%8A%A1%E8%B0%83%E5%BA%A6-v3)
6. [非功能需求](https://claude.ai/chat/1463e262-bb7e-4f56-be5e-cd072353aa62#6-%E9%9D%9E%E5%8A%9F%E8%83%BD%E9%9C%80%E6%B1%82)
7. [系统架构](https://claude.ai/chat/1463e262-bb7e-4f56-be5e-cd072353aa62#7-%E7%B3%BB%E7%BB%9F%E6%9E%B6%E6%9E%84)
8. [技术选型](https://claude.ai/chat/1463e262-bb7e-4f56-be5e-cd072353aa62#8-%E6%8A%80%E6%9C%AF%E9%80%89%E5%9E%8B)
9. [数据模型](https://claude.ai/chat/1463e262-bb7e-4f56-be5e-cd072353aa62#9-%E6%95%B0%E6%8D%AE%E6%A8%A1%E5%9E%8B)
10. [API 设计](https://claude.ai/chat/1463e262-bb7e-4f56-be5e-cd072353aa62#10-api-%E8%AE%BE%E8%AE%A1)
11. [部署架构](https://claude.ai/chat/1463e262-bb7e-4f56-be5e-cd072353aa62#11-%E9%83%A8%E7%BD%B2%E6%9E%B6%E6%9E%84)
12. [迭代计划](https://claude.ai/chat/1463e262-bb7e-4f56-be5e-cd072353aa62#12-%E8%BF%AD%E4%BB%A3%E8%AE%A1%E5%88%92)
13. [风险与约束](https://claude.ai/chat/1463e262-bb7e-4f56-be5e-cd072353aa62#13-%E9%A3%8E%E9%99%A9%E4%B8%8E%E7%BA%A6%E6%9D%9F)
14. [附录](https://claude.ai/chat/1463e262-bb7e-4f56-be5e-cd072353aa62#14-%E9%99%84%E5%BD%95)

---

## 1. 背景与目标

### 1.1 背景

用户当前通过 `ttyd + tmux + Docker` 的组合在自托管服务器上运行 Claude Code，并通过 Tailscale 组成的私有网络，在其他设备（PC、手机）的浏览器中访问该终端界面。

该方案功能上可用，但存在大量体验问题（详见第 3 节），根本原因在于：**ttyd 是为桌面终端设计的工具，而 AI 人机交互需要一个专为此场景构建的 Web 应用**。

### 1.2 项目目标

构建一套轻量、可扩展的自托管 Web 应用 **AI Command Center**，目标：

- **v1**：完整替代 ttyd + tmux 方案，提供流畅的跨设备 Terminal 交互体验
- **v2**：支持通过 Telegram / Slack 等 IM 工具与 AI Agent 交互
- **v3**：支持多 Agent 编排管理，构建 AI 团队工作流

### 1.3 设计原则

- **轻量优先**：v1 避免引入不必要的框架和服务，总代码量控制在可维护范围
- **完全自托管**：所有服务打包进 Docker Compose，不依赖第三方云服务
- **渐进增强**：v1 的架构决策必须为 v2/v3 预留扩展点，但不提前实现
- **移动端一等公民**：所有交互设计从移动端出发，桌面端增强

---

## 2. 用户与场景

### 2.1 用户画像

**主用户（当前唯一用户）**：独立开发者 / 技术人员

- 在一台常驻服务器（Linux，WSL2 或原生）上运行 Claude Code
- 通过 Tailscale 私有网络远程访问
- 设备多样：工作 PC（桌面浏览器）、iPad、iPhone（移动浏览器）

### 2.2 核心使用场景

|编号|场景|当前体验|期望体验|
|---|---|---|---|
|S-01|在手机上查看 Claude Code 运行进度|强制横屏、字体难看、无法滚动|竖屏可读，流畅滚动|
|S-02|在手机上向 Claude Code 发送指令|输入法无法输入 Esc/Tab/Ctrl+C|虚拟工具栏一键发送控制字符|
|S-03|浏览器快捷键被拦截|Ctrl+W 关闭标签页而非发给终端|终端内快捷键完全隔离|
|S-04|同时运行多个工作区的 Claude Code|需要多个 ttyd 端口|同一界面 Tab 切换多 Session|
|S-05|断线后恢复上下文|重新 attach tmux，体验差|自动重连 + scrollback 回放|
|S-06|通过 Telegram 发消息给 AI|不支持|发送消息 → AI 执行 → 回复结果|

---

## 3. 现有方案痛点

### 3.1 键盘与输入

- 浏览器默认拦截 Ctrl+W、Ctrl+T、Ctrl+L、Ctrl+N 等快捷键，无法传给终端
- iOS / Android 输入法不产生标准 KeyboardEvent，导致 Backspace、Enter 等按键无法识别
- 无法输入 Escape（手机物理键盘无此键）
- 中文输入法组合字符阶段 (composing) 与终端输入冲突

### 3.2 移动端布局

- ttyd 的终端宽度固定，手机竖屏下字符被截断
- 虚拟键盘弹出后终端区域被严重压缩
- 无响应式设计，字体大小不适配移动端 DPI

### 3.3 多会话与管理

- 每个工作区需要独立的 systemd service + 端口
- 无统一入口，无法在同一界面切换多个 Claude Code 实例
- 会话状态（历史输出）无持久化，断线即丢失

### 3.4 可扩展性

- ttyd + tmux 的架构无法在上层构建 Agent 管理、任务调度、IM 集成等功能
- 所有配置散落在 shell 脚本中，无配置界面

---

## 4. 产品范围

### 4.1 v1 范围（核心交互替代）

- [x] WebSocket PTY Terminal（替代 ttyd）
- [x] 会话持久化与 scrollback 回放（替代 tmux）
- [x] 多 Session 管理（同一界面切换）
- [x] 移动端虚拟工具栏
- [x] PWA（离线壳 + 全屏 + Home Screen 图标）
- [x] 基础 JWT 认证
- [x] Docker Compose 一键部署

### 4.2 v2 范围（IM 集成）

- [ ] Telegram Bot 接入
- [ ] Slack Bot 接入
- [ ] IM 消息路由到指定 Session
- [ ] AI 执行结果回传 IM

### 4.3 v3 范围（Agent 管理）

- [ ] 多 Agent 生命周期管理界面
- [ ] Skill / Prompt 模板注册与管理
- [ ] Agent 间任务传递
- [ ] 轻量任务队列与状态追踪

### 4.4 不在范围内

- 不实现自己的 LLM 调用层（保持使用 Claude Code 原有机制）
- 不实现代码编辑器（Terminal 足够）
- 不依赖任何第三方云服务（完全自托管）
- 不引入 LangGraph / AutoGen 等重型 Agent 框架（v3 以前）

---

## 5. 功能需求

### 5.1 Terminal 核心交互 (v1)

#### 5.1.1 PTY 连接

**FR-T-01** 用户打开 Web 页面后，前端通过 WebSocket 与后端建立 PTY 连接。  
**FR-T-02** 后端通过 `node-pty` spawn Docker 容器中的 Claude Code 进程（复用现有 `run-claude.sh` 逻辑）。  
**FR-T-03** PTY 输出（stdout/stderr）以二进制流形式通过 WebSocket 实时推送到前端 xterm.js 渲染。  
**FR-T-04** 用户键盘输入通过 WebSocket 实时发送到后端写入 PTY stdin。  
**FR-T-05** 终端 resize 事件（窗口大小变化）实时同步到 PTY（`pty.resize(cols, rows)`）。

#### 5.1.2 键盘处理

**FR-T-06** 注册 xterm.js `attachCustomKeyEventHandler`，拦截以下浏览器默认快捷键并转发给终端：

- Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+L, Ctrl+R, Ctrl+U, Ctrl+K
- F1–F12

**FR-T-07** Ctrl+C、Ctrl+D、Ctrl+Z 正常发送 ASCII 控制字符。  
**FR-T-08** iOS / Android 输入法 composing 阶段字符缓冲，`compositionend` 事件后批量写入 PTY。

#### 5.1.3 移动端虚拟工具栏

**FR-T-09** 移动端（viewport width < 768px）在终端下方显示固定工具栏，包含以下按键：

|按键标签|发送序列|说明|
|---|---|---|
|Esc|`\x1b`|Claude Code 退出模式|
|Tab|`\t`|自动补全|
|Ctrl+C|`\x03`|中断|
|Ctrl+D|`\x04`|EOF|
|↑|`\x1b[A`|历史命令|
|↓|`\x1b[B`|历史命令|
|Ctrl+R|`\x12`|历史搜索|
|/|`/`|快速输入斜杠（Claude Code 常用）|

**FR-T-10** 工具栏不遮挡终端内容，随虚拟键盘弹出自动上移。  
**FR-T-11** 桌面端工具栏隐藏（媒体查询）。

#### 5.1.4 渲染与显示

**FR-T-12** 支持完整的 256 色 / True Color ANSI 渲染。  
**FR-T-13** 支持 Unicode（中文、Emoji、宽字符）正确渲染。  
**FR-T-14** 字体大小可在设置中调整（范围 12–24px），默认 16px，配置持久化到 localStorage。  
**FR-T-15** 支持 Solarized Light 主题（与现有方案保持一致），可扩展主题配置。  
**FR-T-16** scrollback buffer 支持至少 10000 行，鼠标/触控滚动浏览历史。

---

### 5.2 Session 管理 (v1)

#### 5.2.1 Session 生命周期

**FR-S-01** 每个 Session 对应一个独立的 PTY 进程 + Docker 容器实例。  
**FR-S-02** Session 创建时需指定：

- 工作目录（workspace path，服务器上的绝对路径）
- Session 名称（可选，默认使用工作目录名）

**FR-S-03** Session 状态机：

```
CREATING → RUNNING → STOPPED
                ↓
            DETACHED（WebSocket 断开但进程仍运行）
                ↓
            RUNNING（重新连接）
```

**FR-S-04** WebSocket 断开后，PTY 进程继续运行（不因连接断开而终止）。  
**FR-S-05** 重新连接时，后端回放最近 500 行 scrollback 到前端（防止完整回放导致卡顿）。  
**FR-S-06** Session 可被手动终止（发送 SIGTERM → 等待 5s → SIGKILL）。  
**FR-S-07** Docker 容器随 Session 终止自动清理（`docker rm`）。

#### 5.2.2 Session 列表界面

**FR-S-08** 顶部 Tab Bar 显示所有活跃 Session，支持快速切换。  
**FR-S-09** Session Tab 显示：名称、状态指示灯（绿/黄/红）、运行时长。  
**FR-S-10** 支持创建新 Session（弹出对话框，输入 workspace path 和名称）。  
**FR-S-11** 支持关闭 Session（需二次确认）。  
**FR-S-12** Session 配置（工作区路径、环境变量覆盖）持久化到 PostgreSQL。

#### 5.2.3 scrollback 持久化

**FR-S-13** PTY 输出异步写入 PostgreSQL（`session_scrollback` 表，按 session_id + sequence 索引）。  
**FR-S-14** 写入策略：缓冲 100ms 批量写入，防止高频小写入冲击数据库。  
**FR-S-15** 每个 Session 最多保留最近 50000 行，超出自动删除最旧记录。  
**FR-S-16** 提供"完整历史"查看模式（独立页面，非实时流），支持搜索。

---

### 5.3 PWA 与移动端适配 (v1)

**FR-P-01** 提供 `manifest.json`，配置：

- `display: standalone`（全屏，隐藏浏览器 UI）
- `orientation: any`（支持横竖屏）
- 应用图标（192px、512px）
- `theme_color` 与 `background_color`

**FR-P-02** Service Worker 缓存前端静态资源（JS、CSS、字体），支持离线加载应用壳。  
**FR-P-03** Service Worker 不缓存 WebSocket 和 API 请求（实时数据不应缓存）。  
**FR-P-04** 竖屏模式下，终端区域高度 = viewport 高度 - 工具栏高度 - Session Tab Bar 高度。  
**FR-P-05** 虚拟键盘弹出时，页面不缩放，终端区域自适应剩余高度（使用 `visualViewport` API）。  
**FR-P-06** 支持 iOS Safari 和 Android Chrome，最低版本：iOS 15 / Chrome 90。

---

### 5.4 认证与安全 (v1)

**FR-A-01** 单用户 JWT 认证（与现有 ttyd Basic Auth 等价，但更安全）。  
**FR-A-02** 登录页面：输入密码 → 服务端验证 → 返回 JWT Token（有效期 30 天）。  
**FR-A-03** Token 存储于 `localStorage`，WebSocket 握手时通过 query param 或 header 传递。  
**FR-A-04** Token 过期后自动跳转登录页。  
**FR-A-05** 所有 HTTP API 和 WebSocket 连接均需有效 Token，否则返回 401。  
**FR-A-06** 登录密码通过环境变量 `ACC_PASSWORD_HASH`（bcrypt hash）配置，不明文存储。  
**FR-A-07** 服务仅监听 `127.0.0.1` 或 Docker 内网，通过 Nginx 反代暴露，依赖 Tailscale 做网络隔离。

---

### 5.5 IM Bridge (v2)

**FR-I-01** 支持 Telegram Bot 接入：用户在 Telegram 发消息 → 转发到指定 Session 的 PTY stdin。  
**FR-I-02** Claude Code 的输出（检测到输出停止 3 秒后）自动回复到 Telegram 对话。  
**FR-I-03** 支持通过消息前缀指定目标 Session，例如：`@vault: 帮我写一个单元测试`。  
**FR-I-04** 支持 Slack Slash Command 接入，功能与 Telegram 等价。  
**FR-I-05** IM Bridge 作为独立服务模块，通过内部 API 与 Session Manager 通信，不耦合前端。  
**FR-I-06** IM 消息和 AI 响应记录到 PostgreSQL（`im_messages` 表），支持历史查询。

---

### 5.6 Agent Manager (v2)

**FR-AG-01** Agent = 一个有名称、配置和状态的 Session，支持通过界面创建和管理。  
**FR-AG-02** Agent 配置包含：名称、工作区路径、启动参数（透传给 `run-claude.sh`）、描述、标签。  
**FR-AG-03** Agent 列表页展示所有 Agent 的状态、最后活跃时间、当前任务摘要。  
**FR-AG-04** 支持手动向 Agent 发送任务（等同于在 Terminal 中输入）。  
**FR-AG-05** Agent 配置持久化到 PostgreSQL，重启后可一键恢复。

---

### 5.7 Skill Registry (v3)

**FR-SK-01** Skill = 预定义的 Prompt 模板，带参数占位符。  
**FR-SK-02** 支持通过 Web 界面创建、编辑、删除 Skill。  
**FR-SK-03** 触发 Skill 时，填入参数后发送到指定 Agent。  
**FR-SK-04** Skill 分类与标签管理。  
**FR-SK-05** Skill 调用历史记录。

---

### 5.8 Agent 间通信与任务调度 (v3)

**FR-TQ-01** 轻量任务队列（基于 PostgreSQL `tasks` 表实现，不引入 Redis/Celery）。  
**FR-TQ-02** 任务状态：PENDING → ASSIGNED → RUNNING → DONE / FAILED。  
**FR-TQ-03** 支持将一个 Agent 的输出片段作为输入传给另一个 Agent（人工审核后触发）。  
**FR-TQ-04** 任务看板页面，展示所有任务的状态和流转记录。

---

## 6. 非功能需求

### 6.1 性能

|指标|目标|
|---|---|
|WebSocket PTY 端到端延迟|< 50ms（局域网 / Tailscale）|
|重连 scrollback 回放（500 行）|< 1s|
|前端首屏加载（PWA 缓存后）|< 500ms|
|Session 创建（含 Docker spawn）|< 5s|
|数据库单次写入（scrollback batch）|< 10ms|

### 6.2 可靠性

- PTY 进程崩溃时，Session 状态自动更新为 STOPPED，前端显示提示
- 后端服务重启不影响已运行的 Docker 容器（容器独立存活）
- 数据库连接断开后自动重连，重连期间 scrollback 写入使用内存缓冲

### 6.3 可维护性

- 后端 TypeScript，严格模式，无 `any`
- 前端 TypeScript + React，组件覆盖率目标 > 80%
- 所有环境变量统一通过 `.env` 文件管理，提供 `.env.example`
- Docker Compose 一键启动，无需手动执行初始化脚本（通过 `initdb.sql` 自动建表）

### 6.4 安全

- PTY 进程在 Docker 容器内运行，与宿主机文件系统隔离（仅 workspace 目录 bind mount）
- JWT secret 通过环境变量配置，不硬编码
- 数据库不暴露到宿主机端口外（仅 Docker 内网访问）
- Nginx 设置 `X-Frame-Options: DENY`、`Content-Security-Policy` 等安全 Header

---

## 7. 系统架构

### 7.1 整体分层

```
┌─────────────────────────────────────────────────────────┐
│                     客户端层                             │
│   Web PWA (xterm.js)  │  Mobile PWA  │  IM Bot (v2)    │
└──────────────┬─────────────────────────────┬────────────┘
               │ WebSocket / REST / Webhook   │
┌──────────────▼──────────────────────────────▼───────────┐
│               API Gateway — Fastify (Node.js)            │
│   WS Handler  │  REST API  │  Auth Middleware            │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│                     核心服务层                            │
│  PTY Manager  │  Session Store  │  IM Dispatcher (v2)   │
│  Agent Manager (v2)  │  Task Queue (v3)                  │
└──────────────┬──────────────────────────────────────────┘
               │                          │
┌──────────────▼───────────┐  ┌───────────▼──────────────┐
│       运行时层             │  │        数据层             │
│  Docker (cc:latest)      │  │  PostgreSQL               │
│  node-pty spawn          │  │  (sessions, scrollback,   │
│  workspace bind mount    │  │   configs, tasks)         │
└──────────────────────────┘  └──────────────────────────┘
```

### 7.2 关键数据流

#### 用户输入流

```
键盘事件 → xterm.js → WebSocket send(data) 
→ Fastify WS Handler → PTY Manager → pty.write(data) → Docker 容器 stdin
```

#### 输出显示流

```
Docker 容器 stdout → pty.onData(chunk) → PTY Manager 
→ scrollback buffer → [异步] PostgreSQL 批量写入
→ WebSocket send(chunk) → xterm.js write(chunk) → 屏幕渲染
```

#### 断线重连流

```
WebSocket 断开 → 前端检测 → 3s 后重连
→ 发送 reconnect(sessionId) → Session Store 查询最近 500 行
→ 批量 replay → xterm.js 渲染历史 → 恢复实时流
```

---

## 8. 技术选型

### 8.1 后端

|技术|选型|理由|
|---|---|---|
|运行时|Node.js 20 LTS|node-pty 生态最成熟，与 xterm.js 天然配套|
|Web 框架|Fastify 4|比 Express 快 2-3x，内置 schema 验证，WebSocket 插件完善|
|PTY 绑定|node-pty 1.x|VS Code Terminal 使用的同款库，支持 resize、Unicode、信号|
|ORM|Drizzle ORM|轻量，类型安全，比 Prisma 启动快，适合小项目|
|语言|TypeScript 5|全栈类型一致性|

### 8.2 前端

|技术|选型|理由|
|---|---|---|
|框架|React 18 + Vite|生态成熟，Vite 构建快|
|终端渲染|xterm.js 5|行业标准，VS Code / GitHub Codespaces 使用同款|
|状态管理|Zustand|轻量，够用，无 Redux 样板代码|
|样式|Tailwind CSS|移动端适配快，无需维护 CSS 文件|
|PWA|vite-plugin-pwa|自动生成 Service Worker 和 Manifest|

### 8.3 基础设施

|技术|选型|理由|
|---|---|---|
|数据库|PostgreSQL 16|用户偏好，成熟稳定，JSONB 支持灵活配置存储|
|反向代理|Nginx Alpine|轻量，WebSocket upgrade 配置简单|
|容器编排|Docker Compose v2|单机部署足够，无需 K8s|
|网络|Tailscale（已有）|不改变现有网络拓扑|

### 8.4 不引入（刻意排除）

|技术|排除理由|
|---|---|
|Redis|v1 不需要，PostgreSQL LISTEN/NOTIFY 足以支撑 v2 消息推送|
|tmux|会话持久化由 node-pty + DB 替代，tmux 是多余层|
|ttyd|完整替代，不保留|
|LangGraph / AutoGen|v3 之前不引入，保持可控|
|Prisma|启动慢，对简单 schema 过重，用 Drizzle 替代|

---

## 9. 数据模型

```sql
-- 会话表
CREATE TABLE sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    workspace   TEXT NOT NULL,             -- 服务器上的工作区路径
    status      VARCHAR(20) NOT NULL       -- CREATING / RUNNING / DETACHED / STOPPED
                DEFAULT 'CREATING',
    pid         INTEGER,                   -- PTY 进程 PID
    container_id VARCHAR(64),             -- Docker 容器 ID
    cols        INTEGER DEFAULT 220,
    rows        INTEGER DEFAULT 50,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    stopped_at  TIMESTAMPTZ
);

-- Scrollback 持久化（按 session 分区，大表）
CREATE TABLE session_scrollback (
    id          BIGSERIAL PRIMARY KEY,
    session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq         BIGINT NOT NULL,           -- 单调递增序号，用于回放排序
    data        BYTEA NOT NULL,            -- 原始 PTY 输出二进制（含 ANSI 序列）
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_scrollback_session_seq ON session_scrollback(session_id, seq DESC);

-- 配置表（键值存储，存用户偏好、环境变量覆盖等）
CREATE TABLE configs (
    key         VARCHAR(200) PRIMARY KEY,
    value       JSONB NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- IM 消息表（v2）
CREATE TABLE im_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform    VARCHAR(20) NOT NULL,      -- 'telegram' / 'slack'
    chat_id     VARCHAR(100) NOT NULL,
    direction   VARCHAR(10) NOT NULL,      -- 'inbound' / 'outbound'
    session_id  UUID REFERENCES sessions(id),
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Agent 配置表（v2，扩展 sessions 的元数据）
CREATE TABLE agents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    workspace   TEXT NOT NULL,
    launch_args JSONB DEFAULT '[]',        -- 额外 claude 启动参数
    env_overrides JSONB DEFAULT '{}',      -- 环境变量覆盖
    tags        TEXT[] DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 任务表（v3）
CREATE TABLE tasks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       VARCHAR(200) NOT NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    agent_id    UUID REFERENCES agents(id),
    input       TEXT,
    output      TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
```

---

## 10. API 设计

### 10.1 REST API

#### 认证

```
POST /api/auth/login
Body: { "password": "string" }
Response: { "token": "jwt_string", "expiresAt": "iso_date" }
```

#### Session 管理

```
GET    /api/sessions              # 列出所有 session
POST   /api/sessions              # 创建新 session
GET    /api/sessions/:id          # 获取 session 详情
DELETE /api/sessions/:id          # 终止并删除 session
GET    /api/sessions/:id/scrollback?lines=500  # 获取历史输出
```

#### 配置

```
GET  /api/config           # 获取所有配置
PUT  /api/config/:key      # 更新单个配置项
```

### 10.2 WebSocket 协议

连接地址：`ws://host/ws/terminal/:sessionId?token=<jwt>`

#### 消息格式（二进制帧 + 首字节 type）

```
Type 0x01 — PTY Output (server → client)
  [0x01][...data bytes]

Type 0x02 — PTY Input (client → server)
  [0x02][...data bytes]

Type 0x03 — Resize (client → server)
  [0x03][cols_hi][cols_lo][rows_hi][rows_lo]

Type 0x04 — Heartbeat ping (client → server, every 30s)
  [0x04]

Type 0x05 — Heartbeat pong (server → client)
  [0x05]

Type 0x06 — Scrollback replay start (server → client)
  [0x06][total_lines_hi][total_lines_lo]

Type 0x07 — Scrollback replay end (server → client)
  [0x07]

Type 0x08 — Session status change (server → client)
  [0x08][status_byte]
  status: 0x01=RUNNING, 0x02=DETACHED, 0x03=STOPPED
```

> 选择二进制协议而非 JSON 的原因：PTY 输出是高频二进制流，JSON 封装会带来不必要的序列化开销和延迟。

---

## 11. 部署架构

### 11.1 目录结构

```
ai-command-center/
├── .env.example                    # 环境变量模板
├── docker-compose.yml
├── docker-compose.dev.yml          # 开发模式覆盖（hot reload）
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                # 入口，Fastify 初始化
│       ├── config.ts               # 环境变量读取与校验
│       ├── db/
│       │   ├── client.ts           # Drizzle + pg 连接
│       │   ├── schema.ts           # Drizzle schema 定义
│       │   └── initdb.sql          # 建表 SQL（容器启动时执行）
│       ├── pty/
│       │   ├── manager.ts          # PTY 进程池：spawn / kill / resize
│       │   └── session.ts          # scrollback buffer + 异步 DB 写入
│       ├── ws/
│       │   └── terminal.ts         # WebSocket 连接处理
│       ├── api/
│       │   ├── auth.ts
│       │   └── sessions.ts
│       └── middleware/
│           └── auth.ts             # JWT 验证中间件
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.ts
│   ├── public/
│   │   ├── manifest.json
│   │   └── icons/                  # PWA 图标
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── store/
│       │   └── sessions.ts         # Zustand session 状态
│       ├── components/
│       │   ├── Terminal.tsx        # xterm.js 封装，WebSocket 接入
│       │   ├── MobileToolbar.tsx   # 虚拟按键工具栏
│       │   ├── SessionTabs.tsx     # 顶部 Tab Bar
│       │   ├── NewSessionModal.tsx # 创建 Session 对话框
│       │   └── LoginPage.tsx
│       ├── hooks/
│       │   ├── useTerminalWS.ts    # WebSocket 生命周期管理
│       │   └── useVisualViewport.ts# 处理移动端虚拟键盘
│       └── utils/
│           └── protocol.ts         # WS 二进制协议编解码
└── nginx/
    └── nginx.conf
```

### 11.2 docker-compose.yml

```yaml
version: "3.9"

services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: acc
      POSTGRES_USER: acc
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./backend/src/db/initdb.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U acc"]
      interval: 5s
      timeout: 5s
      retries: 10

  backend:
    build: ./backend
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://acc:${DB_PASSWORD}@db:5432/acc
      JWT_SECRET: ${JWT_SECRET}
      ACC_PASSWORD_HASH: ${ACC_PASSWORD_HASH}
      NODE_ENV: production
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock  # 用于 spawn Docker 容器
      - workspaces:/workspaces                      # 工作区共享卷（可选）
    expose:
      - "3000"

  frontend:
    build: ./frontend
    restart: unless-stopped
    expose:
      - "80"

  nginx:
    image: nginx:1.25-alpine
    restart: unless-stopped
    depends_on: [backend, frontend]
    ports:
      - "127.0.0.1:57681:80"    # 仅监听本地，由 Tailscale 暴露
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro

volumes:
  pgdata:
  workspaces:
```

### 11.3 nginx.conf 关键配置

```nginx
upstream backend { server backend:3000; }
upstream frontend { server frontend:80; }

server {
    listen 80;

    # 安全 Header
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy no-referrer;

    # WebSocket PTY 流
    location /ws/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;  # 长连接不超时
        proxy_send_timeout 86400s;
    }

    # REST API
    location /api/ {
        proxy_pass http://backend;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 前端静态资源（含 PWA）
    location / {
        proxy_pass http://frontend;
    }
}
```

### 11.4 环境变量

```bash
# .env.example

# 数据库
DB_PASSWORD=change_me_strong_password

# JWT（用 openssl rand -hex 32 生成）
JWT_SECRET=change_me_jwt_secret_32_bytes_hex

# 登录密码 hash（用 htpasswd -bnBC 12 "" yourpassword | tr -d ':\n' 生成）
ACC_PASSWORD_HASH=$2y$12$...

# Claude Code Docker 镜像
CLAUDE_IMAGE=cc:latest

# Kimi / Anthropic API 配置（透传给 Claude Code 容器）
ANTHROPIC_BASE_URL=https://api.kimi.com/coding
ANTHROPIC_AUTH_TOKEN=sk-kimi-xxx
ANTHROPIC_MODEL=kimi-for-coding

# IM Bridge（v2，可选）
TELEGRAM_BOT_TOKEN=
SLACK_BOT_TOKEN=
```

---

## 12. 迭代计划

### v1 — 核心交互替代（目标：2 周）

**Week 1**

- [ ] 后端骨架：Fastify + TypeScript + Drizzle + PostgreSQL 连通
- [ ] PTY Manager：node-pty spawn Docker 容器，输出流 WebSocket 推送
- [ ] WebSocket 协议实现（二进制帧编解码）
- [ ] 数据库建表，scrollback 异步批量写入

**Week 2**

- [ ] 前端骨架：React + Vite + xterm.js 基础渲染
- [ ] WebSocket 接入，双向 PTY 流通
- [ ] Session Tab Bar + 多 Session 切换
- [ ] 移动端虚拟工具栏
- [ ] PWA manifest + Service Worker
- [ ] 登录页 + JWT 认证
- [ ] Docker Compose 整合，端到端测试
- [ ] 替换现有 systemd 服务

### v2 — IM 集成（目标：v1 稳定后 2 周）

- [ ] IM Dispatcher 模块设计
- [ ] Telegram Bot webhook 接入
- [ ] 消息路由到指定 Session
- [ ] 输出检测（idle 3s）+ 回复 IM
- [ ] im_messages 表 + 历史查询
- [ ] Slack 支持（与 Telegram 共用 Dispatcher）

### v3 — Agent 管理（目标：v2 稳定后）

- [ ] Agent 配置界面（CRUD）
- [ ] Agent 列表与状态看板
- [ ] Skill Registry 界面
- [ ] 轻量任务队列（PG-based）
- [ ] 任务看板

---

## 13. 风险与约束

### 13.1 技术风险

|风险|概率|影响|缓解措施|
|---|---|---|---|
|node-pty 在 Docker 内运行存在权限问题|中|高|后端容器以 root 运行，或配置 `--privileged`；先验证 PoC|
|xterm.js 在 iOS Safari 滚动性能差|中|中|启用 xterm.js WebGL renderer；降级时用 Canvas renderer|
|scrollback 高频写入导致 PostgreSQL 压力过大|低|中|批量写入（100ms buffer）+ 分区表 + 定期清理旧数据|
|Docker socket 挂载带来安全风险|中|高|服务仅监听 127.0.0.1 + Tailscale 网络隔离；后续可换 Docker API over TCP with TLS|

### 13.2 约束

- 依赖 `cc:latest` Docker 镜像已在服务器上构建完成
- 依赖 Docker daemon 运行（`/var/run/docker.sock` 可访问）
- Tailscale 网络现有配置不变，仍使用 57681 端口
- 服务器资源：需至少 512MB 内存供 Node.js 后端 + PostgreSQL

---

## 14. 附录

### 14.1 现有方案配置参考

现有 `run-claude.sh` 的环境变量配置需完整迁移到 `.env` 文件中，启动 Docker 容器时透传。关键变量：

```
ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_MODEL,
ANTHROPIC_SMALL_FAST_MODEL, ANTHROPIC_DEFAULT_SONNET_MODEL,
ANTHROPIC_DEFAULT_OPUS_MODEL, ANTHROPIC_DEFAULT_HAIKU_MODEL,
ANTHROPIC_THINK_MODEL, ANTHROPIC_LONG_CONTEXT_MODEL,
API_TIMEOUT_MS, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
```

### 14.2 xterm.js 关键配置参考

```typescript
const terminal = new Terminal({
  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
  fontSize: 16,
  lineHeight: 1.2,
  scrollback: 10000,
  cursorBlink: true,
  allowProposedApi: true,
  theme: {
    background: '#fdf6e3',
    foreground: '#657b83',
    cursor: '#2c4d57',
  },
});

// WebGL renderer（性能最优）
const webglAddon = new WebglAddon();
terminal.loadAddon(webglAddon);

// 拦截浏览器快捷键
terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
  const blocked = ['w', 't', 'n', 'l', 'r', 'u', 'k'];
  if (e.ctrlKey && blocked.includes(e.key.toLowerCase())) {
    e.preventDefault();
    return false;
  }
  return true;
});
```

### 14.3 术语表

|术语|定义|
|---|---|
|Session|一个运行中的 Claude Code 实例，对应一个 PTY 进程和 Docker 容器|
|PTY|Pseudo-Terminal，Unix 伪终端，提供终端 I/O 接口|
|Scrollback|终端历史输出缓冲区|
|IM Bridge|即时通讯平台（Telegram/Slack）与 Session 之间的消息路由层|
|Agent|v2 起，具名、可配置、可调度的 Session 实例|
|Skill|预定义的 Prompt 模板，带参数化接口|
|ACC|AI Command Center，本项目简称|