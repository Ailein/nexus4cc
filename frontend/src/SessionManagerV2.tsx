import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import GhostShield from './GhostShield'
import { Icon } from './icons'

interface Channel {
  index: number
  name: string
  active: boolean
  cwd: string
}

interface Project {
  name: string
  path: string
  active: boolean
  channelCount: number
}

interface Props {
  token: string
  currentProject: string // 当前激活的 tmux session
  currentChannelIndex?: number // 当前激活的 channel index
  onClose: () => void
  onSwitchProject: (projectName: string, lastChannel?: number) => void
  onSwitchChannel: (channelIndex: number) => void
  onNewProject: () => void // 打开 WorkspaceSelector
  onNewChannel: () => void // 直接新建窗口
}

// 检测是否为 PC 端（>= 768px）
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 768)
  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isDesktop
}

// 状态点颜色映射
const STATUS_DOT = {
  running: '#22c55e', // 绿色
  idle: '#9ca3af',    // 灰色
  waiting: '#eab308', // 黄色
  shell: '#6b7280',   // 深灰
}

function getChannelStatus(channel: Channel, isActive: boolean): keyof typeof STATUS_DOT {
  // 简单启发式判断
  if (channel.name === 'shell' || channel.name.endsWith('-shell')) return 'shell'
  // 使用传入的 isActive 实现即时更新
  return isActive ? 'running' : 'idle'
}

