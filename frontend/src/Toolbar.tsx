import { useState, useRef, useEffect, RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import { KeyDef, ToolbarConfig, ALL_KEYS, FACTORY_CONFIG } from './toolbarDefaults'

interface Props {
  token: string
  sendToWs: (data: string) => void
  scrollToBottom: () => void
  termRef: RefObject<Terminal | null>
  onOpenSessions: () => void
}

const KEY_MAP = Object.fromEntries(ALL_KEYS.map(k => [k.id, k]))

const CONFIG_KEY = 'nexus_toolbar_v2'
const USER_DEFAULT_KEY = 'nexus_toolbar_default'
const COLLAPSED_KEY = 'nexus_toolbar_collapsed'

function loadConfig(): ToolbarConfig {
  try {
    const s = localStorage.getItem(CONFIG_KEY)
    if (s) return JSON.parse(s)
  } catch {}
  try {
    const d = localStorage.getItem(USER_DEFAULT_KEY)
    if (d) return JSON.parse(d)
  } catch {}
  return { pinned: [...FACTORY_CONFIG.pinned], expanded: [...FACTORY_CONFIG.expanded] }
}

function loadDefault(): ToolbarConfig {
  try {
    const d = localStorage.getItem(USER_DEFAULT_KEY)
    if (d) return JSON.parse(d)
  } catch {}
  return { pinned: [...FACTORY_CONFIG.pinned], expanded: [...FACTORY_CONFIG.expanded] }
}

// ---- 拖拽状态 ----
interface DragState {
  section: 'pinned' | 'expanded'
  fromIdx: number
  toIdx: number
  startY: number
  currentY: number
}

const ITEM_HEIGHT = 48 // px，每行编辑项高度

export default function Toolbar({ token, sendToWs, scrollToBottom, onOpenSessions }: Props) {
  const [config, setConfig]           = useState<ToolbarConfig>(loadConfig)
  const [collapsed, setCollapsed]     = useState(() => localStorage.getItem(COLLAPSED_KEY) === 'true')
  const [editing, setEditing]         = useState(false)
  const [drag, setDrag]               = useState<DragState | null>(null)
  const [savedFlash, setSavedFlash]   = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const editScrollRef = useRef<HTMLDivElement>(null)

  const existsUserDefault = !!localStorage.getItem(USER_DEFAULT_KEY)

  // 启动时从服务端拉取配置，覆盖 localStorage 缓存
  useEffect(() => {
    fetch('/api/toolbar-config', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.pinned && data.expanded) {
          setConfig(data)
          localStorage.setItem(CONFIG_KEY, JSON.stringify(data))
        }
      })
      .catch(() => {})
  }, [])

  // 根元素：阻止 touchstart 默认行为，防止键盘弹出。
  // 但滚动区及其子元素（含拖拽手柄）跳过 preventDefault，
  // 让浏览器正常处理滚动，也让 React 合成事件能到达 drag handle。
  // editing 变化时重新注册，因为元素会切换（container ↔ editPanel）。
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const prevent = (e: TouchEvent) => {
      if (editScrollRef.current?.contains(e.target as Node)) return
      e.preventDefault()
    }
    el.addEventListener('touchstart', prevent, { passive: false })
    return () => el.removeEventListener('touchstart', prevent)
  }, [editing])

  function saveConfig(c: ToolbarConfig) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c))
    fetch('/api/toolbar-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(c),
    }).catch(() => {})
  }

  function updateConfig(next: ToolbarConfig) { setConfig(next); saveConfig(next) }

  async function handleKey(key: KeyDef) {
    if (key.action === 'scrollToBottom') {
      scrollToBottom()
    } else if (key.action === 'pasteClipboard') {
      try {
        const text = await navigator.clipboard.readText()
        if (text) sendToWs(text)
      } catch {
        // clipboard access denied or unavailable
      }
    } else {
      sendToWs(key.seq)
    }
  }

  function removeKey(section: 'pinned' | 'expanded', id: string) {
    updateConfig({ ...config, [section]: config[section].filter(k => k !== id) })
  }

  function addKey(section: 'pinned' | 'expanded', id: string) {
    if (config[section].includes(id)) return
    updateConfig({ ...config, [section]: [...config[section], id] })
  }

  function resetConfig() {
    updateConfig(loadDefault())
  }

  function saveAsDefault() {
    localStorage.setItem(USER_DEFAULT_KEY, JSON.stringify(config))
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1500)
  }

  // ---- 拖拽逻辑 ----
  function onDragStart(section: 'pinned' | 'expanded', idx: number, clientY: number) {
    setDrag({ section, fromIdx: idx, toIdx: idx, startY: clientY, currentY: clientY })
  }

  function onDragMove(clientY: number) {
    if (!drag) return
    const delta = clientY - drag.startY
    const shift = Math.round(delta / ITEM_HEIGHT)
    const len = config[drag.section].length
    const toIdx = Math.max(0, Math.min(len - 1, drag.fromIdx + shift))
    setDrag(prev => prev ? { ...prev, currentY: clientY, toIdx } : null)
  }

  function onDragEnd() {
    if (!drag || drag.fromIdx === drag.toIdx) { setDrag(null); return }
    const arr = [...config[drag.section]]
    const [item] = arr.splice(drag.fromIdx, 1)
    arr.splice(drag.toIdx, 0, item)
    updateConfig({ ...config, [drag.section]: arr })
    setDrag(null)
  }

  // 拖拽中预览排列
  function getDisplayIds(section: 'pinned' | 'expanded'): string[] {
    if (!drag || drag.section !== section) return config[section]
    const arr = [...config[section]]
    const [item] = arr.splice(drag.fromIdx, 1)
    arr.splice(drag.toIdx, 0, item)
    return arr
  }

  const usedIds = new Set([...config.pinned, ...config.expanded])
  const availableKeys = ALL_KEYS.filter(k => !usedIds.has(k.id))

  // ---- 渲染按键 ----
  function renderKeys(ids: string[]) {
    return (
      <div style={s.row}>
        {ids.map(id => {
          const key = KEY_MAP[id]
          if (!key) return null
          return (
            <button
              key={id}
              style={s.key}
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); handleKey(key) }}
            >
              {key.label}
            </button>
          )
        })}
      </div>
    )
  }

  // ---- 编辑面板 ----
  if (editing) {
    return (
      <div ref={rootRef} style={s.editPanel}>
        {/* 头部 */}
        <div style={s.editHeader}>
          <div>
            <span style={s.editTitle}>工具栏编辑</span>
            <div style={s.editHint}>
              {existsUserDefault ? '将恢复到您保存的默认配置' : '将恢复到出厂配置'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onPointerDown={(e) => { e.preventDefault(); resetConfig() }} style={s.editBtnSm}>重置</button>
            <button
              onPointerDown={(e) => { e.preventDefault(); saveAsDefault() }}
              style={savedFlash ? { ...s.editBtnSm, color: '#4ade80', borderColor: '#4ade80' } : s.editBtnSm}
            >
              {savedFlash ? '已保存' : '存为默认'}
            </button>
            <button onPointerDown={(e) => { e.preventDefault(); setEditing(false) }} style={s.editBtnPrimary}>完成</button>
          </div>
        </div>

        {/* 列表 */}
        <div ref={editScrollRef} style={s.editScroll}>
          {(['pinned', 'expanded'] as const).map(section => (
            <div key={section} style={s.editSection}>
              <div style={s.editSectionTitle}>
                {section === 'pinned' ? '📌 固定行（始终显示）' : '📂 展开区'}
              </div>
              {getDisplayIds(section).map((id, idx) => {
                const key = KEY_MAP[id]
                if (!key) return null
                const isDragging = drag?.section === section && drag.toIdx === idx && drag.fromIdx !== idx
                const isSource   = drag?.section === section && drag.fromIdx === idx && drag.fromIdx !== drag.toIdx
                return (
                  <div
                    key={id}
                    style={{
                      ...s.editRow,
                      ...(isDragging ? s.editRowTarget : {}),
                      ...(isSource   ? s.editRowSource : {}),
                    }}
                  >
                    {/* 拖拽手柄 */}
                    <div
                      style={s.dragHandle}
                      onTouchStart={(e) => onDragStart(section, idx, e.touches[0].clientY)}
                      onTouchMove={(e) => onDragMove(e.touches[0].clientY)}
                      onTouchEnd={() => onDragEnd()}
                    >
                      ☰
                    </div>
                    <span style={s.editLabel}>{key.label}</span>
                    <span style={s.editDesc}>{key.desc}</span>
                    <button
                      style={s.removeBtn}
                      onPointerDown={(e) => { e.preventDefault(); removeKey(section, id) }}
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          ))}

          {/* 可添加 */}
          {availableKeys.length > 0 && (
            <div style={s.editSection}>
              <div style={s.editSectionTitle}>➕ 可添加</div>
              {availableKeys.map(key => (
                <div key={key.id} style={s.editRow}>
                  <span style={s.editLabel}>{key.label}</span>
                  <span style={s.editDesc}>{key.desc}</span>
                  <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', flexShrink: 0 }}>
                    <button style={s.addBtn} onPointerDown={(e) => { e.preventDefault(); addKey('pinned', key.id) }}>固定</button>
                    <button style={s.addBtn} onPointerDown={(e) => { e.preventDefault(); addKey('expanded', key.id) }}>展开</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ---- 正常工具栏 ----
  return (
    <div ref={rootRef} style={s.container}>
      <div style={s.topBar}>
        <button style={s.iconBtn} onPointerDown={(e) => { e.preventDefault(); setCollapsed(v => { const n = !v; localStorage.setItem(COLLAPSED_KEY, String(n)); return n }) }}>
          {collapsed ? '▲' : '▼'}
        </button>
        <button style={s.iconBtn} onPointerDown={(e) => { e.preventDefault(); setEditing(true) }}>✏</button>
        <button style={s.sessionsBtn} onPointerDown={(e) => { e.preventDefault(); onOpenSessions() }}>会话</button>
      </div>

      {renderKeys(config.pinned)}

      {!collapsed && (
        <div style={s.expandedRows}>
          {chunk(config.expanded, 8).map((row, i) => (
            <div key={i} style={s.row}>
              {row.map(id => {
                const key = KEY_MAP[id]
                if (!key) return null
                return (
                  <button
                    key={id}
                    style={s.key}
                    onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); handleKey(key) }}
                  >
                    {key.label}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

const s: Record<string, React.CSSProperties> = {
  container: {
    background: '#16213e',
    borderTop: '1px solid #334155',
    userSelect: 'none',
    flexShrink: 0,
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    padding: '3px 6px',
    gap: 4,
  },
  iconBtn: {
    background: 'transparent',
    border: 'none',
    color: '#64748b',
    cursor: 'pointer',
    fontSize: 14,
    padding: '4px 8px',
    borderRadius: 4,
  },
  sessionsBtn: {
    background: 'transparent',
    border: '1px solid #334155',
    borderRadius: 4,
    color: '#93c5fd',
    cursor: 'pointer',
    fontSize: 11,
    padding: '2px 8px',
    marginLeft: 'auto',
  },
  row: {
    display: 'flex',
    gap: 4,
    padding: '2px 6px',
    flexWrap: 'wrap',
  },
  expandedRows: { paddingBottom: 4 },
  key: {
    background: '#0f3460',
    border: '1px solid #334155',
    borderRadius: 6,
    color: '#e2e8f0',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'monospace',
    minWidth: 38,
    padding: '6px 7px',
    textAlign: 'center',
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
    flexShrink: 0,
  },
  // ---- 编辑面板 ----
  editPanel: {
    background: '#16213e',
    borderTop: '1px solid #334155',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '55vh',
  },
  editHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 10px',
    borderBottom: '1px solid #334155',
    flexShrink: 0,
  },
  editTitle: { color: '#e2e8f0', fontSize: 14, fontWeight: 600 },
  editHint: { color: '#475569', fontSize: 10, marginTop: 2 },
  editScroll: { overflowY: 'auto', flex: 1 },
  editSection: { marginBottom: 4 },
  editSectionTitle: {
    color: '#64748b',
    fontSize: 11,
    padding: '6px 10px 3px',
    letterSpacing: 0.5,
  },
  editRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '0 10px',
    height: ITEM_HEIGHT,
    gap: 8,
    borderBottom: '1px solid #1e293b',
    boxSizing: 'border-box',
  },
  editRowTarget: {
    background: '#1e3a5f',
    borderColor: '#3b82f6',
  },
  editRowSource: {
    opacity: 0.35,
  },
  dragHandle: {
    color: '#475569',
    fontSize: 16,
    cursor: 'grab',
    padding: '8px 4px',
    flexShrink: 0,
    touchAction: 'none',
  },
  editLabel: {
    color: '#e2e8f0',
    fontFamily: 'monospace',
    fontSize: 13,
    minWidth: 48,
    flexShrink: 0,
  },
  editDesc: {
    color: '#64748b',
    fontSize: 11,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  removeBtn: {
    background: 'transparent',
    border: 'none',
    color: '#ef4444',
    cursor: 'pointer',
    fontSize: 18,
    padding: '0 2px',
    flexShrink: 0,
    lineHeight: 1,
  },
  addBtn: {
    background: '#0f3460',
    border: '1px solid #334155',
    borderRadius: 4,
    color: '#93c5fd',
    cursor: 'pointer',
    fontSize: 11,
    padding: '4px 8px',
  },
  editBtnSm: {
    background: 'transparent',
    border: '1px solid #334155',
    borderRadius: 4,
    color: '#64748b',
    cursor: 'pointer',
    fontSize: 12,
    padding: '4px 10px',
  },
  editBtnPrimary: {
    background: '#3b82f6',
    border: 'none',
    borderRadius: 4,
    color: '#fff',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    padding: '4px 12px',
  },
}
