import { useState, useEffect } from 'react'

interface TmuxWindow {
  index: number
  name: string
  active: boolean
}

interface Config {
  id: string
  label: string
  BASE_URL?: string
  AUTH_TOKEN?: string
  API_KEY?: string
  DEFAULT_MODEL?: string
  THINK_MODEL?: string
  LONG_CONTEXT_MODEL?: string
  DEFAULT_HAIKU_MODEL?: string
  API_TIMEOUT_MS?: string
}

interface Props {
  token: string
  sendToWs: (data: string) => void
  onClose: () => void
  onLogout: () => void
}

const EMPTY_CONFIG: Omit<Config, 'id'> = {
  label: '',
  BASE_URL: '',
  AUTH_TOKEN: '',
  API_KEY: '',
  DEFAULT_MODEL: '',
  THINK_MODEL: '',
  LONG_CONTEXT_MODEL: '',
  DEFAULT_HAIKU_MODEL: '',
  API_TIMEOUT_MS: '3000000',
}

export default function SessionManager({ token, sendToWs, onClose, onLogout }: Props) {
  const [tab, setTab] = useState<'sessions' | 'configs'>('sessions')

  // ── 会话 tab 状态 ──
  const [windows, setWindows] = useState<TmuxWindow[]>([])
  const [loadingWin, setLoadingWin] = useState(false)
  const [winError, setWinError] = useState<string | null>(null)
  const [newPath, setNewPath] = useState('')
  const [newProfile, setNewProfile] = useState('')   // '' = 直接命令
  const [newCommand, setNewCommand] = useState('')
  const [creating, setCreating] = useState(false)

  // ── 配置 tab 状态 ──
  const [configs, setConfigs] = useState<Config[]>([])
  const [loadingCfg, setLoadingCfg] = useState(false)
  const [editingConfig, setEditingConfig] = useState<(Config & { isNew: boolean }) | null>(null)
  const [savingCfg, setSavingCfg] = useState(false)
  const [cfgError, setCfgError] = useState<string | null>(null)

  const headers = { Authorization: `Bearer ${token}` }

  async function fetchWindows() {
    setLoadingWin(true); setWinError(null)
    try {
      const r = await fetch('/api/sessions', { headers })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      setWindows(d.windows ?? [])
    } catch (e: unknown) {
      setWinError(e instanceof Error ? e.message : '加载失败')
    } finally { setLoadingWin(false) }
  }

  async function fetchConfigs() {
    setLoadingCfg(true)
    try {
      const r = await fetch('/api/configs', { headers })
      setConfigs(r.ok ? await r.json() : [])
    } catch { setConfigs([]) }
    finally { setLoadingCfg(false) }
  }

  useEffect(() => { fetchWindows() }, [])
  useEffect(() => { if (tab === 'configs') fetchConfigs() }, [tab])

  function switchToWindow(item: TmuxWindow) {
    sendToWs('\x02' + item.index.toString())
    onClose()
  }

  async function createSession() {
    if (!newPath.trim()) { setWinError('请输入路径'); return }
    setCreating(true); setWinError(null)
    try {
      const body: Record<string, string> = { rel_path: newPath.trim() }
      if (newProfile) body.profile = newProfile
      else if (newCommand.trim()) body.command = newCommand.trim()
      const r = await fetch('/api/sessions', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error ?? `HTTP ${r.status}`) }
      setNewPath(''); setNewCommand(''); setNewProfile('')
      await fetchWindows()
    } catch (e: unknown) {
      setWinError(e instanceof Error ? e.message : '创建失败')
    } finally { setCreating(false) }
  }

  async function saveConfig() {
    if (!editingConfig) return
    const { id, isNew, ...data } = editingConfig
    if (!id.trim() || !data.label.trim()) { setCfgError('ID 和名称不能为空'); return }
    setSavingCfg(true); setCfgError(null)
    try {
      const r = await fetch(`/api/configs/${id.trim()}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setEditingConfig(null)
      await fetchConfigs()
    } catch (e: unknown) {
      setCfgError(e instanceof Error ? e.message : '保存失败')
    } finally { setSavingCfg(false) }
  }

  async function deleteConfig(id: string) {
    try {
      await fetch(`/api/configs/${id}`, { method: 'DELETE', headers })
      await fetchConfigs()
    } catch { /* ignore */ }
  }

  // ── 配置编辑面板 ──
  if (editingConfig) {
    const fields: Array<{ key: keyof typeof EMPTY_CONFIG; label: string; placeholder: string; secret?: boolean }> = [
      { key: 'label',              label: '显示名称',      placeholder: 'Kimi (kimi-for-coding)' },
      { key: 'BASE_URL',           label: 'API Base URL',  placeholder: 'https://api.kimi.com/coding' },
      { key: 'AUTH_TOKEN',         label: 'Auth Token',    placeholder: 'sk-...', secret: true },
      { key: 'API_KEY',            label: 'API Key',       placeholder: '（通常留空，用 Auth Token）', secret: true },
      { key: 'DEFAULT_MODEL',      label: '默认模型',      placeholder: 'kimi-for-coding' },
      { key: 'THINK_MODEL',        label: '思考模型',      placeholder: 'kimi-for-coding' },
      { key: 'LONG_CONTEXT_MODEL', label: '长上下文模型',  placeholder: 'kimi-for-coding' },
      { key: 'DEFAULT_HAIKU_MODEL',label: 'Haiku 模型',   placeholder: 'kimi-for-coding' },
      { key: 'API_TIMEOUT_MS',     label: 'Timeout (ms)',  placeholder: '3000000' },
    ]
    return (
      <div style={s.overlay}>
        <div style={s.panel}>
          <div style={s.header}>
            <span style={s.title}>{editingConfig.isNew ? '新建配置' : '编辑配置'}</span>
            <button style={s.closeBtn} onPointerDown={() => { setEditingConfig(null); setCfgError(null) }}>×</button>
          </div>
          <div style={s.scrollArea}>
            <div style={s.section}>
              {cfgError && <div style={s.errorMsg}>{cfgError}</div>}
              {/* ID 字段只在新建时可编辑 */}
              <div style={s.formRow}>
                <label style={s.label}>配置 ID（唯一标识）</label>
                <input
                  style={{ ...s.input, ...(editingConfig.isNew ? {} : s.inputDisabled) }}
                  value={editingConfig.id}
                  readOnly={!editingConfig.isNew}
                  onChange={e => setEditingConfig(c => c && { ...c, id: e.target.value.replace(/[^a-z0-9_-]/gi, '-').toLowerCase() })}
                  placeholder="kimi"
                  autoCapitalize="off" autoCorrect="off" spellCheck={false}
                />
              </div>
              {fields.map(f => (
                <div key={f.key} style={s.formRow}>
                  <label style={s.label}>{f.label}</label>
                  <input
                    style={s.input}
                    type={f.secret ? 'password' : 'text'}
                    value={(editingConfig as unknown as Record<string, string>)[f.key] ?? ''}
                    onChange={e => setEditingConfig(c => c && { ...c, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    autoCapitalize="off" autoCorrect="off" spellCheck={false}
                  />
                </div>
              ))}
              <button
                style={{ ...s.createBtn, ...(savingCfg ? s.createBtnDisabled : {}) }}
                onPointerDown={() => { if (!savingCfg) saveConfig() }}
                disabled={savingCfg}
              >
                {savingCfg ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={s.overlay}>
      <div style={s.panel}>
        {/* 顶部：标题 + 关闭 */}
        <div style={s.header}>
          <span style={s.title}>Agent 管理</span>
          <button style={s.closeBtn} onPointerDown={onClose}>×</button>
        </div>

        {/* Tab 切换 */}
        <div style={s.tabBar}>
          <button
            style={{ ...s.tabBtn, ...(tab === 'sessions' ? s.tabBtnActive : {}) }}
            onPointerDown={() => setTab('sessions')}
          >会话</button>
          <button
            style={{ ...s.tabBtn, ...(tab === 'configs' ? s.tabBtnActive : {}) }}
            onPointerDown={() => setTab('configs')}
          >配置</button>
        </div>

        {/* ── 会话 Tab ── */}
        {tab === 'sessions' && (
          <div style={s.scrollArea}>
            {/* 当前 window 列表 */}
            <div style={s.section}>
              <div style={s.sectionHeader}>
                <span style={s.sectionTitle}>当前会话</span>
                <button style={s.refreshBtn} onPointerDown={fetchWindows} disabled={loadingWin}>
                  {loadingWin ? '...' : '刷新'}
                </button>
              </div>
              {winError && <div style={s.errorMsg}>{winError}</div>}
              {windows.length === 0 && !loadingWin && <div style={s.emptyMsg}>暂无窗口</div>}
              {windows.map(item => (
                <div
                  key={item.index}
                  style={{ ...s.windowRow, ...(item.active ? s.windowRowActive : {}) }}
                  onPointerDown={() => switchToWindow(item)}
                >
                  <span style={s.windowIndex}>{item.index}</span>
                  <span style={s.windowName}>{item.name}</span>
                  {item.active && <span style={s.activeDot} />}
                </div>
              ))}
            </div>

            {/* 新建会话 */}
            <div style={s.section}>
              <div style={s.sectionTitle}>新建会话</div>
              <div style={s.formRow}>
                <label style={s.label}>路径（绝对路径或相对工作区）</label>
                <input
                  style={s.input}
                  value={newPath}
                  onChange={e => setNewPath(e.target.value)}
                  placeholder="/home/librae/myproject"
                  autoCapitalize="off" autoCorrect="off" spellCheck={false}
                />
              </div>
              <div style={s.formRow}>
                <label style={s.label}>配置 Profile（选择后自动以 claude 启动）</label>
                <select
                  style={s.select}
                  value={newProfile}
                  onChange={e => setNewProfile(e.target.value)}
                >
                  <option value="">— 直接命令 —</option>
                  {configs.length === 0 && <option disabled>（暂无配置，请先在「配置」Tab 新建）</option>}
                  {configs.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              {!newProfile && (
                <div style={s.formRow}>
                  <label style={s.label}>命令（留空使用 sh）</label>
                  <input
                    style={s.input}
                    value={newCommand}
                    onChange={e => setNewCommand(e.target.value)}
                    placeholder="bash / sh / claude"
                    autoCapitalize="off" autoCorrect="off" spellCheck={false}
                  />
                </div>
              )}
              {newProfile && (
                <div style={s.hint}>
                  将以 <code style={s.code}>claude -c --dangerously-skip-permissions</code> 启动，
                  自动续接上次会话。历史保存在 <code style={s.code}>{newPath || '项目路径'}/.claude-data/</code>
                </div>
              )}
              <button
                style={{ ...s.createBtn, ...(creating ? s.createBtnDisabled : {}) }}
                onPointerDown={() => { if (!creating) createSession() }}
                disabled={creating}
              >
                {creating ? '创建中...' : '创建'}
              </button>
            </div>

            {/* 退出登录 */}
            <div style={s.section}>
              <button style={s.logoutBtn} onPointerDown={onLogout}>退出登录</button>
            </div>
          </div>
        )}

        {/* ── 配置 Tab ── */}
        {tab === 'configs' && (
          <div style={s.scrollArea}>
            <div style={s.section}>
              <div style={s.sectionHeader}>
                <span style={s.sectionTitle}>API 配置 Profiles</span>
                <button
                  style={s.refreshBtn}
                  onPointerDown={() => setEditingConfig({ id: '', isNew: true, ...EMPTY_CONFIG })}
                >
                  + 新建
                </button>
              </div>
              {loadingCfg && <div style={s.emptyMsg}>加载中...</div>}
              {!loadingCfg && configs.length === 0 && (
                <div style={s.emptyMsg}>暂无配置。点击「+ 新建」添加 API 配置。</div>
              )}
              {configs.map(cfg => (
                <div key={cfg.id} style={s.configRow}>
                  <div style={s.configInfo}>
                    <div style={s.configLabel}>{cfg.label}</div>
                    <div style={s.configMeta}>{cfg.id} · {cfg.DEFAULT_MODEL || '—'}</div>
                  </div>
                  <div style={s.configActions}>
                    <button
                      style={s.editBtn}
                      onPointerDown={() => setEditingConfig({ id: cfg.id, isNew: false, label: cfg.label, BASE_URL: cfg.BASE_URL, AUTH_TOKEN: cfg.AUTH_TOKEN, API_KEY: cfg.API_KEY, DEFAULT_MODEL: cfg.DEFAULT_MODEL, THINK_MODEL: cfg.THINK_MODEL, LONG_CONTEXT_MODEL: cfg.LONG_CONTEXT_MODEL, DEFAULT_HAIKU_MODEL: cfg.DEFAULT_HAIKU_MODEL, API_TIMEOUT_MS: cfg.API_TIMEOUT_MS })}
                    >编辑</button>
                    <button
                      style={s.deleteBtn}
                      onPointerDown={() => deleteConfig(cfg.id)}
                    >删除</button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ ...s.section, color: '#475569', fontSize: 11, lineHeight: 1.6 }}>
              <div style={s.sectionTitle}>说明</div>
              <p>每个配置对应一个 API provider。新建会话时选择配置后，会以该 provider 的 API key 启动 claude，且每个项目的会话历史独立保存在项目目录的 <code style={s.code}>.claude-data/</code> 中，退出后再次进入可自动续接上下文。</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100 },
  panel: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: '#0f172a', display: 'flex', flexDirection: 'column', color: '#e2e8f0' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #334155', flexShrink: 0 },
  title: { fontSize: 16, fontWeight: 600 },
  closeBtn: { background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 24, lineHeight: 1, padding: '0 4px' },
  tabBar: { display: 'flex', borderBottom: '1px solid #334155', flexShrink: 0 },
  tabBtn: { flex: 1, background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 14, padding: '10px 0', borderBottom: '2px solid transparent' },
  tabBtnActive: { color: '#93c5fd', borderBottomColor: '#3b82f6' },
  scrollArea: { flex: 1, overflowY: 'auto', padding: '8px 0' },
  section: { padding: '12px 16px', borderBottom: '1px solid #1e293b' },
  sectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sectionTitle: { fontSize: 11, color: '#64748b', letterSpacing: 0.5, textTransform: 'uppercase' as const, marginBottom: 8 },
  refreshBtn: { background: 'transparent', border: '1px solid #334155', borderRadius: 4, color: '#94a3b8', cursor: 'pointer', fontSize: 11, padding: '2px 8px' },
  errorMsg: { color: '#f87171', fontSize: 12, marginBottom: 8 },
  emptyMsg: { color: '#475569', fontSize: 13, padding: '8px 0' },
  windowRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 6, marginBottom: 4, cursor: 'pointer', background: '#16213e', border: '1px solid #334155' },
  windowRowActive: { border: '1px solid #3b82f6', background: '#1e3a5f' },
  windowIndex: { color: '#64748b', fontFamily: 'monospace', fontSize: 13, minWidth: 20 },
  windowName: { color: '#e2e8f0', fontSize: 14, flex: 1 },
  activeDot: { width: 8, height: 8, borderRadius: '50%', background: '#4ade80', flexShrink: 0 },
  formRow: { display: 'flex', flexDirection: 'column' as const, gap: 4, marginBottom: 10 },
  label: { color: '#94a3b8', fontSize: 12 },
  input: { background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 14, padding: '8px 10px', outline: 'none', width: '100%', boxSizing: 'border-box' as const },
  inputDisabled: { opacity: 0.5 },
  select: { background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 14, padding: '8px 10px', outline: 'none', width: '100%', boxSizing: 'border-box' as const },
  hint: { color: '#64748b', fontSize: 11, marginBottom: 10, lineHeight: 1.6 },
  code: { background: '#1e293b', borderRadius: 3, padding: '1px 4px', fontFamily: 'monospace', fontSize: 10, color: '#93c5fd' },
  createBtn: { background: '#3b82f6', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600, padding: '10px 20px', width: '100%' },
  createBtnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  logoutBtn: { background: 'transparent', border: '1px solid #334155', borderRadius: 6, color: '#94a3b8', cursor: 'pointer', fontSize: 14, padding: '10px 20px', width: '100%' },
  configRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #1e293b' },
  configInfo: { flex: 1 },
  configLabel: { color: '#e2e8f0', fontSize: 14 },
  configMeta: { color: '#64748b', fontSize: 11, marginTop: 2, fontFamily: 'monospace' },
  configActions: { display: 'flex', gap: 6, flexShrink: 0 },
  editBtn: { background: 'transparent', border: '1px solid #334155', borderRadius: 4, color: '#93c5fd', cursor: 'pointer', fontSize: 11, padding: '3px 8px' },
  deleteBtn: { background: 'transparent', border: '1px solid #334155', borderRadius: 4, color: '#f87171', cursor: 'pointer', fontSize: 11, padding: '3px 8px' },
}
