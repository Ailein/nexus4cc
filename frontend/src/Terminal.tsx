import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import Toolbar from './Toolbar'
import SessionManager from './SessionManager'

interface Props {
  token: string
  onLogout: () => void
}

const FONT_SIZE_KEY = 'nexus_font_size'
const TAP_THRESHOLD = 8

export default function Terminal({ token, onLogout }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const userScrolledRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [showSessions, setShowSessions] = useState(false)

  const sendToWs = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data)
    }
  }, [])

  const scrollToBottom = useCallback(() => {
    termRef.current?.scrollToBottom()
    userScrolledRef.current = false
  }, [])

  useEffect(() => {
    const fontSize = parseInt(localStorage.getItem(FONT_SIZE_KEY) || '16', 10)

    const term = new XTerm({
      theme: {
        background: '#1a1a2e',
        foreground: '#e2e8f0',
        cursor: '#e2e8f0',
        black: '#1a1a2e',
        brightBlack: '#4a5568',
        red: '#fc8181',
        brightRed: '#feb2b2',
        green: '#68d391',
        brightGreen: '#9ae6b4',
        yellow: '#f6e05e',
        brightYellow: '#faf089',
        blue: '#63b3ed',
        brightBlue: '#90cdf4',
        magenta: '#b794f4',
        brightMagenta: '#d6bcfa',
        cyan: '#76e4f7',
        brightCyan: '#b2f5ea',
        white: '#e2e8f0',
        brightWhite: '#f7fafc',
      },
      fontSize,
      fontFamily: 'Menlo, Monaco, "Cascadia Code", "Fira Code", monospace',
      scrollback: 10000,
      cursorBlink: true,
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    termRef.current = term

    const container = containerRef.current!
    term.open(container)
    fitAddon.fit()

    // 禁用 xterm 自身的 touch 处理，由我们的监听器全权接管
    const viewport = container.querySelector('.xterm-viewport') as HTMLElement
    if (viewport) viewport.style.pointerEvents = 'none'

    // 拦截桌面端浏览器默认快捷键
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.ctrlKey && ['w', 't', 'n', 'l', 'r'].includes(e.key.toLowerCase())) {
        e.preventDefault()
        return true
      }
      return true
    })

    // 动态获取实际行高，避免固定常量导致不同设备滑动灵敏度不一致
    function getLineHeight(): number {
      const core = (term as any)._core
      const cellH = core?._renderService?.dimensions?.css?.cell?.height
      if (cellH && cellH > 0) return cellH
      const h = container.offsetHeight
      if (h > 0 && term.rows > 0) return h / term.rows
      return 20
    }

    // WebSocket 连接
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`)
    wsRef.current = ws

    ws.onopen = () => {
      // 每次建立连接时重新 fit，确保以当前设备的实际尺寸初始化 PTY
      fitAddon.fit()
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }

    ws.onmessage = (e) => {
      term.write(e.data)
      if (!userScrolledRef.current) term.scrollToBottom()
    }

    ws.onclose = (e) => {
      if (e.code === 4001) {
        term.write('\r\n\x1b[31m[Nexus: 认证失败，请刷新重新登录]\x1b[0m\r\n')
      } else {
        term.write('\r\n\x1b[33m[Nexus: 连接断开，正在重连...]\x1b[0m\r\n')
        setTimeout(() => location.reload(), 3000)
      }
    }

    ws.onerror = () => term.write('\r\n\x1b[31m[Nexus: WebSocket 错误]\x1b[0m\r\n')

    // 桌面端键盘输入（xterm 直接处理）
    term.onData((data) => ws.send(data))

    // 移动端 touch 处理
    let touchStartY = 0
    let touchLastY = 0
    let isPinching = false
    let pinchStartDist = 0
    let pinchStartFontSize = fontSize

    function getTouchDist(e: TouchEvent): number {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      return Math.sqrt(dx * dx + dy * dy)
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        isPinching = true
        pinchStartDist = getTouchDist(e)
        pinchStartFontSize = parseInt(localStorage.getItem(FONT_SIZE_KEY) || '16', 10)
      } else {
        isPinching = false
        touchStartY = e.touches[0].clientY
        touchLastY = e.touches[0].clientY
      }
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault()
      if (isPinching && e.touches.length === 2) {
        // 双指缩放：调整字体大小
        const dist = getTouchDist(e)
        const scale = dist / pinchStartDist
        const newSize = Math.round(Math.max(8, Math.min(32, pinchStartFontSize * scale)))
        if (newSize !== term.options.fontSize) {
          term.options.fontSize = newSize
          localStorage.setItem(FONT_SIZE_KEY, String(newSize))
          fitAddon.fit()
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
          }
        }
      } else if (!isPinching) {
        // 单指滑动：滚动终端
        const y = e.touches[0].clientY
        const lineHeight = getLineHeight()
        const lines = Math.round((touchLastY - y) / lineHeight)
        touchLastY = y
        if (lines !== 0) {
          term.scrollLines(lines)
          const buffer = (term as any).buffer?.active
          if (buffer) {
            const atBottom = buffer.viewportY >= buffer.baseY
            userScrolledRef.current = !atBottom
            window.dispatchEvent(new CustomEvent('nexus:atbottom', { detail: atBottom }))
          }
        }
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (isPinching) {
        isPinching = false
        return
      }
      const endY = e.changedTouches[0].clientY
      if (Math.abs(endY - touchStartY) < TAP_THRESHOLD) {
        // tap：弹出输入法
        inputRef.current?.focus({ preventScroll: true })
      }
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd, { passive: true })

    // resize：窗口/容器尺寸变化时重新 fit 并通知服务端
    function sendResize() {
      fitAddon.fit()
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    }

    // 屏幕旋转时等待布局稳定后再 fit
    function onOrientationChange() {
      setTimeout(sendResize, 300)
    }

    const resizeObserver = new ResizeObserver(sendResize)
    resizeObserver.observe(container)
    window.addEventListener('orientationchange', onOrientationChange)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('orientationchange', onOrientationChange)
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      ws.close()
      term.dispose()
    }
  }, [token])

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    if (val) {
      sendToWs(val)
      e.target.value = ''
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); sendToWs('\r') }
    else if (e.key === 'Backspace') { e.preventDefault(); sendToWs('\x7f') }
  }

  return (
    <div style={styles.wrapper}>
      <input
        ref={inputRef}
        style={styles.hiddenInput}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        aria-hidden="true"
      />
      <div ref={containerRef} style={styles.terminal} />
      <Toolbar
        token={token}
        sendToWs={sendToWs}
        scrollToBottom={scrollToBottom}
        termRef={termRef}
        onOpenSessions={() => setShowSessions(true)}
      />
      {showSessions && (
        <SessionManager
          token={token}
          sendToWs={sendToWs}
          onClose={() => setShowSessions(false)}
          onLogout={onLogout}
        />
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    background: '#1a1a2e',
    position: 'relative',
  },
  terminal: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  hiddenInput: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0.01,
    fontSize: 16,
    pointerEvents: 'none',
    zIndex: -1,
  },
}
