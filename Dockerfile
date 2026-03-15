FROM cc:latest

USER root

# 安装 node-pty 编译依赖（Debian/Ubuntu apt）和 tmux
# cc:latest 已有 node 20，保留 python3/make/g++ 供 node-gyp 编译 native addon
RUN apt-get update && apt-get install -y --no-install-recommends \
    tmux \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 安装后端依赖（含 node-pty native addon 编译）
COPY package.json ./
RUN npm install

# 前端构建产物（宿主机先 npm run build 生成）
COPY frontend/dist ./frontend/dist

# 服务器代码
COPY server.js ./
COPY public ./public
COPY start-container.sh nexus-run-claude.sh ./
RUN chmod +x start-container.sh nexus-run-claude.sh

# 持久化数据目录（toolbar 配置等存此处，通过 volume 挂载）
RUN mkdir -p /app/data/configs && chown -R claude:claude /app

ENV NODE_ENV=production
EXPOSE 3000

# 以 claude 用户运行，保证 tmux 会话里 claude CLI 的 PATH 和配置正确
USER claude

# cc:latest 的 ENTRYPOINT 是 ["claude"]，必须覆盖
ENTRYPOINT ["/app/start-container.sh"]
