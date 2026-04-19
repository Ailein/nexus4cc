import { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { Icon } from './icons'

export interface HistoryItem {
  kind: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image'
  text?: string
  truncated?: boolean
  totalLen?: number
  name?: string
  id?: string
  input?: unknown
  toolUseId?: string
  isError?: boolean
}

export interface HistoryMessage {
  role: 'user' | 'assistant'
  ts: string | null
  items: HistoryItem[]
}

interface HistoryResponse {
  kind: 'claude' | 'none'
  sessionId?: string
  cwd?: string
  shellType?: string | null
  messages?: HistoryMessage[]
  reason?: string
}

interface Props {
  token: string
  tmuxSession: string
  windowIndex: number
  onNoHistory?: () => void
}

const CLIENT_TRUNCATE_LEN = 800

// One-time marked config
marked.setOptions({ gfm: true, breaks: true })

const MARKDOWN_SANITIZE = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'em', 'del', 'a', 'code', 'pre',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'blockquote', 'hr',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ] as string[],
  ALLOWED_ATTR: ['href', 'title', 'target', 'rel'] as string[],
  ALLOW_DATA_ATTR: false,
}

const MARKDOWN_CLASSES =
  'markdown-body text-[14px] leading-relaxed text-nexus-text break-words ' +
  '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ' +
  '[&_h1]:text-[1.3em] [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:pb-0.5 [&_h1]:border-b [&_h1]:border-nexus-border ' +
  '[&_h2]:text-[1.2em] [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:pb-0.5 [&_h2]:border-b [&_h2]:border-nexus-border ' +
  '[&_h3]:text-[1.1em] [&_h3]:font-semibold [&_h3]:mt-2.5 [&_h3]:mb-1 ' +
  '[&_h4]:font-semibold [&_h4]:mt-2 [&_h4]:mb-1 ' +
  '[&_p]:my-1.5 [&_p]:leading-relaxed ' +
  '[&_ul]:my-1.5 [&_ul]:pl-5 [&_ul]:list-disc ' +
  '[&_ol]:my-1.5 [&_ol]:pl-5 [&_ol]:list-decimal ' +
  '[&_li]:my-0.5 ' +
  '[&_blockquote]:my-2 [&_blockquote]:pl-3 [&_blockquote]:border-l-2 [&_blockquote]:border-nexus-accent/60 [&_blockquote]:text-nexus-text/70 [&_blockquote]:italic ' +
  '[&_code]:font-mono [&_code]:text-[0.875em] [&_code]:bg-nexus-bg-2 [&_code]:px-1 [&_code]:py-[1px] [&_code]:rounded [&_code]:text-[color:var(--nexus-accent)] ' +
  '[&_pre]:my-2 [&_pre]:p-3 [&_pre]:bg-nexus-bg-2 [&_pre]:rounded-md [&_pre]:overflow-x-auto [&_pre]:text-[13px] [&_pre]:leading-[1.5] ' +
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:rounded-none [&_pre_code]:text-nexus-text ' +
  '[&_hr]:my-3 [&_hr]:border-nexus-border ' +
  '[&_a]:text-nexus-accent [&_a]:underline ' +
  '[&_strong]:font-semibold ' +
  '[&_table]:w-full [&_table]:border-collapse [&_table]:my-2 [&_table]:text-[13px] ' +
  '[&_th]:border [&_th]:border-nexus-border [&_th]:bg-nexus-bg-2 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left ' +
  '[&_td]:border [&_td]:border-nexus-border [&_td]:px-2 [&_td]:py-1'

function renderMarkdown(src: string): string {
  const raw = marked.parse(src, { async: false }) as string
  return DOMPurify.sanitize(raw, MARKDOWN_SANITIZE)
}

export default function ChatHistoryView({ token, tmuxSession, windowIndex, onNoHistory }: Props) {
  const [data, setData] = useState<HistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const onNoHistoryRef = useRef(onNoHistory)
  useEffect(() => { onNoHistoryRef.current = onNoHistory }, [onNoHistory])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/sessions/${windowIndex}/history?session=${encodeURIComponent(tmuxSession)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d: HistoryResponse) => {
        if (cancelled) return
        setData(d)
        setLoading(false)
        if (d.kind === 'none') onNoHistoryRef.current?.()
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [token, tmuxSession, windowIndex])

  if (loading) return <CenterMessage text="加载对话..." />
  if (error) return <CenterMessage text={`加载失败：${error}`} error />
  if (!data || data.kind === 'none') {
    return <CenterMessage text="未找到当前窗口的 claude 对话。" sub={data?.reason} />
  }
  const messages = data.messages ?? []
  if (messages.length === 0) return <CenterMessage text="会话尚无消息。" />

  return (
    <div className="flex flex-col gap-5 py-4 px-3 max-w-3xl mx-auto">
      {messages.map((m, i) => <MessageRow key={i} message={m} />)}
      <div className="text-center text-nexus-muted text-[11px] py-2 border-t border-nexus-border/40 mt-2 pt-3">— 会话顶部 —</div>
    </div>
  )
}

