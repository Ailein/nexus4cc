// server.js — Nexus WebSocket tmux 桥接服务
import express from 'express';
import { WebSocketServer } from 'ws';
import * as pty from 'node-pty';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { createServer } from 'node:http';
import { exec, spawn, execSync, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, normalize, isAbsolute, basename } from 'path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync, rmdirSync, renameSync, cpSync, rmSync } from 'fs';
import { readdir, stat as statAsync } from 'fs/promises';
import https from 'node:https';
import multer from 'multer';

// 加载 .env 文件（如果存在）
try {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), '.env');
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
} catch { /* .env 不存在时忽略 */ }

const __dirname = dirname(fileURLToPath(import.meta.url));

// 持久化数据目录（通过 Docker volume 挂载，重建容器不丢失）
const DATA_DIR = join(__dirname, 'data');
const TOOLBAR_CONFIG_FILE = join(DATA_DIR, 'toolbar-config.json');
const CONFIGS_DIR = join(DATA_DIR, 'configs');
const TASKS_FILE = join(DATA_DIR, 'tasks.json');
const SNAPSHOT_FILE = join(DATA_DIR, 'sessions-snapshot.json');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(CONFIGS_DIR)) mkdirSync(CONFIGS_DIR, { recursive: true });

// 自动确保 anthropic.json 存在（无需用户手动创建）
// 优先级：已有文件不覆盖；API_KEY 从环境变量 ANTHROPIC_API_KEY 检测
{
  const anthropicProfile = join(CONFIGS_DIR, 'anthropic.json');
  if (!existsSync(anthropicProfile)) {
    // 检测本地 CC 是否已 login（~/.claude.json 有 oauthAccount）
    let isLoggedIn = false;
    try {
      const claudeJson = JSON.parse(readFileSync(join(process.env.HOME || '~', '.claude.json'), 'utf8'));
      isLoggedIn = !!(claudeJson.oauthAccount?.accountUuid);
    } catch { /* 未登录或文件不存在 */ }

    const apiKey = process.env.ANTHROPIC_API_KEY || '';

    if (isLoggedIn || apiKey) {
      writeFileSync(anthropicProfile, JSON.stringify({
        label: 'Anthropic Claude',
        BASE_URL: '',
        AUTH_TOKEN: '',
        API_KEY: apiKey,
        DEFAULT_MODEL: 'claude-sonnet-4-6',
        THINK_MODEL: 'claude-opus-4-6',
        LONG_CONTEXT_MODEL: 'claude-opus-4-6',
        DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5-20251001',
        API_TIMEOUT_MS: '3000000',
      }, null, 2), 'utf8');
      console.log(`[Nexus] Auto-created anthropic profile (${isLoggedIn ? 'oauth login' : 'API key from env'})`);
    }
  }
}

const app = express();
app.use(express.json());

const {
  JWT_SECRET,
  ACC_PASSWORD_HASH,
  TMUX_SESSION = '~',
  WORKSPACE_ROOT = '/workspace',
  PORT = '3000',
  CLAUDE_PROXY = '',
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_WEBHOOK_SECRET,
  TELEGRAM_DEFAULT_SESSION = '',
  GITHUB_REPO = 'librae8226/nexus4cc',
} = process.env;

if (!JWT_SECRET || !ACC_PASSWORD_HASH) {
  console.error('ERROR: JWT_SECRET and ACC_PASSWORD_HASH must be set in environment');
  process.exit(1);
}

function commandExists(cmd) {
  try {
    execSync(`command -v ${cmd} >/dev/null 2>&1`);
    return true;
  } catch {
    return false;
  }
}

const INTERACTIVE_SHELL = commandExists('zsh') ? 'zsh' : 'bash';
const INTERACTIVE_SHELL_CMD = `exec ${INTERACTIVE_SHELL} -i`;

function buildInteractiveShellCmd(prefix = '') {
  return `${prefix}${INTERACTIVE_SHELL_CMD}`;
}

// 静态文件：frontend/dist 和 public
app.use(express.static(join(__dirname, 'public')));
app.use(express.static(join(__dirname, 'frontend', 'dist')));

// Auth middleware
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
}

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'password required' });
  try {
    const ok = await bcrypt.compare(password, ACC_PASSWORD_HASH);
    if (!ok) return res.status(401).json({ error: 'unauthorized' });
    const token = jwt.sign({}, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'internal error' });
  }
});

// POST /api/windows — F-19: 项目-窗口两级结构
// body: { rel_path?, shell_type?, profile? }
// - 提供 rel_path: 设置 NEXUS_CWD 并在此目录创建窗口（新项目）
// - 不提供 rel_path: 读取 NEXUS_CWD 并在此目录创建窗口（新窗口）
app.post('/api/windows', authMiddleware, (req, res) => {
  const { rel_path, shell_type = 'claude', profile } = req.body || {};
  const tmuxSession = req.query.session || TMUX_SESSION;

  let cwd;
  if (rel_path) {
    // 新项目：设置 NEXUS_CWD
    cwd = rel_path.startsWith('/') ? rel_path : `${WORKSPACE_ROOT}/${rel_path}`;
    try {
      execSync(`tmux set-environment -t ${tmuxSession} NEXUS_CWD "${cwd}"`);
    } catch (err) {
      return res.status(500).json({ error: 'failed to set NEXUS_CWD: ' + err.message });
    }
  } else {
    // 新窗口：读取 NEXUS_CWD
    try {
      const envOutput = execSync(`tmux show-environment -t ${tmuxSession} NEXUS_CWD 2>/dev/null`).toString().trim();
      const match = envOutput.match(/^NEXUS_CWD=(.+)$/);
      cwd = match ? match[1] : WORKSPACE_ROOT;
    } catch {
      cwd = WORKSPACE_ROOT;
    }
  }

  // 窗口名称基于目录
  const name = cwd.replace(/^\/+|\/+$/g, '').replace(/\//g, '-') || 'window';

  // 构建 shell 命令
  const proxyVars = {
    ...(process.env.HTTP_PROXY  ? { HTTP_PROXY:  process.env.HTTP_PROXY  } : {}),
    ...(process.env.HTTPS_PROXY ? { HTTPS_PROXY: process.env.HTTPS_PROXY } : {}),
    ...(process.env.ALL_PROXY   ? { ALL_PROXY:   process.env.ALL_PROXY   } : {}),
    ...(process.env.http_proxy  ? { http_proxy:  process.env.http_proxy  } : {}),
    ...(process.env.https_proxy ? { https_proxy: process.env.https_proxy } : {}),
    ...(CLAUDE_PROXY ? { ALL_PROXY: CLAUDE_PROXY, HTTPS_PROXY: CLAUDE_PROXY, HTTP_PROXY: CLAUDE_PROXY, NEXUS_PROXY: CLAUDE_PROXY } : {}),
  };
  const proxyExports = Object.entries(proxyVars).map(([k, v]) => `export ${k}='${v}'`).join('; ');
  const proxyPrefix = proxyExports ? `${proxyExports}; ` : '';

  let shellCmd;
  if (shell_type === 'bash') {
    shellCmd = buildInteractiveShellCmd(proxyPrefix);
  } else {
    if (profile) {
      const runScript = join(__dirname, 'nexus-run-claude.sh');
      shellCmd = `${proxyPrefix}bash "${runScript}" ${profile} ${cwd}`;
    } else {
      shellCmd = `${proxyPrefix}claude --dangerously-skip-permissions; ${INTERACTIVE_SHELL_CMD}`;
    }
  }

  // 确保 tmux session 存在
  try {
    execSync(`tmux has-session -t ${tmuxSession} 2>/dev/null || tmux new-session -d -s ${tmuxSession} -n shell "${INTERACTIVE_SHELL}"`);
  } catch {}

  // 将代理变量设置到 tmux session 环境
  for (const [key, value] of Object.entries(proxyVars)) {
    try {
      execSync(`tmux set-environment -t ${tmuxSession} ${key} "${value}" 2>/dev/null`);
    } catch {}
  }

  const cmd = `tmux new-window -t ${tmuxSession} -c "${cwd}" -n "${name}" "${shellCmd}"`;
  exec(cmd, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ name, cwd, shell_type, profile: profile || null, session: tmuxSession });
  });
});

// POST /api/sessions — 在 tmux 中创建新 window
// body: { rel_path, shell_type?, profile?, session? }
//   shell_type: 'claude' | 'bash' (default: 'claude')
//   当 shell_type='claude' 时，profile 可选，使用 nexus-run-claude.sh 启动
//   当 shell_type='bash' 时，启动本地 shell（优先 zsh，不存在时回退 bash）
app.post('/api/sessions', authMiddleware, (req, res) => {
  const { rel_path, shell_type = 'claude', profile, session } = req.body || {};
  const tmuxSession = session || TMUX_SESSION;
  if (!rel_path) return res.status(400).json({ error: 'rel_path required' });
  const cwd = rel_path.startsWith('/') ? rel_path : `${WORKSPACE_ROOT}/${rel_path}`;
  const name = cwd.replace(/^\/+|\/+$/g, '').replace(/\//g, '-') || 'session';

  // 收集代理变量（宿主机环境 + CLAUDE_PROXY 覆盖）
  const proxyVars = {
    ...(process.env.HTTP_PROXY  ? { HTTP_PROXY:  process.env.HTTP_PROXY  } : {}),
    ...(process.env.HTTPS_PROXY ? { HTTPS_PROXY: process.env.HTTPS_PROXY } : {}),
    ...(process.env.ALL_PROXY   ? { ALL_PROXY:   process.env.ALL_PROXY   } : {}),
    ...(process.env.http_proxy  ? { http_proxy:  process.env.http_proxy  } : {}),
    ...(process.env.https_proxy ? { https_proxy: process.env.https_proxy } : {}),
    ...(CLAUDE_PROXY ? { ALL_PROXY: CLAUDE_PROXY, HTTPS_PROXY: CLAUDE_PROXY, HTTP_PROXY: CLAUDE_PROXY, NEXUS_PROXY: CLAUDE_PROXY } : {}),
  };

  const proxyExports = Object.entries(proxyVars).map(([k, v]) => `export ${k}='${v}'`).join('; ');
  const proxyPrefix = proxyExports ? `${proxyExports}; ` : '';

  let shellCmd;
  if (shell_type === 'bash') {
    shellCmd = buildInteractiveShellCmd(proxyPrefix);
  } else {
    if (profile) {
      const runScript = join(__dirname, 'nexus-run-claude.sh');
      shellCmd = `${proxyPrefix}bash "${runScript}" ${profile} ${cwd}`;
    } else {
      shellCmd = `${proxyPrefix}claude --dangerously-skip-permissions; ${INTERACTIVE_SHELL_CMD}`;
    }
  }

  // 确保 tmux session 存在
  try {
    execSync(`tmux has-session -t ${tmuxSession} 2>/dev/null || tmux new-session -d -s ${tmuxSession} -n shell "${INTERACTIVE_SHELL}"`);
  } catch {}

  // 将代理变量设置到 tmux session 环境，新窗口才能继承
  for (const [key, value] of Object.entries(proxyVars)) {
    try {
      execSync(`tmux set-environment -t ${tmuxSession} ${key} "${value}" 2>/dev/null`);
    } catch {}
  }

  const cmd = `tmux new-window -t ${tmuxSession} -c "${cwd}" -n "${name}" "${shellCmd}"`;
  exec(cmd, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ name, cwd, shell_type, profile: profile || null, session: tmuxSession });
  });
});

