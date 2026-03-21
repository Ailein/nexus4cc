import { useState, useEffect, useRef, useCallback } from 'react'

const FAB_POS_KEY = 'nexus_fab_pos'
const DRAG_THRESHOLD = 20

interface Pos { x: number; y: number }

interface Props {
  onClick: () => void
  windowCount?: number
}

function clampPos(x: number, y: number, size: number): Pos {
  const maxX = window.innerWidth - size
  const maxY = window.innerHeight - size
  return {
    x: Math.max(0, Math.min(x, maxX)),
    y: Math.max(0, Math.min(y, maxY)),
  }
}

function defaultPos(size: number): Pos {
  return {
    x: window.innerWidth - size - 16,
    y: window.innerHeight - size - 80,
  }
}

export default function SessionFAB({ onClick, windowCount }: Props) {
  const SIZE = 52

  const [pos, setPos] = useState<Pos>(() => {
    try {
      const s = localStorage.getItem(FAB_POS_KEY)
      if (s) {
        const p = JSON.parse(s) as Pos
        return clampPos(p.x, p.y, SIZE)
      }
    } catch {}
    return defaultPos(SIZE)
  })

  const isDragging = useRef(false)
  const startPointer = useRef<Pos>({ x: 0, y: 0 })
  const startPos = useRef<Pos>({ x: 0, y: 0 })
  const moved = useRef(false)
  const posRef = useRef(pos)
  posRef.current = pos

  // Persist on pos change (only after mount)
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    localStorage.setItem(FAB_POS_KEY, JSON.stringify(pos))
  }, [pos])

  // Re-clamp on viewport resize
  useEffect(() => {
    function onResize() {
      setPos(p => clampPos(p.x, p.y, SIZE))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    isDragging.current = true
    moved.current = false
    startPointer.current = { x: e.clientX, y: e.clientY }
    startPos.current = posRef.current
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return
    const dx = e.clientX - startPointer.current.x
    const dy = e.clientY - startPointer.current.y
    if (!moved.current && Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
      moved.current = true
    }
    if (moved.current) {
      setPos(clampPos(startPos.current.x + dx, startPos.current.y + dy, SIZE))
    }
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return
    isDragging.current = false
    if (!moved.current) {
      onClick()
    } else {
      // Persist final clamped position
      const dx = e.clientX - startPointer.current.x
      const dy = e.clientY - startPointer.current.y
      const final = clampPos(startPos.current.x + dx, startPos.current.y + dy, SIZE)
      setPos(final)
      localStorage.setItem(FAB_POS_KEY, JSON.stringify(final))
    }
  }, [onClick])

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: SIZE,
        height: SIZE,
        borderRadius: '50%',
        background: '#3b82f6',
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'grab',
        zIndex: 350,
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      <svg viewBox="0 0 24 24" fill="white" width="26" height="26">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
      </svg>
      {!!windowCount && windowCount > 0 && (
        <span style={{
          position: 'absolute',
          top: -4,
          right: -4,
          background: '#22c55e',
          color: '#fff',
          borderRadius: '50%',
          width: 18,
          height: 18,
          fontSize: 11,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}>{windowCount}</span>
      )}
    </div>
  )
}
