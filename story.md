## 架构设计方案

你的痛点很清晰：ttyd + tmux 在移动端体验差、键盘拦截、输入法不兼容。核心问题是**用了一个为桌面设计的 terminal emulator 来承载本质上是"人机对话"的交互**。

我的建议是：不要再套 ttyd，自己做一个轻量的 PTY WebSocket 服务 + 定制 Web Terminal。

---

### 整体架构以下是我的整体建议和架构设计：

**核心判断**：你的问题不是 ttyd 不好，而是把"终端模拟器"当成"AI 交互入口"了。新系统应该把 Claude Code 的 PTY 进程作为一个托管资源，暴露给一个专门为 AI 交互设计的 Web UI。

**关于 PWA**：必要，移动端加 home screen + fullscreen 体验差异巨大，而且 Service Worker 还能做离线 Shell 缓存。

![[attachments/Pasted image 20260314205936.png]]

---

### 技术选型与理由

**后端：Node.js + Fastify**

- `node-pty` 是最成熟的 PTY 绑定，原生支持 resize、信号、Unicode
- 与 xterm.js 生态天然契合，不需要中间层转换
- Fastify 比 Express 快 2-3 倍，且 WebSocket 插件完善

**前端：React + Vite + xterm.js**

- xterm.js 是 VS Code Terminal 用的那套，键盘处理远比 ttyd 可控
- 可以自定义捕获所有键盘事件，移动端加虚拟 Toolbar（Esc、Tab、Ctrl+C、上下箭头等）
- PWA manifest + Service Worker：解决移动端键盘/全屏问题

**数据库：PostgreSQL**

- 会话历史、scrollback 持久化
- Agent/Skill 配置存储
- 不需要 Redis（v1），仅当多实例部署时再加

**不需要 tmux**

- tmux 的会话保持由 node-pty + DB scrollback 替代
- 断线重连直接 replay buffer，比 tmux attach 更可控

---

### v1 目录结构建议

```
ai-command-center/
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── src/
│   │   ├── index.ts          # Fastify 入口
│   │   ├── pty/
│   │   │   ├── manager.ts    # PTY 进程池，spawn/kill/resize
│   │   │   └── session.ts    # scrollback buffer + DB 持久化
│   │   ├── ws/
│   │   │   └── terminal.ts   # WebSocket handler，双向流
│   │   ├── api/
│   │   │   └── sessions.ts   # REST：列出/创建/删除 session
│   │   └── db/
│   │       └── schema.sql    # sessions, scrollback, configs
├── frontend/
│   ├── Dockerfile
│   ├── public/
│   │   └── manifest.json     # PWA manifest
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── Terminal.tsx      # xterm.js 封装
│   │   │   ├── MobileToolbar.tsx # Esc/Tab/Ctrl+C 等按钮行
│   │   │   └── SessionList.tsx   # 多 session 切换
│   │   └── hooks/
│   │       └── useTerminalWS.ts  # WebSocket + resize observer
└── nginx/
    └── nginx.conf            # 反向代理 + WebSocket upgrade
```

---

### docker-compose.yml 骨架

```yaml
services:
  backend:
    build: ./backend
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - workspaces:/workspaces
    environment:
      - DATABASE_URL=postgresql://postgres:pass@db:5432/acc
    depends_on: [db]

  frontend:
    build: ./frontend
    # nginx 在容器内同时 serve 静态文件 + 反代 backend

  db:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data

  nginx:
    image: nginx:alpine
    ports:
      - "57681:80"   # 保持你现有端口，Tailscale 不用改
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf

volumes:
  pgdata:
  workspaces:
```

---

### 移动端体验的核心改进

xterm.js 的关键配置：

```typescript
// 阻止浏览器默认键盘行为
terminal.attachCustomKeyEventHandler((e) => {
  // Ctrl+W, Ctrl+T 等浏览器快捷键全部吃掉
  if (e.ctrlKey && ['w','t','l','r','n'].includes(e.key.toLowerCase())) {
    e.preventDefault();
    return false;
  }
  return true;
});

// MobileToolbar 虚拟按键
const MOBILE_KEYS = [
  { label: 'Esc',    sequence: '\x1b' },
  { label: 'Tab',    sequence: '\t' },
  { label: 'Ctrl+C', sequence: '\x03' },
  { label: '↑',      sequence: '\x1b[A' },
  { label: '↓',      sequence: '\x1b[B' },
  { label: 'Ctrl+R', sequence: '\x12' },
];
```

---

### 长远演进路径

|阶段|功能|技术|
|---|---|---|
|v1|PTY WebSocket Terminal + PWA|node-pty + xterm.js|
|v2|IM Bridge (Telegram/Slack)|Bot webhook → IM Dispatcher → PTY session|
|v2|多 Agent 管理|一个 Agent = 一个有状态的 PTY session + 配置|
|v3|Skill Registry|Prompt 模板管理，Agent 启动参数化|
|v3|Agent 间通信|PG 事件表 + Fastify SSE 做轻量消息总线|

**一个需要纠正的地方**：你说的"像管理公司/军队"，本质上是 **多 Agent 并发 + 任务分派**。这层不要急着引入 LangGraph 或 AutoGen 这类重框架，用 PG 存 task + Fastify 调度足够，保持可控。等真正遇到瓶颈再换。

整个系统除了 Claude Code 镜像本身，其余部分代码量 v1 大约在 1500-2000 行 TypeScript，一周可以跑起来。要不要我先展开 `PTY Manager` 或 `Terminal.tsx` 的具体实现？