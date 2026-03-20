# ROADMAP — Nexus

**锚点**: `docs/NORTH-STAR.md` | **PRD**: `docs/PRD.md`

---

## Current Sprint（进行中）

### 多 tmux session 支持（F-18）✅
**北极星轴**：轴三 — 极致 Agent 管理体验
**状态**: 已完成

验收标准：
- [x] `GET /api/tmux-sessions` 列出所有 tmux session
- [x] `/ws?session=<name>&window=<index>` 连接指定 session 和 window
- [x] 后端 ptyMap 支持 session:key 格式
- [x] 前端 session 选择器（Sidebar 下拉）
- [x] 前端传递 session 参数到所有 API 和 WebSocket
- [x] session 选择持久化到 localStorage

前置依赖：F-11 ✅

---

## Next Sprint（轴二：上下文同步深化）

### 上下文附件同步（F-14）✅ 已完成
**北极星轴**：轴二
验收标准：
- [x] 移动端 Web UI 支持上传图片/文件到指定 session（TabBar 📎 入口）
- [x] 文件写入 session 对应的 cwd，并自动在终端输入文件路径
- [x] 支持剪贴板图片直接粘贴（paste from clipboard）

前置依赖：F-13 ✅

### Tab Bar + 移动端底导航（F-09/F-10）✅
**北极星轴**：轴三 — 极致 Agent 管理体验
验收标准：
- [x] Tab Bar 实时反映 tmux window 列表（轮询 2s）
- [x] 点击 Tab 切换 window，当前活跃 tab 高亮
- [x] BottomNav 在移动端替代顶部 Tab Bar，支持滑动切换
- [x] 新建 session 按钮触发 WorkspaceSelector 面板

### 独立 window PTY（F-11）✅
**北极星轴**：轴三
验收标准：
- [x] `ensureWindowPty(windowIndex)` 返回 Map 中独立 PTY 实例
- [x] WebSocket 路由：`/ws?token=xxx&window=<index>` 连接特定 window
- [x] 多设备连接不同 window 互不干扰
- [x] resize 只影响当前 window 的 PTY
- [x] 空闲 5 分钟后自动清理 PTY 节省资源
- [x] `GET /api/sessions/:id/output` 获取窗口最后输出

### Agent 状态卡片（F-15）✅
**北极星轴**：轴三
验收标准：
- [x] 「运行中」状态指示器（动态颜色显示在 TabBar、Sidebar）
- [x] `GET /api/sessions/:id/output` 后端 API 提供各窗口最后 2KB 输出
- [x] TabBar 悬浮显示窗口最后输出预览（500 字符）
- [x] 视觉区分「等待输入」(🟡) / 「已退出 shell」(⚪) / 「运行中」(🟢) —— 基于 idleMs + 输出末行启发式分析

---

## Backlog（轴二：零摩擦上下文同步）

> 以下功能共同构成「任意时间地点与 AI 交互」的愿景。
> 设计原则：异步 tasks 与交互 PTY 解耦，共存互不干扰。

### claude -p 非交互派发（F-13）✅
**北极星轴**：轴二
验收标准：
- [x] `POST /api/tasks { session_name, prompt }` → `claude -p` 后台执行
- [x] SSE 流式返回结果
- [x] 前端 TaskPanel 展示结果，不占用交互 PTY
- [x] 任务历史存 `data/tasks.json`

### Telegram Bot 频道（F-16）✅ 后端完成
**北极星轴**：轴二
验收标准：
- [x] `POST /api/webhooks/telegram` 接收消息
- [x] 调用 `claude -p` 执行，结果回传 Telegram 对话
- [x] Bot Token 存环境变量 `TELEGRAM_BOT_TOKEN`
- [x] `GET /api/telegram/setup` 一键注册 webhook URL
- [x] 任务记录写入 `data/tasks.json`（source: telegram）
- [ ] 支持发图片/文件附件给指定 session（待 F-14）

前置依赖：F-13（tasks API 稳定）✅

### 上下文附件同步（F-14）
**北极星轴**：轴二
验收标准：
- [ ] 移动端 Web UI 支持上传图片/文件到指定 session
- [ ] 文件写入 session 对应的 cwd，并自动在终端输入文件路径
- [ ] 支持剪贴板图片直接粘贴（paste from clipboard）

前置依赖：F-13

### 多输入渠道统一路由（F-17）
**北极星轴**：轴二
说明：Web / Telegram / 未来其他渠道的 prompt 统一进入 task 队列，结果同步回发起方。
前置依赖：F-16 稳定后提炼通用抽象

### 多 tmux session 支持（F-18）
**北极星轴**：轴三
验收标准：
- [ ] `GET /api/tmux-sessions` 列出所有 tmux session
- [ ] `/ws?session=<name>&window=<index>` 连接指定 session 和 window
- [ ] 前端 session 选择器

前置依赖：F-11

---

## 已完成（v1.3）

| Feature | Commit |
|---|---|
| WebSocket tmux 桥 + JWT 认证 | `48c13ca` |
| xterm.js + 移动端滚动/缩放 | `48c13ca` |
| 可配置工具栏（服务端持久化） | `3bf29f9` |
| Session 管理 UI + API | `9eb36fc` |
| DELETE /api/sessions/:id | `48e3725` |
| claude 配置路径修复 | `dcb4836` |
| 窗口切换/会话创建修复 | `622096a` |
| 关闭后保持窗口 | `9b9dacf` |
| claude -c 会话历史自动检测 | `e676766` |
| 移动端底导航（BottomNav.tsx） | `fb21eee` |
| 主题跟随系统 + CSS vars 修复 | 本会话 |
| 加载遮罩 + 窗口切换 race 修复 | 本会话 |
| F-13 TaskPanel 前端（SSE 流式）| 本会话 |
| F-16 Telegram Bot webhook 后端 | 本会话 |
| F-14 文件上传 (`POST /api/upload`) | 本会话 |
| 登录页主题适配 CSS vars | 本会话 |
| 移动端上传入口（TabBar 📎）| 本会话 |
| F-15 Agent 状态指示器（运行中绿点）| 本会话 |
| F-11 独立 Window PTY | 本会话 |
| F-16 Telegram 接收文件（photo/document）| 本会话 |
| 前端 Code-splitting（lazy load 面板）| 本会话 |
| 窗口重命名（TabBar/Sidebar/BottomNav）| 本会话 |
| WebSocket 指数退避重连 | 本会话 |
| 滚动位置记忆（窗口切换）| 本会话 |
| 点击终端聚焦输入框 | 本会话 |
| 复制终端内容按钮 | 本会话 |
| F-15 完整状态卡片 — Tab 悬浮输出预览 | 本会话 |
| 修复：窗口不存在时自动 fallback | 本会话 |
| 优化：响应式断点 1024px→768px | 本会话 |
| 修复：WebSocket 无限重连循环（intentionalClose flag）| 本会话 |
| 修复：移动端 terminal 不填满高度（display:flex）| 本会话 |
| 优化：in-place WS 重连（不刷新页面，指数退避）| 本会话 |
| 修复：初始空状态闪烁（windowsLoaded guard）| 本会话 |
| F-15 完整：动态 Agent 状态（运行/等待/shell）| 本会话 |
| TabBar 移动端 session 切换（多 session 时显示）| 本会话 |
| 动态页面标题（显示窗口名+状态图标）| 本会话 |