function CenterMessage({ text, sub, error }: { text: string; sub?: string; error?: boolean }) {
  return (
    <div className="text-center py-10 px-4">
      <div className={`text-sm ${error ? 'text-nexus-error' : 'text-nexus-text-2'}`}>{text}</div>
      {sub && <div className="text-nexus-muted text-xs mt-1">{sub}</div>}
    </div>
  )
}

function formatTs(ts: string | null): string {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    if (Number.isNaN(d.getTime())) return ts
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const mo = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${mo}-${dd} ${hh}:${mm}`
  } catch { return ts }
}

function MessageRow({ message }: { message: HistoryMessage }) {
  const isUser = message.role === 'user'
  // 如果 user message 只含 tool_result / image（没文本），不显示 "You" 头，
  // 直接把每个 tool_result 作为独立块渲染（工具输出的语义上属于前一条 assistant）
  const hasText = message.items.some(it => it.kind === 'text' || it.kind === 'thinking')
  if (isUser && !hasText) {
    return (
      <div className="flex flex-col gap-2 pl-8">
        {message.items.map((it, i) => <ItemView key={i} item={it} />)}
      </div>
    )
  }

  if (isUser) {
    // 有文字的用户消息：左侧蓝色竖条
    return (
      <div className="flex gap-3">
        <div className="shrink-0 w-0.5 rounded-full bg-nexus-accent" />
        <div className="min-w-0 flex-1 flex flex-col gap-1.5">
          <div className="text-[11px] text-nexus-muted font-medium">
            You{message.ts && <span className="ml-2 font-normal">· {formatTs(message.ts)}</span>}
          </div>
          {message.items.map((it, i) => <ItemView key={i} item={it} />)}
        </div>
      </div>
    )
  }

  // Assistant
  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-5 flex items-start justify-center pt-[3px]">
        <span className="text-[15px] leading-none" style={{ color: '#fb923c' }}>⏺</span>
      </div>
      <div className="min-w-0 flex-1 flex flex-col gap-2">
        <div className="text-[11px] text-nexus-muted font-medium">
          Claude{message.ts && <span className="ml-2 font-normal">· {formatTs(message.ts)}</span>}
        </div>
        {message.items.map((it, i) => <ItemView key={i} item={it} />)}
      </div>
    </div>
  )
}

function ItemView({ item }: { item: HistoryItem }) {
  switch (item.kind) {
    case 'text':
      return <TextBlock text={item.text ?? ''} serverTruncated={!!item.truncated} totalLen={item.totalLen ?? 0} />
    case 'thinking':
      return <ThinkingBlock text={item.text ?? ''} serverTruncated={!!item.truncated} totalLen={item.totalLen ?? 0} />
    case 'tool_use':
      return <ToolUseBlock name={item.name ?? ''} input={item.input} />
    case 'tool_result':
      return <ToolResultBlock text={item.text ?? ''} serverTruncated={!!item.truncated} totalLen={item.totalLen ?? 0} isError={!!item.isError} />
    case 'image':
      return <div className="text-nexus-muted text-xs italic">[图片]</div>
    default:
      return null
  }
}

function TextBlock({ text, serverTruncated, totalLen }: { text: string; serverTruncated: boolean; totalLen: number }) {
  const [expanded, setExpanded] = useState(false)
  const clientShouldTruncate = text.length > CLIENT_TRUNCATE_LEN
  const display = expanded || !clientShouldTruncate ? text : text.slice(0, CLIENT_TRUNCATE_LEN)
  const html = useMemo(() => renderMarkdown(display), [display])
  return (
    <div>
      <div className={MARKDOWN_CLASSES} dangerouslySetInnerHTML={{ __html: html }} />
      {clientShouldTruncate && !expanded && (
        <button
          className="mt-1.5 text-nexus-accent bg-transparent border-none cursor-pointer text-xs underline px-0"
          onClick={() => setExpanded(true)}
        >展开（{text.length - CLIENT_TRUNCATE_LEN} 字）</button>
      )}
      {serverTruncated && expanded && (
        <div className="text-[11px] text-nexus-muted mt-1">（服务端已截断，完整 {totalLen} 字未加载）</div>
      )}
    </div>
  )
}

function ThinkingBlock({ text, serverTruncated, totalLen }: { text: string; serverTruncated: boolean; totalLen: number }) {
  const [open, setOpen] = useState(false)
  const html = useMemo(() => (open ? renderMarkdown(text) : ''), [open, text])
  return (
    <div className="rounded border border-nexus-border/60 overflow-hidden">
      <button
        className="w-full text-left bg-transparent border-none cursor-pointer px-2 py-1 text-xs flex items-center gap-1.5 text-nexus-muted italic"
        onClick={() => setOpen(!open)}
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
        <span>∴ 思考</span>
        {!open && <span className="truncate flex-1 not-italic">{(text.split('\n').find(l => l.trim()) ?? '').slice(0, 60)}</span>}
      </button>
      {open && (
        <div className="px-3 py-2 bg-nexus-bg-2/30">
          <div className={`${MARKDOWN_CLASSES} opacity-70 italic`} dangerouslySetInnerHTML={{ __html: html }} />
          {serverTruncated && <div className="text-[10px] text-nexus-muted mt-1">（服务端已截断，完整 {totalLen} 字未加载）</div>}
        </div>
      )}
    </div>
  )
}

function summarizeToolInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const obj = input as Record<string, unknown>
  // 工具特定优先字段
  const byTool: Record<string, string[]> = {
    Bash: ['command'],
    Read: ['file_path'],
    Write: ['file_path'],
    Edit: ['file_path'],
    Glob: ['pattern'],
    Grep: ['pattern'],
    WebFetch: ['url'],
    WebSearch: ['query'],
    TaskCreate: ['subject'],
    Agent: ['description'],
  }
  const preferKeys = (byTool[name] ?? []).concat(['file_path', 'path', 'command', 'pattern', 'prompt', 'query', 'url', 'description', 'subject', 'content'])
  for (const k of preferKeys) {
    const v = obj[k]
    if (typeof v === 'string' && v) return v.split('\n')[0].slice(0, 140)
  }
  for (const v of Object.values(obj)) {
    if (typeof v === 'string' && v) return v.split('\n')[0].slice(0, 140)
  }
  return ''
}

function ToolUseBlock({ name, input }: { name: string; input: unknown }) {
  const [open, setOpen] = useState(false)
  const summary = useMemo(() => summarizeToolInput(name, input), [name, input])
  const body = useMemo(() => {
    try { return typeof input === 'object' ? JSON.stringify(input, null, 2) : String(input ?? '') }
    catch { return String(input ?? '') }
  }, [input])
  return (
    <div className="rounded border border-nexus-border/60 overflow-hidden bg-nexus-bg-2/20">
      <button
        className="w-full text-left bg-transparent border-none cursor-pointer px-2 py-1 text-xs flex items-center gap-1.5 min-w-0"
        onClick={() => setOpen(!open)}
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
        <span className="font-mono font-semibold text-nexus-accent shrink-0">⚒ {name}</span>
        {!open && summary && <span className="text-nexus-text-2 truncate flex-1 font-mono">{summary}</span>}
      </button>
      {open && (
        <pre className="px-3 py-2 text-[12px] text-nexus-text whitespace-pre-wrap break-words font-mono m-0 bg-nexus-bg-2/60 border-t border-nexus-border/60">{body}</pre>
      )}
    </div>
  )
}

function ToolResultBlock({ text, serverTruncated, totalLen, isError }: {
  text: string; serverTruncated: boolean; totalLen: number; isError: boolean
}) {
  const [open, setOpen] = useState(false)
  const firstLine = (text.split('\n').find(l => l.trim()) ?? '(空)').slice(0, 140)
  const borderColor = isError ? 'var(--nexus-error)' : 'var(--nexus-border)'
  return (
    <div className="rounded border overflow-hidden" style={{ borderColor: isError ? borderColor : undefined }}>
      <button
        className="w-full text-left bg-transparent border-none cursor-pointer px-2 py-1 text-xs flex items-center gap-1.5 min-w-0"
        onClick={() => setOpen(!open)}
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
        <span className="font-medium shrink-0" style={{ color: isError ? 'var(--nexus-error)' : 'var(--nexus-text2)' }}>
          {isError ? '↳ 工具错误' : '↳ 工具输出'}
        </span>
        {!open && <span className="text-nexus-muted truncate flex-1 font-mono">{firstLine}</span>}
      </button>
      {open && (
        <pre className="px-3 py-2 text-[12px] text-nexus-text whitespace-pre-wrap break-words font-mono m-0 bg-nexus-bg-2/60 border-t" style={{ borderColor }}>
          {text || '(空)'}
          {serverTruncated && <div className="text-[10px] text-nexus-muted mt-1">（服务端已截断，完整 {totalLen} 字未加载）</div>}
        </pre>
      )}
    </div>
  )
}
