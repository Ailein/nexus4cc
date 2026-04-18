import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { getWindowStatus, STATUS_DOT_COLOR, WindowStatus } from './windowStatus'

interface TmuxWindow {
  index: number
  name: string
  active: boolean
}

interface WindowOutput {
  output: string
  clients: number
  idleMs: number
  connected: boolean
}

interface Props {
  windows: TmuxWindow[]
  activeIndex: number
  windowOutputs: Record<number, WindowOutput>
  onSwitch: (index: number) => void
  topInset?: number
}

const ITEM_H = 38
const VISIBLE_ITEMS = 4

export default function QuickSwitcher({ windows, activeIndex, windowOutputs, onSwitch, topInset = 0 }: Props) {
  const [expanded, setExpanded] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!expanded) return
    function onDown(e: PointerEvent) {
      const target = e.target as Node
      if (rootRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setExpanded(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [expanded])

  if (windows.length === 0) return null

  const activeWindow = windows.find(w => w.index === activeIndex)
  const activeName = activeWindow?.name ?? '—'
  const activeStatus: WindowStatus = getWindowStatus(windowOutputs[activeIndex])

  // 展开下拉的绝对 top 位置（脱离父容器，直接挂 body）
  const pillTop = topInset + 8
  const PILL_H = 32
  const GAP = 6
  const dropdownTop = pillTop + PILL_H + GAP

  const pill = (
    <div
      ref={rootRef}
      style={{
        position: 'fixed',
        top: pillTop,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 340,
        maxWidth: 'calc(100vw - 24px)',
        touchAction: 'manipulation',
      }}
    >
      {/* 药丸本体：状态点 + 数字 + 当前窗口名 + 下拉箭头 */}
      <button
        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setExpanded(v => !v) }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 32,
          padding: '0 12px',
          borderRadius: 999,
          border: '1px solid var(--nexus-border)',
          background: 'var(--nexus-bg2)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.25), 0 1px 3px rgba(0,0,0,0.15)',
          color: 'var(--nexus-text)',
          fontSize: 12,
          fontFamily: 'inherit',
          cursor: 'pointer',
          maxWidth: 'calc(100vw - 24px)',
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: STATUS_DOT_COLOR[activeStatus],
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 600, flexShrink: 0 }}>{windows.length}</span>
        <span
          style={{
            opacity: 0.5,
            flexShrink: 0,
            fontSize: 11,
          }}
        >·</span>
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 180,
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          }}
        >
          {activeName}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          width="12"
          height="12"
          style={{
            opacity: 0.6,
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s',
            flexShrink: 0,
          }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

    </div>
  )

  // 展开后的下拉 · 通过 Portal 挂到 document.body，完全脱离 Terminal 树。
  // 关键坑:
  //  1. 需要全屏透明 backdrop 吃掉下方 xterm-viewport 的 touch（primary scroll
  //     container 冲突）。backdrop 自己带 touchAction: none 防止滚动传透。
  //  2. dropdown 自身**不能带 transform**（iOS Safari 的 overflow-scroll 在
  //     transform 创建的 stacking context 里会失效）。用外层 flex wrapper 居中。
  const dropdown = expanded ? createPortal(
    <>
      {/* 全屏 backdrop · 吃掉下方 xterm-viewport 的 touch，并且点击收起 */}
      <div
        onPointerDown={() => setExpanded(false)}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 340,
          background: 'transparent',
          touchAction: 'none',
        }}
      />
      {/* flex wrapper 负责水平居中，不拦截事件 */}
      <div
        style={{
          position: 'fixed',
          top: dropdownTop,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none',
          zIndex: 341,
        }}
      >
      <div
        ref={dropdownRef}
        style={{
          pointerEvents: 'auto',
          width: 'min(280px, calc(100vw - 24px))',
          maxHeight: ITEM_H * VISIBLE_ITEMS + 8,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
          overscrollBehavior: 'contain',
          background: 'var(--nexus-bg2)',
          border: '1px solid var(--nexus-border)',
          borderRadius: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.2)',
          padding: 4,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
      {windows.map(win => {
        const status = getWindowStatus(windowOutputs[win.index])
        const isActive = win.index === activeIndex
        return (
          <button
            key={win.index}
            onClick={(e) => {
              // 用 onClick 而不是 onPointerDown：iOS Safari 在手指 touchmove
              // 超过阈值时会自动取消 click 事件，允许滚动手势穿过 button 触发
              // dropdown 的 overflow-y 原生滚动。pointerdown 会立刻触发，导致
              // "一碰就切换"，无法滚动。
              e.stopPropagation()
              onSwitch(win.index)
              setExpanded(false)
            }}
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              height: ITEM_H - 2,
              padding: '0 12px',
              borderRadius: 8,
              border: 'none',
              background: isActive ? 'color-mix(in srgb, var(--nexus-accent) 18%, transparent)' : 'transparent',
              color: isActive ? 'var(--nexus-accent)' : 'var(--nexus-text)',
              fontSize: 13,
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: STATUS_DOT_COLOR[status],
                flexShrink: 0,
              }}
            />
            <span
              style={{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {win.name}
            </span>
            {isActive && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14" style={{ flexShrink: 0 }}>
                <path d="M5 12l5 5L20 7" />
              </svg>
            )}
          </button>
        )
      })}
      </div>
      </div>
    </>,
    document.body
  ) : null

  return (
    <>
      {pill}
      {dropdown}
    </>
  )
}