export default function SessionManagerV2({
  token,
  currentProject,
  currentChannelIndex,
  onClose,
  onSwitchProject,
  onSwitchChannel,
  onNewProject,
  onNewChannel,
}: Props) {
  const { t } = useTranslation()
  const isDesktop = useIsDesktop()
  const [projects, setProjects] = useState<Project[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [loadingChannels, setLoadingChannels] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const headers = { Authorization: `Bearer ${token}` }

  // 长按/双击 refs（仅移动端）
  const clickTimerRef = useRef<number | null>(null)
  const pendingChannelRef = useRef<Channel | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const longPressChannelRef = useRef<Channel | null>(null)
  const isLongPressRef = useRef(false)

  // 长按菜单状态（仅移动端）
  const [longPressMenu, setLongPressMenu] = useState<{ channel: Channel; x: number; y: number } | null>(null)
  const [pressChannel, setPressChannel] = useState<number | null>(null)
  const [channelMenu, setChannelMenu] = useState<{ channel: Channel; x: number; y: number } | null>(null)
  const [projectMenu, setProjectMenu] = useState<{ project: Project; x: number; y: number } | null>(null)

  // Projects 列表
  const fetchProjects = useCallback(async () => {
    setLoadingProjects(true)
    try {
      const r = await fetch('/api/projects', { headers })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data: Project[] = await r.json()
      setProjects(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('sessionMgr.loadFailed'))
    } finally {
      setLoadingProjects(false)
    }
  }, [token])

  // 当前 Project 的 Channels
  const fetchChannels = useCallback(async (projectName: string) => {
    setLoadingChannels(true)
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projectName)}/channels`, { headers })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      setChannels(data.channels || [])
    } catch (e: unknown) {
      console.error('加载 Channels 失败:', e)
      setChannels([])
    } finally {
      setLoadingChannels(false)
    }
  }, [token])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    if (currentProject) {
      fetchChannels(currentProject)
    }
  }, [currentProject, fetchChannels])

  const handleRefresh = () => {
    fetchProjects()
    if (currentProject) fetchChannels(currentProject)
  }

  // Project 点击切换（PC + 移动端统一 onPointerDown）
  const handleProjectClick = async (project: Project) => {
    if (project.name === currentProject) return
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(project.name)}/activate`, {
        method: 'POST',
        headers,
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      onSwitchProject(project.name, data.lastChannel)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('sessionMgr.switchFailed'))
    }
  }

  // Channel 切换（公共函数）
  const doSwitchChannel = async (channel: Channel, shouldClose: boolean) => {
    try {
      const r = await fetch(`/api/sessions/${channel.index}/attach?session=${encodeURIComponent(currentProject)}`, {
        method: 'POST',
        headers,
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      onSwitchChannel(channel.index)
      if (shouldClose) {
        onClose()
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '切换失败')
    }
  }

  // ======================
  // 移动端手势处理
  // ======================

  const handleChannelTouchStart = (channel: Channel, e: React.TouchEvent) => {
    isLongPressRef.current = false
    longPressChannelRef.current = channel
    setPressChannel(channel.index)

    longPressTimerRef.current = window.setTimeout(() => {
      isLongPressRef.current = true
      setPressChannel(null)
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const menuWidth = 120
      const menuHeight = 80
      let x = rect.left + rect.width / 2
      let y = rect.bottom + 8
      if (x + menuWidth / 2 > window.innerWidth - 16) {
        x = window.innerWidth - menuWidth / 2 - 16
      }
      if (x - menuWidth / 2 < 16) {
        x = menuWidth / 2 + 16
      }
      if (y + menuHeight > window.innerHeight - 16) {
        y = rect.top - menuHeight - 8
      }
      setLongPressMenu({
        channel,
        x,
        y,
      })
    }, 500)
  }

  const handleChannelTouchEnd = (channel: Channel) => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }

    if (isLongPressRef.current) {
      setPressChannel(null)
      return
    }

    window.setTimeout(() => {
      setPressChannel(null)
    }, 100)

    if (channel.index === currentChannelIndex) {
      onClose()
      return
    }

    pendingChannelRef.current = channel

    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
      doSwitchChannel(channel, true)
    } else {
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null
        if (pendingChannelRef.current) {
          doSwitchChannel(pendingChannelRef.current, false)
        }
      }, 250)
    }
  }

  const handleChannelTouchMove = () => {
    setPressChannel(null)
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  // ======================
  // 菜单处理
  // ======================

  const handleRenameChannel = async (channel: Channel) => {
    setLongPressMenu(null)
    setChannelMenu(null)
    const newName = window.prompt(`${t('common.rename')} Channel:`, channel.name)
    if (!newName || newName === channel.name) return

    try {
      const r = await fetch(`/api/sessions/${channel.index}/rename?session=${encodeURIComponent(currentProject)}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      fetchChannels(currentProject)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('sessionMgr.renameFailed'))
    }
  }

  const handleCloseChannel = async (channel: Channel) => {
    setLongPressMenu(null)
    setChannelMenu(null)

    try {
      const r = await fetch(`/api/sessions/${channel.index}?session=${encodeURIComponent(currentProject)}`, {
        method: 'DELETE',
        headers,
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      fetchChannels(currentProject)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('sessionMgr.closeFailed'))
    }
  }

  const handleRenameProject = async (project: Project) => {
    setProjectMenu(null)
    const newName = window.prompt(`${t('common.rename')} Project:`, project.name)
    if (!newName || newName === project.name) return

    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(project.name)}/rename`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      fetchProjects()
      if (project.name === currentProject) {
        onSwitchProject(newName)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('sessionMgr.renameFailed'))
    }
  }

  const handleCloseProject = async (project: Project) => {
    setProjectMenu(null)

    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(project.name)}`, {
        method: 'DELETE',
        headers,
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      fetchProjects()
      if (project.name === currentProject) {
        const remaining = projects.filter(p => p.name !== project.name)
        if (remaining.length > 0) {
          handleProjectClick(remaining[0])
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('sessionMgr.closeFailed'))
    }
  }

  const showChannelMenu = (channel: Channel, e: React.MouseEvent | React.TouchEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const menuWidth = 120
    const menuHeight = 80
    let x = rect.left + rect.width / 2
    let y = rect.bottom + 8
    if (x + menuWidth / 2 > window.innerWidth - 16) {
      x = window.innerWidth - menuWidth / 2 - 16
    }
    if (x - menuWidth / 2 < 16) {
      x = menuWidth / 2 + 16
    }
    if (y + menuHeight > window.innerHeight - 16) {
      y = rect.top - menuHeight - 8
    }
    setChannelMenu({ channel, x, y })
  }

  const showProjectMenu = (project: Project, e: React.MouseEvent | React.TouchEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const menuWidth = 140
    const menuHeight = 100
    let x = rect.left + rect.width / 2
    let y = rect.bottom + 8
    if (x + menuWidth / 2 > window.innerWidth - 16) {
      x = window.innerWidth - menuWidth / 2 - 16
    }
    if (x - menuWidth / 2 < 16) {
      x = menuWidth / 2 + 16
    }
    if (y + menuHeight > window.innerHeight - 16) {
      y = rect.top - menuHeight - 8
    }
    setProjectMenu({ project, x, y })
  }

  const formatPath = (p: string) => {
    if (!p) return ''
    if (p.startsWith('/home/')) return p.replace('/home/', '~/')
    if (p === '/root' || p.startsWith('/root/')) return p.replace('/root', '~')
    return p
  }

  const currentProjectInfo = projects.find(p => p.name === currentProject)

  // 当前活跃 menu（长按 or 三点菜单）
  const activeChannelMenu = longPressMenu || channelMenu

  return (
    <div className={isDesktop ? 'fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-5' : 'fixed inset-0 bg-black/60 z-[100]'}>
      <GhostShield />
      <div className={isDesktop ? 'bg-nexus-bg border border-nexus-border rounded-xl flex flex-col text-nexus-text w-full max-w-[420px] max-h-[85vh] shadow-[0_20px_60px_rgba(0,0,0,0.5)] overflow-hidden' : 'fixed inset-0 bg-nexus-bg flex flex-col text-nexus-text'}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-nexus-border shrink-0">
          <span className="text-base font-semibold">{t('sessionMgr.title')}</span>
          <div className="flex items-center gap-2">
            <button className="bg-transparent border-none text-nexus-text-2 cursor-pointer p-1 flex items-center justify-center" onPointerDown={handleRefresh} title="刷新">
              <Icon name="refresh" size={16} />
            </button>
            <button className="bg-transparent border-none text-nexus-text-2 cursor-pointer text-2xl leading-none px-1 flex items-center justify-center" onPointerDown={onClose}>
              <Icon name="x" size={20} />
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/15 text-nexus-error px-4 py-2.5 text-sm flex items-center justify-between border-b border-nexus-border">
            {error}
            <button className="bg-transparent border-none text-nexus-error cursor-pointer p-0.5" onPointerDown={() => setError(null)}>
              <Icon name="x" size={14} />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto flex flex-col">
          {/* ========== Project 列表区域（上部）========== */}
          <div className="py-3 flex-1 flex flex-col min-h-[120px]">
            <div className="px-4 pb-2 border-b border-nexus-border mb-2">
              <div className="text-xs font-semibold text-nexus-text tracking-wide flex items-center gap-1.5">
                <span className="text-sm">📁</span>
                {t('sessionMgr.projects')}
              </div>
            </div>

            {/* Project 列表 */}
            <div className="flex-1 overflow-y-auto px-2 py-1">
              {loadingProjects ? (
                <div className="text-nexus-muted text-sm px-4 py-3">{t('common.loading')}</div>
              ) : projects.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-4 py-6 text-nexus-muted">
                  <div className="text-[32px] mb-2 opacity-50">📁</div>
                  <div className="text-sm">{t('sessionMgr.noProjects')}</div>
                </div>
              ) : (
                projects.map(project => {
                  const isActive = project.name === currentProject
                  return (
                    <div
                      key={project.name}
                      className={`flex items-start gap-2.5 px-3 py-2.5 rounded-md cursor-pointer mb-0.5 select-none ${isActive ? 'bg-blue-500/15' : ''}`}
                      onPointerDown={() => {
                        if (project.name !== currentProject) {
                          handleProjectClick(project)
                        }
                      }}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 mt-1 ${isActive ? 'bg-blue-500' : 'bg-nexus-muted'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-nexus-text break-all leading-tight">{project.name}</div>
                        {project.path && (
                          <div className="text-[11px] text-nexus-text-2 font-mono overflow-hidden text-ellipsis whitespace-nowrap mt-0.5" title={project.path}>
                            {formatPath(project.path)}
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-nexus-text-2 font-mono shrink-0">({project.channelCount})</span>
                      {/* 三点菜单 */}
                      <button
                        className="bg-transparent border-none text-nexus-text-2 cursor-pointer p-1 flex items-center justify-center opacity-60 transition-opacity duration-150 shrink-0"
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          showProjectMenu(project, e)
                        }}
                        title={t('sessionMgr.moreOptions')}
                      >
                        <Icon name="more" size={16} />
                      </button>
                    </div>
                  )
                })
              )}
            </div>

            {/* 新建 Project 按钮 */}
            <button className="flex items-center justify-center gap-1.5 mx-4 my-2 px-3 py-2 bg-transparent border border-dashed border-nexus-border rounded-md text-nexus-text-2 text-sm cursor-pointer" onPointerDown={onNewProject}>
              <Icon name="plus" size={14} />
              <span>{t('sessionMgr.newProject')}</span>
            </button>
          </div>

          {/* 分隔线 */}
          <div className="h-px bg-nexus-border mx-4" />

          {/* ========== Channel 列表区域（下部）========== */}
          <div className="py-3 flex-1 flex flex-col min-h-[120px]">
            {/* Channel 标题栏 */}
            <div className="px-4 pb-2 border-b border-nexus-border mb-2">
              <div>
                <div className="text-xs font-semibold text-nexus-text tracking-wide flex items-center gap-1.5">
                  <span className="text-sm">#</span>
                  {currentProjectInfo?.name || currentProject || t('sessionMgr.noProject')}
                </div>
                {currentProjectInfo?.path && (
                  <div className="text-[11px] text-nexus-text-2 mt-0.5 font-mono overflow-hidden text-ellipsis whitespace-nowrap" title={currentProjectInfo.path}>
                    {formatPath(currentProjectInfo.path)}
                  </div>
                )}
              </div>
            </div>

            {/* Channel 列表 */}
            <div className="flex-1 overflow-y-auto px-2 py-1">
              {loadingChannels ? (
                <div className="text-nexus-muted text-sm px-4 py-3">{t('common.loading')}</div>
              ) : channels.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-4 py-6 text-nexus-muted">
                  <div className="text-[32px] mb-2 opacity-50">#</div>
                  <div className="text-sm">{t('sessionMgr.noChannels')}</div>
                </div>
              ) : (
                channels.map(channel => {
                  const isActive = channel.index === currentChannelIndex
                  const status = getChannelStatus(channel, isActive)
                  return (
                    <div
                      key={channel.index}
                      className={`flex items-start gap-2 px-3 py-2 rounded-md cursor-pointer mb-0.5 select-none transition-colors duration-75 ${isActive ? 'bg-nexus-bg-2' : ''} ${pressChannel === channel.index ? 'bg-nexus-border' : ''}`}
                      style={{ WebkitTouchCallout: 'none', WebkitTapHighlightColor: 'rgba(128,128,128,0.3)' }}
                      onPointerDown={() => {
                        // PC 端：直接切换
                        if (isDesktop) {
                          doSwitchChannel(channel, false)
                        }
                        // 移动端：onTouchStart + onTouchEnd 处理
                      }}
                      onTouchStart={(e) => {
                        if (!isDesktop) {
                          handleChannelTouchStart(channel, e)
                        }
                      }}
                      onTouchEnd={(e) => {
                        if (!isDesktop) {
                          e.preventDefault()
                          handleChannelTouchEnd(channel)
                        }
                      }}
                      onTouchMove={() => {
                        if (!isDesktop) {
                          handleChannelTouchMove()
                        }
                      }}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0 mt-1"
                        style={{ background: STATUS_DOT[status] }}
                        title={status}
                      />
                      <span className="text-nexus-text-2 text-[13px] font-medium select-none shrink-0 mt-0">#</span>
                      <span className="flex-1 text-sm text-nexus-text break-all leading-tight min-w-0" title={channel.name}>{channel.name}</span>
                      {/* 三个点菜单按钮 */}
                      <button
                        className="bg-transparent border-none text-nexus-text-2 cursor-pointer p-1 flex items-center justify-center opacity-60 transition-opacity duration-150 shrink-0"
                        onTouchStart={(e) => {
                          if (!isDesktop) {
                            e.stopPropagation()
                          }
                        }}
                        onTouchEnd={(e) => {
                          if (!isDesktop) {
                            e.stopPropagation()
                            e.preventDefault()
                            showChannelMenu(channel, e)
                          }
                        }}
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          showChannelMenu(channel, e)
                        }}
                        title={t('sessionMgr.moreOptions')}
                      >
                        <Icon name="more" size={16} />
                      </button>
                    </div>
                  )
                })
              )}
            </div>

            {/* 新建 Channel 按钮 */}
            <button className="flex items-center justify-center gap-1.5 mx-4 my-2 px-3 py-2 bg-transparent border border-dashed border-nexus-border rounded-md text-nexus-text-2 text-sm cursor-pointer" onPointerDown={onNewChannel}>
              <Icon name="plus" size={14} />
              <span>{t('sessionMgr.newChannel')}</span>
            </button>

            {/* Channel 菜单（长按 or 三点菜单） */}
            {activeChannelMenu && (
              <>
                <div
                  className="fixed inset-0 z-[150]"
                  onPointerDown={() => {
                    setLongPressMenu(null)
                    setChannelMenu(null)
                  }}
                />
                <div
                  className="fixed bg-nexus-bg border border-nexus-border rounded-lg py-1 min-w-[120px] shadow-[0_4px_20px_rgba(0,0,0,0.3)] z-[151]"
                  style={{
                    left: activeChannelMenu.x,
                    top: activeChannelMenu.y,
                    transform: 'translateX(-50%)',
                  }}
                >
                  <button
                    className="flex items-center gap-2 px-4 py-2.5 bg-transparent border-none text-nexus-text text-sm cursor-pointer w-full text-left"
                    onPointerDown={() => handleRenameChannel(activeChannelMenu.channel)}
                  >
                    <Icon name="pencil" size={14} />
                    <span>{t('common.rename')}</span>
                  </button>
                  <div className="h-px bg-nexus-border my-1" />
                  <button
                    className="flex items-center gap-2 px-4 py-2.5 bg-transparent border-none text-nexus-error text-sm cursor-pointer w-full text-left"
                    onPointerDown={() => handleCloseChannel(activeChannelMenu.channel)}
                  >
                    <Icon name="x" size={14} />
                    <span>{t('common.close')}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {/* Project 菜单 */}
      {projectMenu && (
        <>
          <div
            className="fixed inset-0 z-[150]"
            onPointerDown={() => setProjectMenu(null)}
          />
          <div
            className="fixed bg-nexus-bg border border-nexus-border rounded-lg py-1 min-w-[120px] shadow-[0_4px_20px_rgba(0,0,0,0.3)] z-[151]"
            style={{
              left: projectMenu.x,
              top: projectMenu.y,
              transform: 'translateX(-50%)',
            }}
          >
            <div className="px-4 py-2 text-xs font-semibold text-nexus-text-2 border-b border-nexus-border mb-1">{projectMenu.project.name}</div>
            <button
              className="flex items-center gap-2 px-4 py-2.5 bg-transparent border-none text-nexus-text text-sm cursor-pointer w-full text-left"
              onPointerDown={() => handleRenameProject(projectMenu.project)}
            >
              <Icon name="pencil" size={14} />
              <span>{t('common.rename')}</span>
            </button>
            <div className="h-px bg-nexus-border my-1" />
            <button
              className="flex items-center gap-2 px-4 py-2.5 bg-transparent border-none text-nexus-error text-sm cursor-pointer w-full text-left"
              onPointerDown={() => handleCloseProject(projectMenu.project)}
            >
              <Icon name="x" size={14} />
              <span>{t('sessionMgr.closeProject')}</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