// GET /api/configs — 列出所有 claude 配置 profile
app.get('/api/configs', authMiddleware, (req, res) => {
  try {
    const files = readdirSync(CONFIGS_DIR, { withFileTypes: true })
      .filter(f => f.isFile() && f.name.endsWith('.json'))
      .map(f => ({
        name: f.name,
        mtime: statSync(join(CONFIGS_DIR, f.name)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime)
      .map(f => f.name);
    const configs = files.map(f => {
      const id = f.replace('.json', '');
      try {
        const data = JSON.parse(readFileSync(join(CONFIGS_DIR, f), 'utf8'));
        return { id, label: data.label || id, ...data };
      } catch {
        return { id, label: id };
      }
    });
    res.json(configs);
  } catch {
    res.json([]);
  }
});

// POST /api/configs/:id — 创建或更新配置 profile
app.post('/api/configs/:id', authMiddleware, (req, res) => {
  const id = req.params.id.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  if (!id) return res.status(400).json({ error: 'invalid id' });
  try {
    writeFileSync(join(CONFIGS_DIR, `${id}.json`), JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/configs/:id — 删除配置 profile
app.delete('/api/configs/:id', authMiddleware, (req, res) => {
  const file = join(CONFIGS_DIR, `${req.params.id}.json`);
  try {
    if (existsSync(file)) unlinkSync(file);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/toolbar-config — 读取工具栏配置
app.get('/api/toolbar-config', authMiddleware, (req, res) => {
  try {
    if (!existsSync(TOOLBAR_CONFIG_FILE)) return res.json(null);
    const data = readFileSync(TOOLBAR_CONFIG_FILE, 'utf8');
    res.json(JSON.parse(data));
  } catch {
    res.json(null);
  }
});

// POST /api/toolbar-config — 保存工具栏配置
app.post('/api/toolbar-config', authMiddleware, (req, res) => {
  try {
    writeFileSync(TOOLBAR_CONFIG_FILE, JSON.stringify(req.body), 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/version — 当前版本号及工作区状态
app.get('/api/version', authMiddleware, (req, res) => {
  try {
    const current = execSync('git describe --tags --abbrev=0', { cwd: __dirname }).toString().trim();
    const dirty = execSync('git status --porcelain', { cwd: __dirname }).toString().trim();
    res.json({ current, clean: dirty === '' });
  } catch {
    res.json({ current: 'unknown', clean: true });
  }
});

// GET /api/version/latest — 代理 GitHub Tags API 获取最新版本（兼容只有 tag 没有 Release 的 repo）
app.get('/api/version/latest', authMiddleware, (req, res) => {
  const options = {
    hostname: 'api.github.com',
    path: `/repos/${GITHUB_REPO}/tags`,
    headers: { 'User-Agent': 'nexus-update-check' },
  };
  https.get(options, (ghRes) => {
    let data = '';
    ghRes.on('data', chunk => { data += chunk; });
    ghRes.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (!Array.isArray(json) || json.length === 0) return res.status(502).json({ error: 'no tags found' });
        const latest = json[0].name;
        res.json({ latest, url: `https://github.com/${GITHUB_REPO}/releases/tag/${latest}` });
      } catch {
        res.status(502).json({ error: 'invalid response from GitHub' });
      }
    });
  }).on('error', () => {
    res.status(502).json({ error: 'cannot reach GitHub' });
  });
});

app.get('/api/browse', authMiddleware, (req, res) => {
  try {
    let p = req.query.path || WORKSPACE_ROOT
    if (p === '~') p = WORKSPACE_ROOT
    if (!isAbsolute(p)) p = join(WORKSPACE_ROOT, p)
    p = normalize(p)
    const entries = readdirSync(p, { withFileTypes: true })
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: join(p, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const parent = dirname(p) !== p ? dirname(p) : null
    res.json({ path: p, parent, dirs })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/workspace/files — 浏览文件系统（支持文件和目录，任意路径）
app.get('/api/workspace/files', authMiddleware, async (req, res) => {
  try {
    let p = req.query.path || WORKSPACE_ROOT
    if (p === '~') p = WORKSPACE_ROOT
    if (!isAbsolute(p)) p = join(WORKSPACE_ROOT, p)
    p = normalize(p)
    const dirents = await readdir(p, { withFileTypes: true })
    const visible = dirents.filter(e => !e.name.startsWith('.'))
    const entries = await Promise.all(visible.map(async e => {
      const fullPath = join(p, e.name)
      const st = await statAsync(fullPath)
      return {
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        size: e.isFile() ? st.size : undefined,
        mtime: st.mtimeMs,
      }
    }))
    res.json({ path: p, entries })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 静态文件服务：工作目录文件直接访问（/workspace/相对路径）
// 支持 header 或 query string 传递 token（浏览器直接打开时用 query string）
// 支持通过 ?path=/absolute/path 访问任意路径（仍然限制在 workspaceRoot 内）
app.use('/workspace', (req, res, next) => {
  // 尝试从 query string 获取 token
  const token = req.query.token
  if (token) {
    try {
      jwt.verify(token, JWT_SECRET)
      return next()
    } catch {
      return res.status(401).send('unauthorized')
    }
  }
  // 否则使用 header auth
  return authMiddleware(req, res, next)
}, (req, res) => {
  try {
    let fullPath
    // 如果提供了 path 参数，使用它（绝对路径）
    if (req.query.path) {
      fullPath = normalize(decodeURIComponent(req.query.path))
    } else {
      // 否则使用相对路径（基于 WORKSPACE_ROOT）
      let relPath = decodeURIComponent(req.path)
      relPath = normalize(relPath).replace(/^(\.\.(\/|\|$))+/, '')
      fullPath = join(WORKSPACE_ROOT, relPath)
    }
    // 安全检查：防止路径遍历攻击（规范化后检查是否包含 ..）
    if (fullPath.includes('..')) {
      return res.status(403).send('access denied: invalid path')
    }
    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
      return res.status(404).send('not found')
    }
    if (req.query.dl === '1') {
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(basename(fullPath))}`)
    }
    res.sendFile(fullPath)
  } catch (err) {
    res.status(500).send(err.message)
  }
})

// POST /api/workspace/mkdir — 创建文件夹
app.post('/api/workspace/mkdir', authMiddleware, (req, res) => {
  try {
    let { path: targetPath, name } = req.body
    if (!name) return res.status(400).json({ error: 'name required' })
    if (!isAbsolute(targetPath)) targetPath = join(WORKSPACE_ROOT, targetPath)
    targetPath = normalize(targetPath)
    const dirPath = join(targetPath, name)
    if (dirPath.includes('..')) {
      return res.status(403).json({ error: 'invalid path' })
    }
    if (existsSync(dirPath)) {
      return res.status(409).json({ error: 'already exists' })
    }
    mkdirSync(dirPath, { recursive: true })
    res.json({ ok: true, path: dirPath })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/workspace/files — 创建新文件
app.post('/api/workspace/files', authMiddleware, (req, res) => {
  try {
    let { path: targetPath, name, content = '' } = req.body
    if (!name) return res.status(400).json({ error: 'name required' })
    if (!isAbsolute(targetPath)) targetPath = join(WORKSPACE_ROOT, targetPath)
    targetPath = normalize(targetPath)
    const filePath = join(targetPath, name)
    if (filePath.includes('..')) {
      return res.status(403).json({ error: 'invalid path' })
    }
    if (existsSync(filePath)) {
      return res.status(409).json({ error: 'already exists' })
    }
    writeFileSync(filePath, content, 'utf8')
    res.json({ ok: true, path: filePath })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/workspace/file — 读取文件内容
app.get('/api/workspace/file', authMiddleware, (req, res) => {
  try {
    let p = req.query.path || ''
    if (!isAbsolute(p)) p = join(WORKSPACE_ROOT, p)
    p = normalize(p)
    if (p.includes('..')) {
      return res.status(403).json({ error: 'invalid path' })
    }
    if (!existsSync(p) || !statSync(p).isFile()) {
      return res.status(404).json({ error: 'not found' })
    }
    const content = readFileSync(p, 'utf8')
    res.json({ path: p, content })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/workspace/file — 保存文件内容
app.put('/api/workspace/file', authMiddleware, (req, res) => {
  try {
    let { path: filePath, content = '' } = req.body
    if (!filePath) return res.status(400).json({ error: 'path required' })
    if (!isAbsolute(filePath)) filePath = join(WORKSPACE_ROOT, filePath)
    filePath = normalize(filePath)
    if (filePath.includes('..')) {
      return res.status(403).json({ error: 'invalid path' })
    }
    writeFileSync(filePath, content, 'utf8')
    res.json({ ok: true, path: filePath })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/workspace/entry — 删除文件或目录
app.delete('/api/workspace/entry', authMiddleware, (req, res) => {
  try {
    let p = req.body?.path || req.query?.path || ''
    if (!p) return res.status(400).json({ error: 'path required' })
    if (!isAbsolute(p)) p = join(WORKSPACE_ROOT, p)
    p = normalize(p)
    if (p.includes('..')) {
      return res.status(403).json({ error: 'invalid path' })
    }
    if (!existsSync(p)) {
      return res.status(404).json({ error: 'not found' })
    }
    rmSync(p, { recursive: true, force: true })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/workspace/rename — 重命名文件或目录
app.post('/api/workspace/rename', authMiddleware, (req, res) => {
  try {
    let { path: srcPath, newName } = req.body || {}
    if (!srcPath || !newName) return res.status(400).json({ error: 'path and newName required' })
    if (!isAbsolute(srcPath)) srcPath = join(WORKSPACE_ROOT, srcPath)
    srcPath = normalize(srcPath)
    if (srcPath.includes('..')) {
      return res.status(403).json({ error: 'invalid path' })
    }
    if (!existsSync(srcPath)) {
      return res.status(404).json({ error: 'not found' })
    }
    const destPath = normalize(join(dirname(srcPath), newName))
    if (destPath.includes('..')) {
      return res.status(403).json({ error: 'invalid newName' })
    }
    if (existsSync(destPath)) {
      return res.status(409).json({ error: 'already exists' })
    }
    renameSync(srcPath, destPath)
    res.json({ ok: true, path: destPath })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/workspace/copy — 复制文件或目录
app.post('/api/workspace/copy', authMiddleware, (req, res) => {
  try {
    let { sourcePath, targetPath } = req.body || {}
    if (!sourcePath || !targetPath) return res.status(400).json({ error: 'sourcePath and targetPath required' })
    if (!isAbsolute(sourcePath)) sourcePath = join(WORKSPACE_ROOT, sourcePath)
    if (!isAbsolute(targetPath)) targetPath = join(WORKSPACE_ROOT, targetPath)
    sourcePath = normalize(sourcePath)
    targetPath = normalize(targetPath)
    if (sourcePath.includes('..') || targetPath.includes('..')) {
      return res.status(403).json({ error: 'invalid path' })
    }
    if (!existsSync(sourcePath)) {
      return res.status(404).json({ error: 'source not found' })
    }
    if (existsSync(targetPath)) {
      return res.status(409).json({ error: 'target already exists' })
    }
    cpSync(sourcePath, targetPath, { recursive: true })
    res.json({ ok: true, path: targetPath })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/workspace/move — 移动文件或目录
app.post('/api/workspace/move', authMiddleware, (req, res) => {
  try {
    let { sourcePath, targetPath } = req.body || {}
    if (!sourcePath || !targetPath) return res.status(400).json({ error: 'sourcePath and targetPath required' })
    if (!isAbsolute(sourcePath)) sourcePath = join(WORKSPACE_ROOT, sourcePath)
    if (!isAbsolute(targetPath)) targetPath = join(WORKSPACE_ROOT, targetPath)
    sourcePath = normalize(sourcePath)
    targetPath = normalize(targetPath)
    if (sourcePath.includes('..') || targetPath.includes('..')) {
      return res.status(403).json({ error: 'invalid path' })
    }
    if (!existsSync(sourcePath)) {
      return res.status(404).json({ error: 'source not found' })
    }
    if (existsSync(targetPath)) {
      return res.status(409).json({ error: 'target already exists' })
    }
    try {
      renameSync(sourcePath, targetPath)
    } catch (err) {
      if (err.code === 'EXDEV') {
        cpSync(sourcePath, targetPath, { recursive: true })
        rmSync(sourcePath, { recursive: true, force: true })
      } else {
        throw err
      }
    }
    res.json({ ok: true, path: targetPath })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/upload — 上传文件到指定 session 的 cwd（F-14）
// body: multipart/form-data, fields: file, session_name (optional)
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      // 找到目标 session 的 cwd，否则存 WORKSPACE_ROOT
      let cwd = WORKSPACE_ROOT
      try {
        const sessionName = req.body?.session_name || ''
        const windows = execSync(`tmux list-windows -t ${TMUX_SESSION} -F "#I:#W:#{pane_current_path}"`).toString().trim().split('\n')
        for (const line of windows) {
          const parts = line.split(':')
          const name = parts[1]
          const path = parts.slice(2).join(':')
          if (sessionName && name === sessionName) { cwd = path; break }
          // 如果没指定 session，用 active window
          if (!sessionName) {
            const activeLines = execSync(`tmux list-windows -t ${TMUX_SESSION} -F "#I:#W:#{pane_current_path}:#{window_active}"`).toString().trim().split('\n')
            for (const al of activeLines) {
              const ap = al.split(':')
              if (ap[ap.length - 1]?.trim() === '1') { cwd = ap.slice(2, ap.length - 1).join(':'); break }
            }
            break
          }
        }
      } catch {}
      if (!existsSync(cwd)) cwd = WORKSPACE_ROOT
      cb(null, cwd)
    },
    filename: (req, file, cb) => {
      // 保留原始文件名，避免冲突加时间戳前缀
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')
      cb(null, safe)
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
})

app.post('/api/upload', authMiddleware, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file) return res.status(400).json({ error: 'no file' })
    const filePath = req.file.path
    res.json({ ok: true, path: filePath, filename: req.file.filename, size: req.file.size })
  })
})

// ---- F-21: 文件上传 API（上传到当前 workspace 的 data/uploads/）----

// 读取指定 session 的 uploads 目录（基于 tmux NEXUS_CWD 环境变量）
function getWorkspaceUploadsDir(session = TMUX_SESSION) {
  let cwd = WORKSPACE_ROOT
  try {
    const out = execSync(`tmux show-environment -t ${session} NEXUS_CWD 2>/dev/null`).toString().trim()
    const m = out.match(/^NEXUS_CWD=(.+)$/)
    if (m) cwd = m[1]
  } catch {}
  return join(cwd, 'data', 'uploads')
}

const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
})

// POST /api/files/upload — 上传文件到当前 workspace/data/uploads/日期/
// Query: overwrite=1 强制覆盖已存在的文件
app.post('/api/files/upload', authMiddleware, (req, res, next) => {
  fileUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file) return res.status(400).json({ error: 'no file' })

    const dateDir = new Date().toISOString().slice(0, 10)
    const uploadsDir = getWorkspaceUploadsDir(req.query.session || TMUX_SESSION)
    const uploadDir = join(uploadsDir, dateDir)
    if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true })

    // 使用前端传递的原始文件名（避免 multer 解析编码问题）
    const originalName = req.body.originalName || req.file.originalname
    // 清理文件名：只保留合法字符，中文保留
    const safe = originalName.replace(/[<>:"|?*\\/\x00-\x1f]/g, '_')
    const filePath = join(uploadDir, safe)
    const overwrite = req.query.overwrite === '1'

    // 检查文件是否已存在
    if (!overwrite && existsSync(filePath)) {
      return res.status(409).json({
        error: 'file exists',
        filename: safe,
        message: `文件 "${safe}" 已存在`
      })
    }

    // 写入文件
    try {
      writeFileSync(filePath, req.file.buffer)
      const url = `/api/files/content?path=${encodeURIComponent(filePath)}`
      const responseData = {
        ok: true,
        filename: safe,
        url,
        fullPath: filePath,
        size: req.file.size,
        originalName: originalName
      }
      console.log('[Upload]', safe, '→', filePath)
      res.json(responseData)
    } catch (writeErr) {
      res.status(500).json({ error: writeErr.message })
    }
  })
})

// GET /api/files/content?path=... — 访问/下载已上传的文件（路径自描述，无状态）
app.get('/api/files/content', authMiddleware, (req, res) => {
  const filePath = req.query.path
  if (!filePath || typeof filePath !== 'string') return res.status(400).json({ error: 'path required' })
  const normalized = normalize(filePath)
  if (!normalized.startsWith(WORKSPACE_ROOT)) return res.status(403).json({ error: 'access denied' })
  if (!existsSync(normalized)) return res.status(404).json({ error: 'file not found' })
  res.sendFile(normalized)
})

// GET /api/files — 列出当前 workspace 上传的文件（按日期分组）
app.get('/api/files', authMiddleware, (req, res) => {
  try {
    const uploadsDir = getWorkspaceUploadsDir(req.query.session || TMUX_SESSION)
    const result = []
    if (!existsSync(uploadsDir)) return res.json(result)

    const dateDirs = readdirSync(uploadsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort((a, b) => b.localeCompare(a)) // 降序，最新的在前

    for (const dateDir of dateDirs) {
      const dirPath = join(uploadsDir, dateDir)
      const files = readdirSync(dirPath, { withFileTypes: true })
        .filter(e => e.isFile())
        .map(e => {
          const fullPath = join(dirPath, e.name)
          const stat = statSync(fullPath)
          return {
            name: e.name,
            url: `/api/files/content?path=${encodeURIComponent(fullPath)}`,
            fullPath,
            size: stat.size,
            created: stat.mtimeMs,
          }
        })
        .sort((a, b) => b.created - a.created)
      if (files.length > 0) {
        result.push({ date: dateDir, files })
      }
    }
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/files/all — 删除当前 workspace 所有上传的文件
app.delete('/api/files/all', authMiddleware, (req, res) => {
  try {
    const uploadsDir = getWorkspaceUploadsDir(req.query.session || TMUX_SESSION)
    if (!existsSync(uploadsDir)) return res.json({ ok: true, deletedCount: 0 })
    const dateDirs = readdirSync(uploadsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
    let deletedCount = 0
    for (const dateDir of dateDirs) {
      const dirPath = join(uploadsDir, dateDir.name)
      const files = readdirSync(dirPath, { withFileTypes: true })
        .filter(e => e.isFile())
      for (const file of files) {
        const filePath = join(dirPath, file.name)
        try {
          unlinkSync(filePath)
          deletedCount++
        } catch {}
      }
      // 尝试删除空目录
      try {
        rmdirSync(dirPath)
      } catch {}
    }
    res.json({ ok: true, deletedCount })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/files/content?path=... — 删除指定文件（路径自描述）
app.delete('/api/files/content', authMiddleware, (req, res) => {
  const filePath = req.query.path
  if (!filePath || typeof filePath !== 'string') return res.status(400).json({ error: 'path required' })
  const normalized = normalize(filePath)
  if (!normalized.startsWith(WORKSPACE_ROOT)) return res.status(403).json({ error: 'access denied' })
  try {
    if (existsSync(normalized)) {
      unlinkSync(normalized)
      res.json({ ok: true })
    } else {
      res.status(404).json({ error: 'file not found' })
    }
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/sessions/:id/rename — 重命名窗口
app.post('/api/sessions/:id/rename', authMiddleware, (req, res) => {
  const index = req.params.id
  const session = req.query.session || TMUX_SESSION
  const { name } = req.body || {}
  if (!name) return res.status(400).json({ error: 'name required' })
  // window 名允许 Unicode（中日韩等），仅过滤控制字符和 tmux target separator ':'
  // 之前的 /[^a-zA-Z0-9._-]/→'-' 会把中文全部变成 '-'，导致"我的频道" → "----"
  const safeName = String(name).replace(/[\r\n\t\0:]/g, '').trim().slice(0, 50)
  if (!safeName) return res.status(400).json({ error: 'name required' })
  try {
    execFileSync('tmux', ['rename-window', '-t', `${session}:${index}`, '--', safeName], { stdio: 'pipe' })
    try { renameWindowInSnapshot(session, index, safeName) } catch {}
    res.json({ ok: true, name: safeName })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/sessions/:id/output — 获取窗口最后输出（F-15 状态卡片）
app.get('/api/sessions/:id/output', authMiddleware, (req, res) => {
  const windowIndex = parseInt(req.params.id, 10);
  const session = req.query.session || TMUX_SESSION;
  const entry = ptyMap.get(ptyKey(session, windowIndex));
  if (!entry) return res.json({ connected: false, output: '', clients: 0 });
  res.json({
    connected: true,
    output: entry.lastOutput.slice(-2000), // 最后 2KB
    clients: entry.clients.size,
    idleMs: Date.now() - entry.lastActivity,
  });
});

// GET /api/sessions/:id/scrollback — fetch tmux scrollback history (works in alternate screen too)
// Query: lines (per-page, default 3000, max 10000), offset (skip most-recent N lines, default 0)
// offset=0 返回末尾 lines 行；offset=N 返回倒数 N+1..N+lines 行，配合前端分页加载
app.get('/api/sessions/:id/scrollback', authMiddleware, (req, res) => {
  const windowIndex = parseInt(req.params.id, 10)
  const session = req.query.session || TMUX_SESSION
  const lines = Math.min(parseInt(req.query.lines || '3000', 10), 10000)
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0)
  const target = `${session}:${windowIndex}`

  // tmux capture-pane 的 -S/-E 接受负数（从底往上数，-1 是最后一行）
  // offset=0 → -S -lines              (末尾 lines 行)
  // offset>0 → -S -(offset+lines) -E -(offset+1)  (倒数 offset+1..offset+lines)
  const startArg = `-${offset + lines}`
  const endArgs = offset > 0 ? ['-E', `-${offset + 1}`] : []

  exec(`tmux display -p -t ${target} '#{pane_height}' 2>/dev/null`, (err, phOut) => {
    const paneHeight = parseInt(phOut?.trim(), 10) || 50
    const captureCmd = `tmux capture-pane -e -p -S ${startArg} ${endArgs.join(' ')} -t ${target} 2>/dev/null`
    exec(captureCmd, { maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
      if (err) return res.status(500).json({ error: err.message })
      const rawLines = stdout.split('\n').map(l => l.trimEnd())
      // 去掉末尾可能因 tmux 输出残留的空行（capture-pane 每次都追加一个 \n）
      while (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop()
      const content = dedupScrollback(rawLines, paneHeight).map(trimGhostResidue).join('\n')
      // hasMore 判断：若本次拿到的原始行数 < 请求的 lines，说明 tmux buffer 已到顶
      const hasMore = rawLines.length >= lines
      res.json({ content, offset, lines, hasMore })
    })
  })
})

// GET /api/sessions/:id/history — 读取该 tmux window 对应的 claude 会话 jsonl，
// 返回结构化消息数组（聊天视图）。流程：
//   1) tmux display -p 拿 pane_current_path → cwd
//   2) inferClaudeSessionId(cwd) 找最新 jsonl
//   3) parseClaudeSessionJsonl 抽 user/assistant 消息
// 若 window 无 cwd 或无 jsonl，返回 kind='none'，前端 fallback 到 terminal mode。
app.get('/api/sessions/:id/history', authMiddleware, (req, res) => {
  const windowIndex = parseInt(req.params.id, 10)
  const session = req.query.session || TMUX_SESSION
  const target = `${session}:${windowIndex}`

  exec(`tmux display-message -t ${target} -p '#{pane_current_path}' 2>/dev/null`, (err, stdout) => {
    const cwd = (stdout || '').trim()
    if (!cwd) return res.json({ kind: 'none', reason: 'no cwd' })

    const sessionId = inferClaudeSessionId(cwd)
    if (!sessionId) return res.json({ kind: 'none', reason: 'no session jsonl', cwd })

    const encoded = cwd.replace(/[^a-zA-Z0-9]/g, '-')
    const jsonlPath = join(process.env.HOME || '', '.claude', 'projects', encoded, `${sessionId}.jsonl`)
    if (!existsSync(jsonlPath)) return res.json({ kind: 'none', reason: 'jsonl missing', cwd, sessionId })

    // 附带返回 shell_type（来自 snapshot），前端用它决定默认 mode
    let shellType = null
    try {
      const snap = loadSnapshot()
      const sess = snap.sessions.find(s => s.name === session)
      const win = sess?.windows?.find(w => Number(w.index) === windowIndex)
      shellType = win?.shell_type || null
    } catch { /* ignore */ }

    try {
      const messages = parseClaudeSessionJsonl(jsonlPath)
      res.json({ kind: 'claude', sessionId, cwd, shellType, messages })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })
})

// 解析 claude session jsonl，只保留 user / assistant 消息，抽成 { role, ts, items[] }。
// items 支持: text / thinking / tool_use / tool_result / image。
// 大字段（text/thinking/tool_result）超过 truncateLen 时截断并打 truncated 标记供前端提示。
function parseClaudeSessionJsonl(jsonlPath, { truncateLen = 4000 } = {}) {
  const messages = []
  const raw = readFileSync(jsonlPath, 'utf8')
  const fileLines = raw.split('\n')

  const truncate = (text) => {
    if (typeof text !== 'string') return { text: '', truncated: false, totalLen: 0 }
    if (text.length <= truncateLen) return { text, truncated: false, totalLen: text.length }
    return { text: text.slice(0, truncateLen), truncated: true, totalLen: text.length }
  }

  for (const line of fileLines) {
    if (!line) continue
    let d
    try { d = JSON.parse(line) } catch { continue }
    const type = d?.type
    if (type !== 'user' && type !== 'assistant') continue
    if (d.isSidechain) continue

    const ts = d.timestamp || null
    const role = type
    const items = []
    const msg = d.message || {}
    const rawContent = msg.content

    if (typeof rawContent === 'string') {
      if (rawContent) items.push({ kind: 'text', ...truncate(rawContent) })
    } else if (Array.isArray(rawContent)) {
      for (const c of rawContent) {
        const ct = c?.type
        if (ct === 'text') {
          if (c.text) items.push({ kind: 'text', ...truncate(c.text) })
        } else if (ct === 'thinking') {
          if (c.thinking) items.push({ kind: 'thinking', ...truncate(c.thinking) })
        } else if (ct === 'tool_use') {
          items.push({
            kind: 'tool_use',
            name: c.name || '(unknown)',
            id: c.id || '',
            input: c.input ?? null,
          })
        } else if (ct === 'tool_result') {
          let text = ''
          const rc = c.content
          if (typeof rc === 'string') text = rc
          else if (Array.isArray(rc)) {
            text = rc.map(x => {
              if (typeof x === 'string') return x
              if (x?.type === 'text') return x.text || ''
              if (x?.type === 'image') return '[图片]'
              return ''
            }).join('\n')
          }
          items.push({
            kind: 'tool_result',
            toolUseId: c.tool_use_id || '',
            isError: !!c.is_error,
            ...truncate(text),
          })
        } else if (ct === 'image') {
          items.push({ kind: 'image' })
        }
        // 其他类型（视频、文档等）忽略
      }
    }

    if (items.length === 0) continue
    messages.push({ role, ts, items })
  }
  return messages
}

// Remove "ghost frame" duplicates from scrollback caused by full-screen app re-renders.
// Ghost frames are paneHeight-sized blocks pushed into scrollback when a full-screen app
// redraws without alternate screen. Detection is purely content-based: hash each line,
// compute rolling block fingerprints, and remove earlier duplicates. Zero hardcoded patterns.
function dedupScrollback(lines, paneHeight) {
  if (lines.length <= paneHeight * 2) return lines

  const stripAnsi = s => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
  const scrollbackEnd = lines.length - paneHeight

  // Hash each line (stripped of ANSI), using djb2
  const lineHashes = new Int32Array(lines.length)
  for (let i = 0; i < lines.length; i++) {
    const s = stripAnsi(lines[i])
    let h = 5381
    for (let c = 0; c < s.length; c++) h = ((h << 5) + h + s.charCodeAt(c)) | 0
    lineHashes[i] = h
  }

  // Block fingerprint: XOR of weighted line hashes over paneHeight lines
  function blockFp(start) {
    let fp = 0
    for (let i = start; i < start + paneHeight && i < lines.length; i++) {
      fp = (fp * 31 + lineHashes[i]) | 0
    }
    return fp
  }

  // Build map: fingerprint → last seen position (we keep the latest occurrence)
  const seen = new Map()
  const dupes = []

  for (let i = 0; i <= scrollbackEnd - paneHeight; i += paneHeight) {
    const fp = blockFp(i)
    if (seen.has(fp)) {
      // Verify: sample 8 lines to rule out hash collision
      const prev = seen.get(fp)
      const step = Math.max(1, paneHeight >> 3)
      let match = true
      for (let s = 0; s < paneHeight; s += step) {
        if (lineHashes[prev + s] !== lineHashes[i + s]) { match = false; break }
      }
      if (match) dupes.push(prev)
    }
    seen.set(fp, i)
  }

  if (dupes.length === 0) return lines

  const keep = new Uint8Array(lines.length).fill(1)
  for (const start of dupes) {
    const end = Math.min(start + paneHeight, scrollbackEnd)
    for (let j = start; j < end; j++) keep[j] = 0
  }

  return lines.filter((_, idx) => keep[idx])
}

// 裁掉每行尾部的"鬼影残留"——TUI 重绘时未发 ESC[K 导致 tmux cell 里残留的旧字符。
// 触发条件：行末有 ≥4 段 (单非空白字符 + 1-3 空白) 重复模式（典型如 "f  c  r 8 t 3 )"）。
// 主体内容长度需 ≥10，避免误伤短行；保留前置 ANSI 颜色码并补一个 reset。
function trimGhostResidue(line) {
  const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g
  const stripped = line.replace(ANSI_RE, '').replace(/\s+$/, '')
  if (stripped.length < 20) return line

  // lookbehind 强制鬼影段前必须是空格或行首，避免吃掉合法内容的尾字符
  const m = /(?<=\s|^)(?:\S\s{1,3}){4,}\S?\s*$/.exec(stripped)
  if (!m) return line
  if (m.index < 10) return line

  // 把鬼影前的尾随空白一并剥掉
  let trimEnd = m.index
  while (trimEnd > 0 && /\s/.test(stripped[trimEnd - 1])) trimEnd--
  if (trimEnd === 0) return line  // 整行都是鬼影模式，保守不裁

  // 走原始 line（含 ANSI），保留 ANSI + 可见字符直到 trimEnd
  let keep = ''
  let strippedPos = 0
  let i = 0
  while (i < line.length && strippedPos < trimEnd) {
    ANSI_RE.lastIndex = i
    const am = ANSI_RE.exec(line)
    if (am && am.index === i) {
      keep += am[0]
      i += am[0].length
    } else {
      keep += line[i]
      strippedPos++
      i++
    }
  }
  return keep + '\x1b[0m'
}

// GET /api/config — 服务端配置信息（供前端初始化用）
app.get('/api/config', authMiddleware, (req, res) => {
  res.json({ tmuxSession: TMUX_SESSION, workspaceRoot: WORKSPACE_ROOT })
})

// GET /api/tmux-sessions — 列出所有 tmux session（F-18）
// GET /api/snapshot/status — 最近一次启动恢复的摘要（前端显示 toast）
app.get('/api/snapshot/status', authMiddleware, (req, res) => {
  const snap = loadSnapshot()
  res.json({
    lastRestore: lastRestoreSummary,
    totalSessions: snap.sessions.length,
    savedAt: snap.savedAt || null,
  })
})

app.get('/api/tmux-sessions', authMiddleware, (req, res) => {
  exec('tmux list-sessions -F "#{session_name}|#{session_windows}|#{session_attached}"', (err, stdout) => {
    if (err) return res.json([{ name: TMUX_SESSION, windows: 0, attached: false }])
    const sessions = stdout.trim().split('\n').filter(Boolean).map(line => {
      const [name, windows, attached] = line.split('|')
      return { name, windows: Number(windows), attached: Number(attached) > 0 }
    })
    res.json(sessions)
  })
})

// POST /api/launch-iterm — 在本机启动 iTerm2 并用 tmux -CC 集成模式接管指定 session
// 仅在 server 与 iTerm2 同机时有意义（macOS only）。
app.post('/api/launch-iterm', authMiddleware, (req, res) => {
  if (process.platform !== 'darwin') {
    return res.status(400).json({ error: 'launch-iterm requires macOS host' })
  }
  const session = req.body?.session
  if (!session || typeof session !== 'string') {
    return res.status(400).json({ error: 'session required' })
  }
  if (/["'\\`$]/.test(session)) {
    return res.status(400).json({ error: 'invalid session name' })
  }
  try {
    execSync(`tmux has-session -t '${session}' 2>/dev/null`)
  } catch {
    return res.status(404).json({ error: 'session not found' })
  }
  const appleScript = `on run argv
  set sess to item 1 of argv
  tell application "iTerm2"
    activate
    set newWin to (create window with default profile)
    tell current session of newWin
      write text "tmux -CC attach -t \\"" & sess & "\\""
    end tell
  end tell
end run`
  try {
    const proc = spawn('osascript', ['-', session], {
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    proc.stdin.write(appleScript)
    proc.stdin.end()
    proc.unref()
    return res.json({ ok: true, session })
  } catch (e) {
    return res.status(500).json({ error: String(e) })
  }
})

// ========== F-20: Project-Channel API ==========
// Project = tmux session, Channel = tmux window (within a session)

// GET /api/projects — 列出所有 Projects（tmux sessions）
app.get('/api/projects', authMiddleware, (req, res) => {
  exec('tmux list-sessions -F "#{session_name}|#{session_windows}|#{session_attached}"', (err, stdout) => {
    if (err) return res.json([])
    const lines = stdout.trim().split('\n').filter(Boolean)
    const projects = lines.map(line => {
      const [name, windows, attached] = line.split('|')
      // 尝试读取 NEXUS_CWD
      let path = ''
      try {
        const envOutput = execSync(`tmux show-environment -t ${name} NEXUS_CWD 2>/dev/null`).toString().trim()
        const match = envOutput.match(/^NEXUS_CWD=(.+)$/)
        if (match) path = match[1]
      } catch {}
      // 没有 NEXUS_CWD，尝试取第一个 window 的 pane_current_path
      if (!path && windows !== '0') {
        try {
          const cwdOutput = execSync(`tmux list-windows -t ${name} -F '#{pane_current_path}' 2>/dev/null | head -1`).toString().trim()
          if (cwdOutput) path = cwdOutput
        } catch {}
      }
      return {
        name,
        path: path || WORKSPACE_ROOT,
        active: name === TMUX_SESSION,
        channelCount: Number(windows) || 0
      }
    })
    projects.reverse()
    res.json(projects)
  })
})

// GET /api/session-cwd — 获取指定 session 的 NEXUS_CWD
app.get('/api/session-cwd', authMiddleware, (req, res) => {
  const session = req.query.session || TMUX_SESSION
  let cwd = WORKSPACE_ROOT

  // 1. 尝试读取 NEXUS_CWD（外部启动的 session 可能没有，会抛异常）
  try {
    const envOutput = execSync(`tmux show-environment -t ${session} NEXUS_CWD 2>/dev/null`).toString().trim()
    const match = envOutput.match(/^NEXUS_CWD=(.+)$/)
    if (match) cwd = match[1]
  } catch { /* NEXUS_CWD 未设置 */ }

  // 2. 若 NEXUS_CWD 未设置，回退到 pane_current_path
  if (cwd === WORKSPACE_ROOT) {
    try {
      const panePath = execSync(`tmux display-message -t ${session} -p '#{pane_current_path}' 2>/dev/null`).toString().trim()
      if (panePath) cwd = panePath
    } catch { /* fallback to WORKSPACE_ROOT */ }
  }

  const relative = cwd.startsWith(WORKSPACE_ROOT) ? cwd.slice(WORKSPACE_ROOT.length).replace(/^\/+/, '') : ''
  res.json({ cwd, relative })
})

// GET /api/projects/:name/channels — 列出指定 Project 的 Channels（windows）
app.get('/api/projects/:name/channels', authMiddleware, (req, res) => {
  const sessionName = req.params.name
  exec(
    `tmux list-windows -t ${sessionName} -F "#{window_index}|#{window_name}|#{window_active}|#{pane_current_path}"`,
    (err, stdout) => {
      if (err) return res.status(500).json({ error: err.message })
      const lines = stdout.trim().split('\n').filter(Boolean)
      const channels = lines.map(line => {
        const parts = line.split('|')
        const index = Number(parts[0])
        const name = parts[1]
        const active = parts[2]?.trim() === '1'
        const cwd = parts.slice(3).join(':') || ''
        return { index, name, active, cwd }
      })
      // 新创建的频道排在上面
      channels.reverse()
      res.json({ project: sessionName, channels })
    }
  )
})

// POST /api/projects — 新建 Project（创建 tmux session）
// body: { path, shell_type?, profile? }
// project 名称基于路径自动生成
app.post('/api/projects', authMiddleware, (req, res) => {
  const { path, shell_type = 'claude', profile } = req.body || {}
  if (!path) return res.status(400).json({ error: 'path required' })

  const cwd = path.startsWith('/') ? path : `${WORKSPACE_ROOT}/${path}`
  if (!existsSync(cwd)) {
    return res.status(400).json({ error: `工作目录不存在：${cwd}` })
  }
  try {
    if (!statSync(cwd).isDirectory()) {
      return res.status(400).json({ error: `不是目录：${cwd}` })
    }
  } catch (e) {
    return res.status(400).json({ error: `无法访问：${cwd}（${e.message}）` })
  }

  // project 名称基于路径：把 / 替换成 -，并去除首尾 -
  let projectName = cwd.replace(/^\/+|\/+$/g, '').replace(/\//g, '-')
  if (!projectName) projectName = 'home'
  // 确保名称安全且唯一
  const safeName = projectName.replace(/[^a-zA-Z0-9._~-]/g, '-').substring(0, 50) || 'project'

  // 检查是否已存在同名 session，如果存在则添加序号
  let finalName = safeName
  try {
    const existing = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null').toString().trim().split('\n')
    let counter = 1
    while (existing.includes(finalName)) {
      finalName = `${safeName}-${counter++}`
    }
  } catch {}

  // 构建 shell 命令
  const proxyVars = {
    ...(process.env.HTTP_PROXY  ? { HTTP_PROXY:  process.env.HTTP_PROXY  } : {}),
    ...(process.env.HTTPS_PROXY ? { HTTPS_PROXY: process.env.HTTPS_PROXY } : {}),
    ...(process.env.ALL_PROXY   ? { ALL_PROXY:   process.env.ALL_PROXY   } : {}),
    ...(process.env.http_proxy  ? { http_proxy:  process.env.http_proxy  } : {}),
    ...(process.env.https_proxy ? { https_proxy: process.env.https_proxy } : {}),
    ...(CLAUDE_PROXY ? { ALL_PROXY: CLAUDE_PROXY, HTTPS_PROXY: CLAUDE_PROXY, HTTP_PROXY: CLAUDE_PROXY, NEXUS_PROXY: CLAUDE_PROXY } : {}),
  }
  const proxyExports = Object.entries(proxyVars).map(([k, v]) => `export ${k}='${v}'`).join('; ')
  const proxyPrefix = proxyExports ? `${proxyExports}; ` : ''

  let shellCmd
  if (shell_type === 'bash') {
    shellCmd = buildInteractiveShellCmd(proxyPrefix)
  } else {
    if (profile) {
      const runScript = join(__dirname, 'nexus-run-claude.sh')
      // claude 失败时给出提示，再 fallback 到交互 shell，避免窗口看起来"没反应"
      // 注意：提示文本里不能有 `"`；用单引号避免与 execFileSync 的参数边界冲突
      shellCmd = `${proxyPrefix}bash '${runScript}' ${profile} '${cwd}' || echo; echo '[Nexus] claude 退出或启动失败，fallback 到 ${INTERACTIVE_SHELL}（可直接输入 claude 重试）'; ${INTERACTIVE_SHELL_CMD}`
    } else {
      shellCmd = `${proxyPrefix}claude --dangerously-skip-permissions || echo; echo '[Nexus] claude 退出或启动失败，请确认已 claude login 或配置 API key'; ${INTERACTIVE_SHELL_CMD}`
    }
  }

  // 初始窗口名使用目录名[-profile名]（取路径最后一部分）
  const dirName = cwd.replace(/^\/+|\/+$/g, '').split('/').pop() || '~'
  const initialWindowName = profile ? `${dirName}-${profile}` : dirName

  // 创建 tmux session（改用 execFileSync，避免 shellCmd 含引号时 shell 参数解析错位
  // 导致 tmux 收到截断的命令，window 瞬间退出 → session 消亡 → 后续 set-environment
  // 报 "no such session"）
  // 同时把 NEXUS_CWD 和 proxy vars 通过 `-e KEY=VAL` 在 new-session 时一次性注入，
  // 避免 session 存活不稳时后置 set-environment 失败
  const newSessionArgs = [
    'new-session', '-d',
    '-s', finalName,
    '-n', initialWindowName,
    '-c', cwd,
    '-e', `NEXUS_CWD=${cwd}`,
  ]
  for (const [key, value] of Object.entries(proxyVars)) {
    newSessionArgs.push('-e', `${key}=${value}`)
  }
  newSessionArgs.push(shellCmd)
  try {
    execFileSync('tmux', newSessionArgs, { stdio: 'pipe' })
  } catch (err) {
    return res.status(500).json({ error: 'failed to create project: ' + err.message })
  }

  // 写入 snapshot（电脑重启后自动恢复此 project 骨架）
  try {
    upsertSessionToSnapshot({
      name: finalName,
      cwd,
      shell_type,
      profile: profile || null,
      windows: [{
        index: 0,
        name: initialWindowName,
        cwd,
        shell_type,
        profile: profile || null,
        claudeSessionId: null, // 等下次 reconcile 异步抓
      }],
    })
  } catch (e) { console.warn('[Snapshot] upsert session failed:', e.message) }

  res.json({ name: finalName, path: cwd, shell_type, profile: profile || null })
})

// POST /api/projects/:name/channels — 在指定 Project 中新建 Channel（window）
app.post('/api/projects/:name/channels', authMiddleware, (req, res) => {
  const sessionName = req.params.name
  const { shell_type = 'claude', profile, path: bodyPath } = req.body || {}

  // 优先使用前端传入的 path，其次读取 NEXUS_CWD，最后 fallback 到 WORKSPACE_ROOT
  let cwd = WORKSPACE_ROOT
  if (bodyPath) {
    cwd = bodyPath
  } else {
    try {
      const envOutput = execSync(`tmux show-environment -t ${sessionName} NEXUS_CWD 2>/dev/null`).toString().trim()
      const match = envOutput.match(/^NEXUS_CWD=(.+)$/)
      if (match) cwd = match[1]
    } catch {}
  }
  if (!existsSync(cwd)) {
    return res.status(400).json({ error: `工作目录不存在：${cwd}` })
  }

  // Channel 命名：profile 名[-序号]
  const baseName = profile || 'channel'
  let channelName = baseName
  try {
    const existing = execSync(`tmux list-windows -t ${sessionName} -F "#{window_name}"`).toString().trim().split('\n')
    let counter = 1
    while (existing.includes(channelName)) {
      channelName = `${baseName}-${counter++}`
    }
  } catch {}

  // 构建 shell 命令
  const proxyVars = {
    ...(process.env.HTTP_PROXY  ? { HTTP_PROXY:  process.env.HTTP_PROXY  } : {}),
    ...(process.env.HTTPS_PROXY ? { HTTPS_PROXY: process.env.HTTPS_PROXY } : {}),
    ...(process.env.ALL_PROXY   ? { ALL_PROXY:   process.env.ALL_PROXY   } : {}),
    ...(process.env.http_proxy  ? { http_proxy:  process.env.http_proxy  } : {}),
    ...(process.env.https_proxy ? { https_proxy: process.env.https_proxy } : {}),
    ...(CLAUDE_PROXY ? { ALL_PROXY: CLAUDE_PROXY, HTTPS_PROXY: CLAUDE_PROXY, HTTP_PROXY: CLAUDE_PROXY, NEXUS_PROXY: CLAUDE_PROXY } : {}),
  }
  const proxyExports = Object.entries(proxyVars).map(([k, v]) => `export ${k}='${v}'`).join('; ')
  const proxyPrefix = proxyExports ? `${proxyExports}; ` : ''

  let shellCmd
  if (shell_type === 'bash') {
    shellCmd = buildInteractiveShellCmd(proxyPrefix)
  } else {
    if (profile) {
      const runScript = join(__dirname, 'nexus-run-claude.sh')
      shellCmd = `${proxyPrefix}bash '${runScript}' ${profile} '${cwd}' || echo; echo '[Nexus] claude 退出或启动失败，fallback 到 ${INTERACTIVE_SHELL}（可直接输入 claude 重试）'; ${INTERACTIVE_SHELL_CMD}`
    } else {
      shellCmd = `${proxyPrefix}claude --dangerously-skip-permissions || echo; echo '[Nexus] claude 退出或启动失败，请确认已 claude login 或配置 API key'; ${INTERACTIVE_SHELL_CMD}`
    }
  }

  // 确保 session 存在
  try {
    execFileSync('tmux', ['has-session', '-t', sessionName], { stdio: 'pipe' })
  } catch {
    try {
      execFileSync('tmux', ['new-session', '-d', '-s', sessionName, '-n', 'shell', INTERACTIVE_SHELL], { stdio: 'pipe' })
    } catch {}
  }

  // 创建新 window —— 改 execFileSync 避免 shellCmd 引号嵌套问题
  try {
    execFileSync('tmux', [
      'new-window',
      '-t', sessionName,
      '-c', cwd,
      '-n', channelName,
      shellCmd,
    ], { stdio: 'pipe' })
    // 写入 snapshot：查新 window 的 index
    try {
      const wins = readTmuxWindows(sessionName)
      const newWin = wins.find(w => w.name === channelName)
      if (newWin) {
        upsertWindowToSnapshot(sessionName, {
          index: newWin.index,
          name: channelName,
          cwd,
          shell_type,
          profile: profile || null,
          claudeSessionId: null,
        })
      }
    } catch (e) { console.warn('[Snapshot] upsert window failed:', e.message) }
    res.json({ name: channelName, cwd, shell_type, profile: profile || null, project: sessionName })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/projects/:name/activate — 切换到指定 Project（设置为目标 session）
app.post('/api/projects/:name/activate', authMiddleware, (req, res) => {
  const sessionName = req.params.name
  // 验证 session 存在
  try {
    execSync(`tmux has-session -t ${sessionName}`)
  } catch {
    return res.status(404).json({ error: 'project not found' })
  }
  // 读取该 session 最后激活的 channel
  let lastChannel = null
  try {
    const envOutput = execSync(`tmux show-environment -t ${sessionName} NEXUS_LAST_CHANNEL 2>/dev/null`).toString().trim()
    const match = envOutput.match(/^NEXUS_LAST_CHANNEL=(\d+)$/)
    if (match) lastChannel = parseInt(match[1], 10)
  } catch {}
  // 验证 channel 是否存在，不存在则返回 null（前端会用第一个）
  if (lastChannel !== null) {
    try {
      const windows = execSync(`tmux list-windows -t ${sessionName} -F "#I"`).toString().trim().split('\n')
      if (!windows.includes(String(lastChannel))) {
        lastChannel = null
      }
    } catch {
      lastChannel = null
    }
  }
  // 返回 session 信息，前端据此切换 WebSocket 连接
  res.json({ active: true, project: sessionName, lastChannel })
})

// POST /api/projects/:name/rename — 重命名 Project（重命名 tmux session）
app.post('/api/projects/:name/rename', authMiddleware, (req, res) => {
  const oldName = req.params.name
  const { name: newName } = req.body || {}
  if (!newName || !newName.trim()) {
    return res.status(400).json({ error: 'new name required' })
  }
  // session 名允许 Unicode，但不能含 tmux 保留字符（`:` `.`）、空白、路径分隔符、控制字符
  // —— 之前的 /[^a-zA-Z0-9_\-]/→'' 把中文字符直接删掉，中文名会变空导致 invalid name
  const sanitizedNewName = String(newName).trim().replace(/[\s:.\0\r\n\t\/\\]/g, '').slice(0, 50)
  if (!sanitizedNewName) {
    return res.status(400).json({ error: 'invalid name format' })
  }
  // 验证旧 session 存在
  try {
    execSync(`tmux has-session -t ${oldName}`)
  } catch {
    return res.status(404).json({ error: 'project not found' })
  }
  // 检查新名称是否已存在
  try {
    execSync(`tmux has-session -t ${sanitizedNewName}`)
    return res.status(409).json({ error: 'project name already exists' })
  } catch {
    // 不存在，可以重命名
  }
  // 执行重命名
  try {
    execFileSync('tmux', ['rename-session', '-t', oldName, '--', sanitizedNewName], { stdio: 'pipe' })
    try { renameSessionInSnapshot(oldName, sanitizedNewName) } catch {}
    res.json({ ok: true, oldName, newName: sanitizedNewName })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/projects/:name — 关闭 Project（kill tmux session）
app.delete('/api/projects/:name', authMiddleware, (req, res) => {
  const sessionName = req.params.name
  // 验证 session 存在
  try {
    execSync(`tmux has-session -t ${sessionName}`)
  } catch {
    return res.status(404).json({ error: 'project not found' })
  }
  // kill session
  exec(`tmux kill-session -t ${sessionName}`, (err) => {
    if (err) return res.status(500).json({ error: err.message })
    try { removeSessionFromSnapshot(sessionName) } catch {}
    res.json({ ok: true })
  })
})

// ================================================

// GET /api/sessions — 列出 tmux 会话的所有窗口
app.get('/api/sessions', authMiddleware, (req, res) => {
  const session = req.query.session || TMUX_SESSION
  exec(
    `tmux list-windows -t ${session} -F "#{window_index}|#{window_name}|#{window_active}"`,
    (err, stdout) => {
      if (err) return res.status(500).json({ error: err.message })
      const windows = stdout.trim().split('\n').filter(Boolean).map(line => {
        const [index, name, active] = line.split('|')
        return { index: Number(index), name, active: active?.trim() === '1' }
      })
      res.json({ session, windows })
    }
  )
})

// DELETE /api/sessions/:id — 关闭 tmux 窗口
app.delete('/api/sessions/:id', authMiddleware, (req, res) => {
  const index = req.params.id
  const session = req.query.session || TMUX_SESSION
  // Check window count first; if this is the last window, create a fallback
  // window before killing so the tmux session is not destroyed.
  exec(`tmux list-windows -t ${session} -F "#{window_index}" 2>/dev/null | wc -l`, (countErr, countOut) => {
    const windowCount = parseInt(countOut.trim()) || 0
    if (windowCount <= 1) {
      // Last window: create a new shell first to keep the session alive
      exec(`tmux new-window -t ${session} -n shell "${INTERACTIVE_SHELL}"`, () => {
        exec(`tmux kill-window -t ${session}:${index}`, (err) => {
          if (err) return res.status(500).json({ error: err.message })
          try { removeWindowFromSnapshot(session, index) } catch {}
          res.json({ ok: true })
        })
      })
    } else {
      exec(`tmux kill-window -t ${session}:${index}`, (err) => {
        if (err) return res.status(500).json({ error: err.message })
        try { removeWindowFromSnapshot(session, index) } catch {}
        res.json({ ok: true })
      })
    }
  })
})

// POST /api/sessions/:id/attach — 切换到指定 tmux 窗口
app.post('/api/sessions/:id/attach', authMiddleware, (req, res) => {
  const index = req.params.id
  const session = req.query.session || TMUX_SESSION
  exec(`tmux select-window -t ${session}:${index}`, (err) => {
    if (err) return res.status(500).json({ error: err.message })
    // 记录最后激活的 channel 到环境变量
    try {
      execSync(`tmux set-environment -t ${session} NEXUS_LAST_CHANNEL ${index}`)
    } catch {}
    res.json({ ok: true })
  })
})

// ---- Tasks API (F-13: claude -p 非交互派发) ----

function loadTasks() {
  try {
    if (existsSync(TASKS_FILE)) {
      return JSON.parse(readFileSync(TASKS_FILE, 'utf8'))
    }
  } catch {}
  return []
}

const MAX_TASKS = 200

function saveTasks(tasks) {
  // 保留最新的 MAX_TASKS 条，防止文件无限增长
  const trimmed = tasks.length > MAX_TASKS ? tasks.slice(-MAX_TASKS) : tasks
  writeFileSync(TASKS_FILE, JSON.stringify(trimmed, null, 2))
}

function updateTask(id, updates) {
  const tasks = loadTasks()
  const idx = tasks.findIndex(t => t.id === id)
  if (idx !== -1) {
    Object.assign(tasks[idx], updates)
    saveTasks(tasks)
  }
}

/**
 * F-17: 统一任务执行入口 — spawn claude -p, 管理任务记录, 回调给各渠道
 * @param {string} prompt
 * @param {string} cwd
 * @param {{ sessionName?: string, source?: string, tmuxSession?: string, profile?: string, onChunk?: (chunk:string,isErr:boolean)=>void, onDone?: (result:object)=>void }} opts
 * @returns {string} taskId
 */
function runTask(prompt, cwd, opts = {}) {
  const { sessionName, source = 'web', tmuxSession, profile, onChunk, onDone } = opts
  const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const createdAt = new Date().toISOString()

  const taskRecord = {
    id: taskId,
    session_name: sessionName || '',
    prompt: prompt.slice(0, 1000),
    status: 'running',
    output: '',
    error: '',
    createdAt,
    source,
    ...(tmuxSession && tmuxSession !== TMUX_SESSION ? { tmux_session: tmuxSession } : {}),
  }
  const allTasks = loadTasks()
  allTasks.push(taskRecord)
  saveTasks(allTasks)

  const proxyEnv = CLAUDE_PROXY ? { ALL_PROXY: CLAUDE_PROXY, HTTPS_PROXY: CLAUDE_PROXY, HTTP_PROXY: CLAUDE_PROXY } : {}
  const claudeArgs = ['-p', prompt, '--dangerously-skip-permissions']
  if (profile) claudeArgs.push('--profile', profile)
  const child = spawn('claude', claudeArgs, {
    cwd,
    env: { ...process.env, ...proxyEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  let errorOutput = ''

  child.stdout.on('data', (data) => {
    const chunk = data.toString()
    output += chunk
    onChunk?.(chunk, false)
  })
  child.stderr.on('data', (data) => {
    const chunk = data.toString()
    errorOutput += chunk
    onChunk?.(chunk, true)
  })

  child.on('close', (code) => {
    const status = code === 0 ? 'success' : 'error'
    updateTask(taskId, {
      status,
      output: output.slice(-10000),
      error: errorOutput.slice(-1000),
      completedAt: new Date().toISOString(),
      exitCode: code,
    })
    onDone?.({ taskId, status, output, errorOutput, exitCode: code })
  })

  return { taskId, kill: () => { if (!child.killed) child.kill() } }
}

// GET /api/tasks — 获取任务历史
app.get('/api/tasks', authMiddleware, (req, res) => {
  const tasks = loadTasks()
  res.json(tasks.slice(-50).reverse()) // 最近50条，倒序
})

// DELETE /api/tasks/:id — 删除单条任务记录
app.delete('/api/tasks/:id', authMiddleware, (req, res) => {
  const tasks = loadTasks()
  const filtered = tasks.filter(t => t.id !== req.params.id)
  saveTasks(filtered)
  res.json({ ok: true })
})

// POST /api/tasks — 创建新任务，SSE 流式返回
app.post('/api/tasks', authMiddleware, (req, res) => {
  const { session_name, prompt, profile, tmux_session } = req.body || {}
  if (!prompt) return res.status(400).json({ error: 'prompt required' })

  // 找到 session 对应的 cwd
  let cwd = WORKSPACE_ROOT
  const targetSession = tmux_session || TMUX_SESSION
  try {
    const windows = execSync(`tmux list-windows -t ${targetSession} -F "#I:#W:#{pane_current_path}"`).toString().trim().split('\n')
    for (const line of windows) {
      const parts = line.split(':')
      const name = parts[1]
      const path = parts.slice(2).join(':')
      if (name === session_name && path) { cwd = path; break }
    }
  } catch {}

  // 设置 SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const createdAt = new Date().toISOString()
  const { taskId, kill } = runTask(prompt, cwd, {
    sessionName: session_name,
    source: 'web',
    tmuxSession: targetSession,
    profile,
    onChunk: (chunk, isErr) => {
      const ev = isErr ? 'error' : 'output'
      res.write(`event: ${ev}\ndata: ${JSON.stringify({ chunk })}\n\n`)
    },
    onDone: ({ taskId: tid, status, exitCode }) => {
      res.write(`event: done\ndata: ${JSON.stringify({ taskId: tid, status, exitCode })}\n\n`)
      res.end()
    },
  })

  res.write(`event: start\ndata: ${JSON.stringify({ taskId, session_name, prompt, createdAt })}\n\n`)
  req.on('close', kill)
})


// ---- Telegram Bot Webhook (F-16) ----

function telegramRequest(method, payload) {
  if (!TELEGRAM_BOT_TOKEN) return Promise.resolve(null)
  return new Promise((resolve) => {
    const body = JSON.stringify(payload)
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }
    const req = https.request(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
      options,
      (res) => {
        let data = ''
        res.on('data', d => data += d)
        res.on('end', () => {
          try { resolve(JSON.parse(data)) } catch { resolve(null) }
        })
      }
    )
    req.on('error', (e) => { console.error(`Telegram ${method} error:`, e.message); resolve(null) })
    req.write(body)
    req.end()
  })
}

// Returns the sent message_id (or null)
async function telegramSend(chatId, text) {
  const result = await telegramRequest('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' })
  return result?.result?.message_id ?? null
}

// Edit an existing message in-place (silently ignores errors)
function telegramEdit(chatId, messageId, text) {
  if (!messageId) return
  telegramRequest('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'Markdown' })
}

// 下载 Telegram 文件到指定目录
function downloadTelegramFile(fileId, destDir, filename) {
  return new Promise((resolve, reject) => {
    // 1. 获取 file_path
    const infoUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
    https.get(infoUrl, (res) => {
      let data = ''
      res.on('data', d => data += d)
      res.on('end', () => {
        try {
          const info = JSON.parse(data)
          if (!info.ok) return reject(new Error('getFile failed: ' + info.description))
          const filePath = info.result.file_path
          const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`

          // 2. 下载文件
          https.get(fileUrl, (fres) => {
            const chunks = []
            fres.on('data', c => chunks.push(c))
            fres.on('end', () => {
              const buf = Buffer.concat(chunks)
              const destPath = join(destDir, filename)
              writeFileSync(destPath, buf)
              resolve({ path: destPath, size: buf.length })
            })
            fres.on('error', reject)
          }).on('error', reject)
        } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

// POST /api/webhooks/telegram — Telegram Bot webhook
app.post('/api/webhooks/telegram', (req, res) => {
  // 验证 secret（如果配置了）
  if (TELEGRAM_WEBHOOK_SECRET) {
    const secret = req.headers['x-telegram-bot-api-secret-token']
    if (secret !== TELEGRAM_WEBHOOK_SECRET) {
      return res.status(403).json({ error: 'forbidden' })
    }
  }

  if (!TELEGRAM_BOT_TOKEN) return res.status(503).json({ error: 'Telegram not configured' })

  const update = req.body
  res.json({ ok: true }) // 立即返回，避免 Telegram 重试

  const message = update.message || update.edited_message
  if (!message) return

  const chatId = message.chat.id

  // /start 欢迎消息
  if (message.text?.trim() === '/start') {
    telegramSend(chatId, '👋 *Nexus Bot* 已就绪\n\n发送任意文字，我会用 `claude -p` 在你的服务器上执行并回复结果。\n\n发送图片或文件，我会保存到当前 session 目录。\n\n`/sessions` — 查看 tmux 窗口列表\n`/switch <编号>` — 切换目标窗口')
    return
  }

  // /sessions 列出当前窗口
  if (message.text?.trim() === '/sessions') {
    exec(`tmux list-windows -t ${TMUX_SESSION} -F "#{window_index}|#{window_name}|#{window_active}"`, (err, stdout) => {
      if (err) {
        telegramSend(chatId, '❌ 无法获取会话列表: ' + err.message)
        return
      }
      const lines = stdout.trim().split('\n').filter(Boolean).map(line => {
        const [idx, name, active] = line.split('|')
        return `${active?.trim() === '1' ? '▶' : '  '} \`${idx}: ${name}\``
      })
      telegramSend(chatId, '*当前 tmux 窗口:*\n' + lines.join('\n') + '\n\n用 `/switch <编号>` 切换')
    })
    return
  }

  // /switch <index|name> — 切换 active tmux 窗口
  if (message.text?.trim().startsWith('/switch ')) {
    const raw = message.text.trim().slice('/switch '.length).trim()
    const target = raw.replace(/[^a-zA-Z0-9_\-]/g, '') // 只允许安全字符
    if (!target) {
      telegramSend(chatId, '❌ 无效的窗口名称，只允许字母/数字/下划线/连字符')
      return
    }
    exec(`tmux select-window -t ${TMUX_SESSION}:${target}`, (err) => {
      if (err) {
        telegramSend(chatId, `❌ 无法切换到窗口 \`${target}\`: ${err.message}`)
      } else {
        telegramSend(chatId, `✅ 已切换到窗口 \`${target}\`\n\n后续任务将在此窗口执行。`)
      }
    })
    return
  }

  // 执行 claude -p，Telegram 渠道：增量进度推送
  async function runClaudePrompt(prompt, cwd, sessionName) {
    const msgId = await telegramSend(chatId, `⏳ *执行中*（session: \`${sessionName || 'default'}\`）\n\n_等待输出..._`)

    let currentOutput = ''
    let currentError = ''
    let currentTaskId = null

    const progressInterval = setInterval(() => {
      const preview = (currentOutput || currentError).trim()
      if (preview) {
        if (msgId) {
          const truncated = preview.length > 3000 ? '…' + preview.slice(-3000) : preview
          telegramEdit(chatId, msgId, `⏳ *执行中*（session: \`${sessionName || 'default'}\`）\n\`\`\`\n${truncated}\n\`\`\``)
        }
        // 更新任务记录，让 Web TaskPanel 可见中间输出
        if (currentTaskId) updateTask(currentTaskId, { output: currentOutput.slice(-10000), error: currentError.slice(-1000) })
      }
    }, 5000)

    const { taskId } = runTask(prompt, cwd, {
      sessionName: sessionName || 'telegram',
      source: 'telegram',
      onChunk: (chunk, isErr) => {
        if (isErr) currentError += chunk; else currentOutput += chunk
      },
      onDone: ({ exitCode }) => {
        clearInterval(progressInterval)
        const result = currentOutput.trim() || currentError.trim() || '(无输出)'
        const truncated = result.length > 3800 ? result.slice(0, 3800) + '\n\n…(输出已截断)' : result
        const status = exitCode === 0 ? '✅' : '❌'
        if (msgId) {
          telegramEdit(chatId, msgId, `${status} *执行完成*（session: \`${sessionName || 'default'}\`）\n\`\`\`\n${truncated}\n\`\`\``)
        } else {
          telegramSend(chatId, `${status} *执行完成*\n\`\`\`\n${truncated}\n\`\`\``)
        }
      },
    })
    currentTaskId = taskId
  }

  // 处理文件/图片上传
  if (message.photo || message.document) {
    (async () => {
      try {
        // 确定目标目录
        let cwd = WORKSPACE_ROOT
        try {
          const activeLines = execSync(`tmux list-windows -t ${TMUX_SESSION} -F "#I:#W:#{pane_current_path}:#{window_active}"`).toString().trim().split('\n')
          for (const line of activeLines) {
            const parts = line.split(':')
            if (parts[parts.length - 1]?.trim() === '1') {
              cwd = parts.slice(2, parts.length - 1).join(':')
              break
            }
          }
        } catch {}

        let fileId, filename
        if (message.photo) {
          const photo = message.photo[message.photo.length - 1]
          fileId = photo.file_id
          filename = `tg_photo_${Date.now()}.jpg`
        } else {
          fileId = message.document.file_id
          filename = message.document.file_name || `tg_file_${Date.now()}`
        }

        telegramSend(chatId, `⬇️ 正在下载文件到 \`${cwd}\`...`)
        const result = await downloadTelegramFile(fileId, cwd, filename)
        telegramSend(chatId, `✅ 文件已保存\n\`\`\`\n${result.path}\n\`\`\`\n大小: ${(result.size / 1024).toFixed(1)} KB`)

        // 如果有 caption，把 caption 作为 prompt 执行
        if (message.caption?.trim()) {
          const caption = message.caption.trim()
          runClaudePrompt(caption, cwd, 'telegram').catch(e => console.error('runClaudePrompt error:', e))
        }
      } catch (e) {
        telegramSend(chatId, '❌ 文件处理失败: ' + (e.message || String(e)))
      }
    })()
    return
  }

  // 普通 prompt
  const text = message.text?.trim()
  if (!text) return
  let cwd = WORKSPACE_ROOT
  let sessionName = TELEGRAM_DEFAULT_SESSION

  try {
    const windows = execSync(`tmux list-windows -t ${TMUX_SESSION} -F "#I:#W:#{pane_current_path}"`).toString().trim().split('\n')
    // 优先用默认 session，否则用 active window
    for (const line of windows) {
      const parts = line.split(':')
      const idx = parts[0]
      const name = parts[1]
      const path = parts.slice(2).join(':')
      if (TELEGRAM_DEFAULT_SESSION && name === TELEGRAM_DEFAULT_SESSION) {
        cwd = path
        sessionName = name
        break
      }
    }
    // 如果没找到默认 session，用 active window
    if (!sessionName) {
      const activeLines = execSync(`tmux list-windows -t ${TMUX_SESSION} -F "#I:#W:#{pane_current_path}:#{window_active}"`).toString().trim().split('\n')
      for (const line of activeLines) {
        const parts = line.split(':')
        const active = parts[parts.length - 1]
        if (active?.trim() === '1') {
          sessionName = parts[1]
          cwd = parts.slice(2, parts.length - 1).join(':')
          break
        }
      }
    }
  } catch { /* ignore */ }

  runClaudePrompt(text, cwd, sessionName).catch(e => console.error('runClaudePrompt error:', e))
})

// GET /api/telegram/setup — 一键配置 Telegram webhook URL
app.get('/api/telegram/setup', authMiddleware, (req, res) => {
  if (!TELEGRAM_BOT_TOKEN) return res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN not set' })
  const webhookUrl = `${req.protocol}://${req.get('host')}/api/webhooks/telegram`
  const secretParam = TELEGRAM_WEBHOOK_SECRET ? `&secret_token=${TELEGRAM_WEBHOOK_SECRET}` : ''
  const setupUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}${secretParam}`

  // 调用 Telegram API 设置 webhook
  https.get(setupUrl, (r) => {
    let data = ''
    r.on('data', d => data += d)
    r.on('end', () => {
      try {
        res.json({ webhookUrl, telegramResponse: JSON.parse(data) })
      } catch {
        res.json({ webhookUrl, raw: data })
      }
    })
  }).on('error', (e) => res.status(500).json({ error: e.message }))
})

// SPA fallback — 所有非 API 路由返回 index.html
app.get('*', (req, res) => {
  const indexPath = join(__dirname, 'frontend', 'dist', 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) res.status(404).send('Not found — run: cd frontend && npm run build');
  });
});

// ========== Session Snapshot 持久化（电脑重启后自动恢复 project/channel 骨架）==========
// 存储 schema v1：
//   { version:1, savedAt, sessions:[{ name, cwd, shell_type, profile,
//       windows:[{ index, name, cwd, shell_type, profile, claudeSessionId? }] }] }
// claudeSessionId 只对 shell_type=claude 的 window 有意义，Phase 2 赋值。
//
// 更新时机（权威源）：/api/projects POST/DELETE/rename、/channels POST/DELETE/rename。
// 定期 reconcile：每 60s 扫 tmux 剔除已删除 session，刷新 claude session-id。
// 启动恢复：server.listen 后 restoreFromSnapshot() 对 has-session 检查不存在的按 spec 重建。

function loadSnapshot() {
  try {
    if (!existsSync(SNAPSHOT_FILE)) return { version: 1, sessions: [] };
    const raw = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8'));
    if (!raw || !Array.isArray(raw.sessions)) return { version: 1, sessions: [] };
    return raw;
  } catch (e) {
    console.warn('[Snapshot] load failed:', e.message);
    return { version: 1, sessions: [] };
  }
}

function writeSnapshot(snap) {
  try {
    const next = { version: 1, savedAt: new Date().toISOString(), sessions: snap.sessions || [] };
    writeFileSync(SNAPSHOT_FILE, JSON.stringify(next, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Snapshot] write failed:', e.message);
  }
}

// 从 claude CLI 存储推断指定 cwd 当前活跃的 session-id
//   ~/.claude/projects/<cwd.replace(/[^a-zA-Z0-9]/g,'-')>/<uuid>.jsonl
// mtime 最新的 jsonl = 最近使用的 session
function inferClaudeSessionId(cwd) {
  if (!cwd) return null;
  try {
    const encoded = cwd.replace(/[^a-zA-Z0-9]/g, '-');
    const dir = join(process.env.HOME || '', '.claude', 'projects', encoded);
    if (!existsSync(dir)) return null;
    const files = readdirSync(dir).filter(f => f.endsWith('.jsonl'));
    if (!files.length) return null;
    files.sort((a, b) => {
      try { return statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs; }
      catch { return 0; }
    });
    return files[0].replace(/\.jsonl$/, '');
  } catch { return null; }
}

// 从 live tmux 读取指定 session 的 windows 列表（index + name + pane-cwd）
function readTmuxWindows(sessionName) {
  try {
    const out = execFileSync('tmux', [
      'list-windows', '-t', sessionName,
      '-F', '#{window_index}\t#{window_name}\t#{pane_current_path}'
    ], { encoding: 'utf8', stdio: 'pipe' }).trim();
    return out.split('\n').filter(Boolean).map(line => {
      const [idxStr, name, paneCwd] = line.split('\t');
      return { index: Number(idxStr), name, cwd: paneCwd || null };
    });
  } catch { return []; }
}

// 合并：以 snapshot 为主干（保留 shell_type/profile/claudeSessionId），
// 用 live tmux 校正 window 列表（新增/消失），并刷新 claudeSessionId
function reconcileSnapshot() {
  const snap = loadSnapshot();
  let aliveSessions;
  try {
    aliveSessions = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
      encoding: 'utf8', stdio: 'pipe'
    }).trim().split('\n').filter(Boolean);
  } catch {
    aliveSessions = [];
  }
  const aliveSet = new Set(aliveSessions);
  const next = [];
  for (const sess of snap.sessions) {
    if (!aliveSet.has(sess.name)) {
      // tmux 已经没这个 session —— 保留 spec 以便下次恢复时重建（先生的需求）
      // 这里的判断：如果 tmux server 整体挂了（aliveSessions 空），所有 spec 都保留；
      // 如果 server 活着但特定 session 没了（用户主动 kill），也保留（下次 Nexus 启动自动补）
      next.push(sess);
      continue;
    }
    const liveWins = readTmuxWindows(sess.name);
    const liveIndices = new Set(liveWins.map(w => w.index));
    // 合并 windows：优先保留 snapshot 里的元数据，补上新出现的（shell_type 默认 bash）
    const mergedWins = [];
    const snapByIdx = new Map((sess.windows || []).map(w => [w.index, w]));
    for (const lw of liveWins) {
      const prev = snapByIdx.get(lw.index);
      const shellType = prev?.shell_type ?? 'bash';
      const winCwd = lw.cwd || prev?.cwd || sess.cwd;
      const merged = {
        index: lw.index,
        name: lw.name,
        cwd: winCwd,
        shell_type: shellType,
        profile: prev?.profile ?? null,
      };
      if (shellType === 'claude') {
        const id = inferClaudeSessionId(winCwd);
        merged.claudeSessionId = id || prev?.claudeSessionId || null;
      }
      mergedWins.push(merged);
    }
    // 只保留 tmux 里还存在的 window（被删掉的不再保留）
    next.push({
      name: sess.name,
      cwd: sess.cwd,
      shell_type: sess.shell_type,
      profile: sess.profile,
      windows: mergedWins.filter(w => liveIndices.has(w.index)),
    });
  }
  writeSnapshot({ sessions: next });
}

// 把单个 session 的 spec 加入 snapshot（API 调用后）；存在则覆盖
function upsertSessionToSnapshot(sess) {
  const snap = loadSnapshot();
  const others = snap.sessions.filter(s => s.name !== sess.name);
  others.push(sess);
  writeSnapshot({ sessions: others });
}

function upsertWindowToSnapshot(sessionName, win) {
  const snap = loadSnapshot();
  const target = snap.sessions.find(s => s.name === sessionName);
  if (!target) return;
  target.windows = (target.windows || []).filter(w => w.index !== win.index);
  target.windows.push(win);
  writeSnapshot({ sessions: snap.sessions });
}

function removeSessionFromSnapshot(sessionName) {
  const snap = loadSnapshot();
  writeSnapshot({ sessions: snap.sessions.filter(s => s.name !== sessionName) });
}

function removeWindowFromSnapshot(sessionName, windowIndex) {
  const snap = loadSnapshot();
  const target = snap.sessions.find(s => s.name === sessionName);
  if (!target) return;
  target.windows = (target.windows || []).filter(w => Number(w.index) !== Number(windowIndex));
  writeSnapshot({ sessions: snap.sessions });
}

function renameSessionInSnapshot(oldName, newName) {
  const snap = loadSnapshot();
  const target = snap.sessions.find(s => s.name === oldName);
  if (!target) return;
  target.name = newName;
  writeSnapshot({ sessions: snap.sessions });
}

function renameWindowInSnapshot(sessionName, index, newName) {
  const snap = loadSnapshot();
  const target = snap.sessions.find(s => s.name === sessionName);
  if (!target) return;
  const w = (target.windows || []).find(x => Number(x.index) === Number(index));
  if (w) w.name = newName;
  writeSnapshot({ sessions: snap.sessions });
}

// 构造和路由 /api/projects 里一致的 shellCmd（Phase 2 也用）
// 这里要复用正是因为重启恢复时要模拟"当时创建"的命令
function buildShellCmdForSpec({ shell_type, profile, cwd, claudeSessionId }) {
  const proxyVars = {
    ...(process.env.HTTP_PROXY  ? { HTTP_PROXY:  process.env.HTTP_PROXY  } : {}),
    ...(process.env.HTTPS_PROXY ? { HTTPS_PROXY: process.env.HTTPS_PROXY } : {}),
    ...(process.env.ALL_PROXY   ? { ALL_PROXY:   process.env.ALL_PROXY   } : {}),
    ...(process.env.http_proxy  ? { http_proxy:  process.env.http_proxy  } : {}),
    ...(process.env.https_proxy ? { https_proxy: process.env.https_proxy } : {}),
    ...(CLAUDE_PROXY ? { ALL_PROXY: CLAUDE_PROXY, HTTPS_PROXY: CLAUDE_PROXY, HTTP_PROXY: CLAUDE_PROXY, NEXUS_PROXY: CLAUDE_PROXY } : {}),
  };
  const proxyExports = Object.entries(proxyVars).map(([k, v]) => `export ${k}='${v}'`).join('; ');
  const proxyPrefix = proxyExports ? `${proxyExports}; ` : '';

  if (shell_type === 'bash') {
    return buildInteractiveShellCmd(proxyPrefix);
  }
  // claude 分支 —— 有 session-id 优先 --resume，三级回退：
  //   claude --resume <id> ||  claude --continue  ||  claude
  // 任一成功都进到对话；全失败 exec zsh -i 兜底（避免空窗口）
  const base = '--dangerously-skip-permissions';
  const primary = claudeSessionId
    ? `claude --resume ${claudeSessionId} ${base}`
    : `claude ${base}`;
  if (profile) {
    const runScript = join(__dirname, 'nexus-run-claude.sh');
    // 把 claudeSessionId 作为第 3 个参数传给脚本；脚本内判空走 --resume 或默认启动
    const resumeArg = claudeSessionId ? `'${claudeSessionId}'` : `''`;
    return `${proxyPrefix}bash '${runScript}' ${profile} '${cwd}' ${resumeArg} || echo; echo '[Nexus] claude 退出或启动失败，fallback 到 ${INTERACTIVE_SHELL}'; ${INTERACTIVE_SHELL_CMD}`;
  }
  return `${proxyPrefix}${primary} || ${claudeSessionId ? 'claude --continue ' + base + ' || ' : ''}claude ${base} || echo; echo '[Nexus] claude 启动失败，回退到 ${INTERACTIVE_SHELL}'; ${INTERACTIVE_SHELL_CMD}`;
}

// 启动恢复：对 snapshot 里 tmux 中不存在的 session 按 spec 重建
let lastRestoreSummary = { restored: [], skipped: [], failed: [], at: null };
function restoreFromSnapshot() {
  const snap = loadSnapshot();
  const summary = { restored: [], skipped: [], failed: [], at: new Date().toISOString() };
  let aliveSet;
  try {
    const alive = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
      encoding: 'utf8', stdio: 'pipe'
    }).trim().split('\n').filter(Boolean);
    aliveSet = new Set(alive);
  } catch { aliveSet = new Set(); }

  for (const sess of snap.sessions) {
    if (aliveSet.has(sess.name)) { summary.skipped.push(sess.name); continue; }
    if (!existsSync(sess.cwd)) { summary.failed.push({ name: sess.name, reason: 'cwd missing' }); continue; }
    const windows = (sess.windows || []).slice().sort((a, b) => a.index - b.index);
    if (!windows.length) {
      windows.push({ index: 0, name: sess.name.split('-').pop() || 'shell', cwd: sess.cwd, shell_type: sess.shell_type, profile: sess.profile });
    }
    try {
      // 先创建 session（第一个 window）
      const first = windows[0];
      const firstCmd = buildShellCmdForSpec({ shell_type: first.shell_type, profile: first.profile, cwd: first.cwd, claudeSessionId: first.claudeSessionId });
      execFileSync('tmux', [
        'new-session', '-d',
        '-s', sess.name,
        '-n', first.name || 'shell',
        '-c', first.cwd,
        '-e', `NEXUS_CWD=${sess.cwd}`,
        firstCmd,
      ], { stdio: 'pipe' });
      // 再添加剩余 windows
      for (let i = 1; i < windows.length; i++) {
        const w = windows[i];
        const cmd = buildShellCmdForSpec({ shell_type: w.shell_type, profile: w.profile, cwd: w.cwd, claudeSessionId: w.claudeSessionId });
        try {
          execFileSync('tmux', [
            'new-window',
            '-t', sess.name,
            '-c', w.cwd,
            '-n', w.name || 'shell',
            cmd,
          ], { stdio: 'pipe' });
        } catch (e) {
          summary.failed.push({ name: `${sess.name}:${w.index}`, reason: e.message });
        }
      }
      summary.restored.push(sess.name);
    } catch (e) {
      summary.failed.push({ name: sess.name, reason: e.message });
    }
  }
  lastRestoreSummary = summary;
  if (summary.restored.length || summary.failed.length) {
    console.log(`[Snapshot] restored=${summary.restored.length} skipped=${summary.skipped.length} failed=${summary.failed.length}`);
  }
}

// PTY 多实例管理（F-11/F-18：每个 session:window 独立 PTY）
const ptyMap = new Map(); // "session:windowIndex" -> { pty, clients: Set<ws>, lastOutput, lastActivity }

function ptyKey(session, windowIndex) {
  return `${session}:${windowIndex}`;
}

function ensureWindowPty(session, windowIndex) {
  // Validate session exists as a real tmux session (execFileSync avoids shell expansion)
  let safeSession = session;
  try {
    execFileSync('tmux', ['has-session', '-t', session], { stdio: 'pipe' });
  } catch {
    // Requested session doesn't exist — fall back to default TMUX_SESSION
    safeSession = TMUX_SESSION;
    try {
      execFileSync('tmux', ['has-session', '-t', TMUX_SESSION], { stdio: 'pipe' });
    } catch {
      // Default session also missing — create it
      try { execFileSync('tmux', ['new-session', '-d', '-s', TMUX_SESSION, '-n', 'shell', INTERACTIVE_SHELL], { stdio: 'pipe' }); } catch {}
    }
  }

  const key = ptyKey(safeSession, windowIndex);
  if (ptyMap.has(key)) return { key, entry: ptyMap.get(key) };

  // 检查窗口是否存在，不存在则 fallback 到第一个可用窗口
  let targetWindow = windowIndex;
  try {
    const out = execFileSync('tmux', ['list-windows', '-t', safeSession, '-F', '#I'], { encoding: 'utf8', stdio: 'pipe' });
    const windows = out.trim().split('\n');
    if (!windows.includes(String(windowIndex))) {
      if (windows.length > 0) {
        targetWindow = parseInt(windows[0], 10);
      } else {
        execFileSync('tmux', ['new-window', '-t', safeSession, '-n', 'shell', INTERACTIVE_SHELL], { stdio: 'pipe' });
        targetWindow = 0;
      }
    }
  } catch {
    targetWindow = 0;
  }

  const actualKey = ptyKey(safeSession, targetWindow);
  if (ptyMap.has(actualKey)) return { key: actualKey, entry: ptyMap.get(actualKey) }; // reuse if fallback exists

  // 给老 window 补 history-limit（全局 set-option 只对启动 nexus 之后新建的 window 生效，
  // 预先存在的 window 仍是 tmux 默认 2000。对每个被 attach 的 pane 显式设一次）
  try {
    execFileSync('tmux', ['set-option', '-p', '-t', `${safeSession}:${targetWindow}`, 'history-limit', '50000'], { stdio: 'pipe' });
  } catch { /* 老版 tmux 可能不支持 -p，忽略 */ }

  let ptyProc;
  try {
    ptyProc = pty.spawn('tmux', ['attach-session', '-t', `${safeSession}:${targetWindow}`], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      env: { ...process.env, LANG: 'C.UTF-8', TERM: 'xterm-256color' },
    });
  } catch (err) {
    console.error(`pty.spawn failed for ${safeSession}:${targetWindow}:`, err.message);
    return { key: actualKey, entry: { pty: null, clients: new Set(), clientSizes: new Map(), lastOutput: '', lastActivity: Date.now() } };
  }

  const entry = { pty: ptyProc, clients: new Set(), clientSizes: new Map(), lastSnapshot: '', lastActivity: Date.now() };
  ptyMap.set(actualKey, entry);

  // 只转发 PTY 里的 control 码（DEC mode、OSC、应用键盘模式）——这些 xterm.js 需要才能正确处理 mouse/alt-screen/title 等。
  // 不转发 cell 写入（文本/cursor 定位/SGR/erase），全部交由 snapshot 用 canonical state 推送，避免 diff 鬼影。
  ptyProc.onData((data) => {
    const ent = ptyMap.get(actualKey);
    if (!ent) return;
    ent.lastActivity = Date.now();
    const control = extractControlSequences(data);
    if (control) {
      for (const ws of ent.clients) {
        if (ws.readyState === 1) ws.send(control);
      }
    }
    scheduleSnapshot(ent, actualKey);
  });

  ptyProc.onExit(({ exitCode }) => {
    console.log(`PTY ${actualKey} exited with code ${exitCode}`);
    ptyMap.delete(actualKey);
    // 如果 window 还在，重新创建
    try {
      const list = execFileSync('tmux', ['list-windows', '-t', safeSession, '-F', '#I'], { encoding: 'utf8', stdio: 'pipe' }).trim().split('\n');
      if (list.includes(String(targetWindow))) {
        setTimeout(() => ensureWindowPty(safeSession, targetWindow), 100);
      }
    } catch {}
  });

  return { key: actualKey, entry };
}

// 从 PTY 字节流里挑出 xterm.js 必须感知的 control 码：DEC private mode (h/l)、OSC、ESC=/ESC>。
// 跳过 cell 写入（文本/CSI 光标定位/SGR/erase）——那些用 snapshot 覆盖。
function extractControlSequences(s) {
  if (!s || s.indexOf('\x1b') < 0) return ''
  const out = []
  let i = 0
  while (i < s.length) {
    if (s.charCodeAt(i) !== 0x1b) { i++; continue }
    const next = s.charCodeAt(i + 1)
    if (Number.isNaN(next)) break
    if (next === 0x5b) { // CSI: ESC [
      let j = i + 2
      let priv = 0
      const pc = s.charCodeAt(j)
      if (pc === 0x3f || pc === 0x3e || pc === 0x3c || pc === 0x21) { priv = pc; j++ }
      while (j < s.length) { const c = s.charCodeAt(j); if ((c >= 0x30 && c <= 0x39) || c === 0x3b) j++; else break }
      while (j < s.length) { const c = s.charCodeAt(j); if (c >= 0x20 && c <= 0x2f) j++; else break }
      if (j >= s.length) { i++; continue }
      const final = s.charCodeAt(j)
      // 只保留 DEC private h/l（mode set/reset），其它 CSI（光标/SGR/erase）丢弃
      if (priv === 0x3f && (final === 0x68 || final === 0x6c)) {
        out.push(s.slice(i, j + 1))
      }
      i = j + 1
    } else if (next === 0x5d) { // OSC: ESC ]
      let j = i + 2
      while (j < s.length) {
        const c = s.charCodeAt(j)
        if (c === 0x07) { j++; break }
        if (c === 0x1b && s.charCodeAt(j + 1) === 0x5c) { j += 2; break }
        j++
      }
      out.push(s.slice(i, j))
      i = j
    } else if (next === 0x3d || next === 0x3e) { // ESC = (DECKPAM) / ESC > (DECKPNM)
      out.push(s.slice(i, i + 2))
      i += 2
    } else {
      i++
    }
  }
  return out.join('')
}

// 抓 tmux pane 当前 state（cell 内容 + cursor 位置）拼成完整 frame 推给 ws，覆盖 diff 转发可能留下的鬼影。
function snapshotAndSend(ent, key, done) {
  const cursorP = new Promise((r) => {
    exec(`tmux display-message -p -t '${key}' '#{cursor_x},#{cursor_y}' 2>/dev/null`, (e, o) => r(e ? null : (o || '').trim()))
  })
  const captureP = new Promise((r) => {
    exec(`tmux capture-pane -e -p -t '${key}' 2>/dev/null`, { maxBuffer: 1024 * 1024 }, (e, o) => r(e ? null : o))
  })
  Promise.all([cursorP, captureP]).then(([cursor, content]) => {
    if (content) {
      const lines = content.replace(/\n+$/, '').split('\n')
      const [cx, cy] = (cursor || '0,0').split(',').map(n => parseInt(n, 10) || 0)
      const frame = '\x1b[0m\x1b[H'
                  + lines.map(l => l + '\x1b[K').join('\r\n')
                  + `\x1b[${cy + 1};${cx + 1}H`
      ent.lastSnapshot = frame
      for (const ws of ent.clients) {
        if (ws.readyState === 1) ws.send(frame)
      }
    }
    if (done) done()
  })
}

// 「连续触发 + coalesce」：每次 PTY 输出都想 snap。前一个 snap 还在 exec 时就排一次 pending，
// 完成后立刻起下一个；不引入人为 throttle 等待，把鬼影窗口压缩到 capture-pane exec 本身（~10-30ms）。
function scheduleSnapshot(ent, key) {
  if (ent._snapInFlight) { ent._snapPending = true; return }
  ent._snapInFlight = true
  snapshotAndSend(ent, key, () => {
    ent._snapInFlight = false
    if (ent._snapPending) {
      ent._snapPending = false
      scheduleSnapshot(ent, key)
    }
  })
}

// WebSocket 服务 — 支持 /ws?token=xxx&window=<index>
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const token = url.searchParams.get('token');
  const windowParam = url.searchParams.get('window') || '0';
  const windowIndex = parseInt(windowParam, 10) || 0;
  const session = url.searchParams.get('session') || TMUX_SESSION;

  try {
    jwt.verify(token, JWT_SECRET);
  } catch {
    ws.close(4001, 'unauthorized');
    return;
  }

  const { key, entry } = ensureWindowPty(session, windowIndex);
  entry.clients.add(ws);
  console.log(`Client connected to ${key} (clients: ${entry.clients.size})`);

  // 立刻发上一次的快照（如果有），避免空白屏；同时立即触发新一次 snapshot 拿最新 state
  if (entry.lastSnapshot) ws.send(entry.lastSnapshot);
  scheduleSnapshot(entry, key);

  ws.on('message', (msg) => {
    const ent = ptyMap.get(key);
    if (!ent) return;
    const str = typeof msg === 'string' ? msg : msg.toString();
    let isResize = false;
    try {
      const data = JSON.parse(str);
      if (data && data.type === 'resize' && data.cols && data.rows) {
        isResize = true;
        const newCols = Number(data.cols);
        const newRows = Number(data.rows);
        ent.clientSizes.set(ws, { cols: newCols, rows: newRows });
        ent.pty.resize(Math.max(newCols, 10), Math.max(newRows, 5));
      }
    } catch { /* not JSON — fall through to pty.write */ }
    if (!isResize) ent.pty.write(str);
    // resize 和用户输入都会触发 PTY 输出，而 onData 会自然触发 snapshot。
    // 这里不再额外调度——避免重复请求。
  });

  ws.on('close', () => {
    const ent = ptyMap.get(key);
    if (ent) {
      ent.clients.delete(ws);
      ent.clientSizes.delete(ws);
      console.log(`Client disconnected from ${key} (clients: ${ent.clients.size})`);
      // Recompute minimum size if other clients remain
      if (ent.clients.size > 0 && ent.clientSizes.size > 0) {
        let minCols = Infinity, minRows = Infinity;
        for (const [, size] of ent.clientSizes) {
          if (size.cols < minCols) minCols = size.cols;
          if (size.rows < minRows) minRows = size.rows;
        }
        if (minCols !== Infinity) ent.pty.resize(Math.max(minCols, 10), Math.max(minRows, 5));
      }
      // 如果 5 分钟后没有客户端，清理 PTY 节省资源
      setTimeout(() => {
        const e = ptyMap.get(key);
        if (e && e.clients.size === 0 && Date.now() - e.lastActivity > 300000) {
          e.pty.kill();
          ptyMap.delete(key);
          console.log(`PTY ${key} cleaned up (idle)`);
        }
      }, 300000);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
    const ent = ptyMap.get(key);
    if (ent) { ent.clients.delete(ws); ent.clientSizes.delete(ws); }
  });
});

// 启动时清理残留的 running 状态（服务重启导致的孤儿任务）
try {
  const staleTasks = loadTasks()
  let changed = false
  for (const t of staleTasks) {
    if (t.status === 'running') {
      t.status = 'error'
      t.error = '(服务重启，任务中断)'
      t.completedAt = new Date().toISOString()
      changed = true
    }
  }
  if (changed) saveTasks(staleTasks)
} catch {}

server.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Nexus listening on :${PORT}`);
  console.log(`tmux session: ${TMUX_SESSION}`);
  console.log(`workspace: ${WORKSPACE_ROOT}`);
  // 启动时确保默认 tmux session 存在，窗口名使用 WORKSPACE_ROOT 的目录名
  try {
    const defaultWindowName = WORKSPACE_ROOT.replace(/^\/+|\/+$/, '').split('/').pop() || '~'
    execSync(`tmux has-session -t ${TMUX_SESSION} 2>/dev/null || tmux new-session -d -s ${TMUX_SESSION} -n "${defaultWindowName}" -c "${WORKSPACE_ROOT}" "${INTERACTIVE_SHELL}"`);
    // 提升 tmux server 全局 scrollback 上限（影响后续新建的 window；已存在的 buffer 不变）
    execSync('tmux set-option -g history-limit 50000');
    console.log(`tmux session '${TMUX_SESSION}' ready (history-limit=50000)`);
  } catch (e) { console.warn('tmux session init failed:', e.message); }

  // Snapshot 恢复：对 snapshot 里 tmux 中不存在的 project/channel 按 spec 重建
  // 对电脑重启、tmux kill-server 等场景自动恢复
  try { restoreFromSnapshot() } catch (e) { console.warn('[Snapshot] restore failed:', e.message) }

  // 定期 reconcile：同步 claude session-id，剔除已删除 window；不改变 session 骨架
  setInterval(() => {
    try { reconcileSnapshot() } catch (e) { console.warn('[Snapshot] reconcile failed:', e.message) }
  }, 60 * 1000)
});
