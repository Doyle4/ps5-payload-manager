import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  Settings,
  Cpu,
  LayoutDashboard,
  Database,
  RefreshCw,
  Package,
  Heart,
  Menu,
  Terminal,
  X,
  Star,
  Trash2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import './App.css'

// Contexts
import { useRepository } from './contexts/RepositoryContext'

// Utilities
import { cn, isPS5, isSystemPayload, parsePayloadName } from './utils/helpers'
import { slug } from './utils/versions'

// UI Components
import Toast from './components/ui/Toast'
import Modal from './components/ui/Modal'
import NavButton from './components/ui/NavButton'
import PayloadButton from './components/ui/PayloadButton'
import LogoIcon from './components/ui/LogoIcon'
import ErrorBoundary from './components/ui/ErrorBoundary'

// Views
import StorageHub from './components/views/StorageHub'
import AutoloadView from './components/views/AutoloadView'
import SettingsView from './components/views/SettingsView'
import DonateView from './components/views/DonateView'
import AutoloadOverlay from './components/views/AutoloadOverlay'
import MoveFromUsbView from './components/views/MoveFromUsbView'
import LogViewer from './components/views/LogViewer'
import ManageSourcesView from './components/views/ManageSourcesView'
import ActiveProcessesView from './components/views/ActiveProcessesView'
import { useHistoryNavigation, getRouteFromHash } from './hooks/useHistoryNavigation'

let toastSeq = 0

function App() {
  const { t } = useTranslation();
  const { getRepoEntry, findRepoEntryById, fetchRemote } = useRepository()
  const [items, setItems] = useState([])
  const [usbPayloads, setUsbPayloads] = useState([])
  const [uploadConflictModal, setUploadConflictModal] = useState({ show: false, file: null, folderName: '' })
  const [view, setView] = useState(() => {
    if (typeof window !== 'undefined' && window.location?.hash) {
      const route = getRouteFromHash(window.location.hash)
      if (route.type === 'payload') return 'storage'
      if (route.type === 'move_from_usb' && !route.path) return 'storage'
      return route.type || 'dashboard'
    }
    return 'dashboard'
  })
  const [isFavoriteEditMode, setIsFavoriteEditMode] = useState(false)
  const [isManageMode, setIsManageMode] = useState(false)
  const [selectedPayload, setSelectedPayload] = useState(() => {
    if (typeof window !== 'undefined' && window.location?.hash) {
      const route = getRouteFromHash(window.location.hash)
      if (route.type === 'payload' && route.filename) {
        return { filename: route.filename, srcId: route.srcId }
      }
    }
    return null
  })
  const [autoloadDelayModal, setAutoloadDelayModal] = useState(false)
  const mainRef = useRef(null)

  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTop = 0
    }
    window.scrollTo(0, 0)
  }, [view])

  const [sidebarExpanded, setSidebarExpanded] = useState(() => {
    const saved = localStorage.getItem('sidebarExpanded')
    return saved !== null ? JSON.parse(saved) : true
  })

  useEffect(() => {
    localStorage.setItem('sidebarExpanded', JSON.stringify(sidebarExpanded))
  }, [sidebarExpanded])
  const [autoloadStatus, setAutoloadStatus] = useState(null)
  const [logs, setLogs] = useState([])
  const [payloads, setPayloads] = useState([])
  const [config, setConfig] = useState({})
  const [ip, setIp] = useState('0.0.0.0')
  const [loading, setLoading] = useState(false)
  const [activeLoadingName, setActiveLoadingName] = useState('')
  const [launchHistory, setLaunchHistory] = useState([])
  const [toasts, setToasts] = useState([])
  const [loadingPayloads, setLoadingPayloads] = useState(true)
  const [downloadModal, setDownloadModal] = useState({ show: false, name: '', progress: 0 })
  const [confirmModal, setConfirmModal] = useState({ show: false, title: '', message: '', onConfirm: null })
  const [moveFromUsbPath, setMoveFromUsbPath] = useState(() => {
    if (typeof window !== 'undefined' && window.location?.hash) {
      const route = getRouteFromHash(window.location.hash)
      if (route.type === 'move_from_usb') {
        return route.path || null
      }
    }
    return null
  })
  const [storageScrollTarget, setStorageScrollTarget] = useState(null)
  const [showLogs, setShowLogs] = useState(false)
  const payloadMeta = useMemo(() => ({}), [])

  const { navigate, handleSelectPayload, handleClosePayload } = useHistoryNavigation({
    view,
    setView,
    confirmModal,
    setConfirmModal,
    downloadModal,
    setDownloadModal,
    showLogs,
    setShowLogs,
    isManageMode,
    setIsManageMode,
    isFavoriteEditMode,
    setIsFavoriteEditMode,
    selectedPayload,
    setSelectedPayload,
    moveFromUsbPath,
    setMoveFromUsbPath,
    delayModal: autoloadDelayModal,
    setDelayModal: setAutoloadDelayModal,
  })
  const [favoritePayloads, setFavoritePayloads] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('favoritePayloads') || '[]')
      return Array.isArray(parsed) ? parsed.filter(p => typeof p === 'string') : []
    } catch { return [] }
  })

  useEffect(() => {
    try {
      localStorage.setItem('favoritePayloads', JSON.stringify(favoritePayloads))
    } catch {
      /* ignore storage errors */
    }
  }, [favoritePayloads])

  const toggleFavorite = (path) => {
    setFavoritePayloads(prev => {
      if (!Array.isArray(prev)) return [path]
      return prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]
    })
  }

  const moveFavorite = (path, direction) => {
    setFavoritePayloads(prev => {
      if (!Array.isArray(prev)) return []
      const idx = prev.indexOf(path)
      if (idx === -1) return prev
      const newIdx = idx + direction
      if (newIdx < 0 || newIdx >= prev.length) return prev
      const newFavorites = [...prev]
      newFavorites[idx] = newFavorites[newIdx]
      newFavorites[newIdx] = path
      return newFavorites
    })
  }

  useEffect(() => {
    if (!showLogs) return
    const eventSource = new EventSource('/events')
    eventSource.onmessage = (e) => {
      setLogs(prev => [...prev, e.data].slice(-200))
    }
    return () => eventSource.close()
  }, [showLogs])
  const [isOffline, setIsOffline] = useState(false)

  const api = useCallback(async (endpoint, options = {}) => {
    try {
      const response = await fetch(endpoint, options)
      if (options.method === 'POST') return response.text()
      try {
        const text = await response.text()
        if (text.toLowerCase().includes('<!doctype')) return null
        return JSON.parse(text)
      } catch { return null }
    } catch { return null }
  }, [])

  const showConfirm = (title, message, onConfirm) => {
    setConfirmModal({
      show: true,
      title,
      message,
      onConfirm: () => {
        setConfirmModal({ show: false })
        onConfirm()
      }
    })
  }

  const addToast = useCallback((message, type = 'success') => {
    toastSeq += 1
    const id = `${Date.now()}-${toastSeq}`
    setToasts(prev => [...prev, { id, message, type }])
  }, [])

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  const dashboardItems = useMemo(() => {
    const list = items
      .filter((it) => it && it.slot && !isSystemPayload(it.filename) && !isSystemPayload(it.name) && it.id !== 'pldmgr')
      .map((it) => ({
        key: it.slot,
        slot: it.slot,
        path: it.path,
        kind: it.kind,
        filename: it.filename,
        id: it.id,
        source_url: it.source_url,
        source_name: it.source_name,
        name: it.name,
        version: it.version,
        isUsb: false,
      }))

    const idCounts = {}
    for (const it of list) {
      if (it.kind === 'repo' && it.id) {
        idCounts[it.id] = (idCounts[it.id] || 0) + 1
      }
    }
    for (const it of list) {
      it.hasDuplicateId = Boolean(it.id && idCounts[it.id] > 1)
    }

    for (const usbPath of usbPayloads) {
      const fn = typeof usbPath === 'string' ? usbPath.split('/').pop() : ''
      list.push({
        key: usbPath,
        slot: null,
        path: usbPath,
        kind: 'usb',
        filename: fn,
        name: fn,
        id: null,
        isUsb: true,
      })
    }

    return list
  }, [items, usbPayloads])

  const refreshPayloads = async (retryCount = 0) => {
    setLoadingPayloads(true)
    const data = await api('/list_payloads')
    if (data?.items || data?.payloads) {
      const rawItems = data.items || []
      setItems(rawItems)

      const rawUsb = data.usb || (data.payloads ? data.payloads.filter(p => p.startsWith('/mnt/usb')) : [])
      setUsbPayloads(rawUsb)

      const sorted = [...(data.payloads || [])].sort((a, b) => {
        const aIsUsb = a.startsWith('/mnt/usb')
        const bIsUsb = b.startsWith('/mnt/usb')
        if (aIsUsb && !bIsUsb) return 1
        if (!aIsUsb && bIsUsb) return -1
        return a.localeCompare(b)
      })
      setPayloads(sorted)

      // Handle legacy_paths migration for favorites
      if (data.legacy_paths && typeof data.legacy_paths === 'object') {
        const lMap = data.legacy_paths
        setFavoritePayloads((prev) => {
          if (!Array.isArray(prev)) return []
          let modified = false
          const mapped = prev.map((fav) => {
            if (typeof fav !== 'string') return fav
            if (lMap[fav]) {
              modified = true
              return lMap[fav]
            }
            const fn = fav.split('/').pop()
            if (lMap[fn]) {
              modified = true
              return lMap[fn]
            }
            return fav
          }).filter(x => typeof x === 'string')
          if (modified) {
            try {
              localStorage.setItem('favoritePayloads', JSON.stringify(mapped))
            } catch {
              /* ignore storage errors */
            }
            return mapped
          }
          return prev
        })
      }

      setLoadingPayloads(false)
    } else if (retryCount < 5) {
      setTimeout(() => refreshPayloads(retryCount + 1), 1000)
    } else {
      setItems([])
      setUsbPayloads([])
      setPayloads([])
      setLoadingPayloads(false)
    }
  }

  const refreshHistory = async () => {
    const data = await api('/history_list')
    if (data?.history) {
      setLaunchHistory(data.history)
    }
  }

  const refreshConfig = async () => {
    const data = await api('/get_config')
    if (data) setConfig(data)
  }

  const handleAbort = async () => {
    await fetch('/abort').catch(() => { })
    setAutoloadStatus(prev => prev ? { ...prev, remaining: -1 } : null)
    addToast(t("app.toasts.sequence_aborted", "Sequence Aborted"), "error")
  }

  const handleFinish = async () => {
    await fetch('/autoload_clear').catch(() => { })
    setAutoloadStatus(null)
    window.location.reload()
  }

  const loadPayload = async (slotOrPath, customName) => {
    if (!slotOrPath) return
    const name = customName || slotOrPath.split('/').pop().replace(/\.(elf|bin)$/i, '').replace(/_/g, ' ')
    setLoading(true)
    setActiveLoadingName(name)
    try {
      const safeParam = encodeURI(slotOrPath)
      const res = await fetch(`/loadpayload:${safeParam}`)
      if (!res.ok) throw new Error(`${t("app.toasts.launch_failed", "Launch failed")} (${res.status})`)
      addToast(t("app.toasts.payload_launched", "{{name}} launched", { name }))
      refreshHistory()
    } catch (e) {
      addToast(e.message || t("app.toasts.launch_failed", "Launch failed"), "error")
    }
    setTimeout(() => {
      setLoading(false)
      setActiveLoadingName('')
    }, 1500)
  }

  const handleDelete = (slotOrFilename, customName) => {
    if (!slotOrFilename) return
    const name = customName || slotOrFilename
    showConfirm(
      t("app.modals.delete_payload.title", "Delete Payload"),
      t("app.modals.delete_payload.message", "Are you sure you want to remove {{fileName}}?", { fileName: name }),
      async () => {
        const res = await fetch(`/manage:delete?slot=${encodeURIComponent(slotOrFilename)}`)
        if (!res.ok) {
          addToast(`Delete failed (${res.status})`, 'error')
          return
        }
        refreshPayloads()
        addToast(t("app.toasts.payload_removed", "{{fileName}} removed", { fileName: name }))
      }
    )
  }

  const handleUpload = async (e) => {
    const input = e.target
    const file = input.files?.[0]
    input.value = ''
    if (!file) return

    const ext = file.name.split('.').pop().toLowerCase()
    if (ext !== 'elf' && ext !== 'bin') {
      addToast(
        t("app.toasts.unsupported_file", "Unsupported file type. Only .elf and .bin files are allowed."),
        "error"
      )
      return
    }

    try {
      const res = await fetch(`/manage:check?filename=${encodeURIComponent(file.name)}`)
      const data = await res.json()
      if (data?.existing || data?.file_exists || data?.folder_exists) {
        setUploadConflictModal({
          show: true,
          file,
          folderName: data.key || data.folder_name || file.name,
        })
      } else {
        performUpload(file, 'new')
      }
    } catch {
      performUpload(file, 'new')
    }
  }

  const performUpload = async (file, mode = 'new') => {
    setUploadConflictModal({ show: false, file: null, folderName: '' })
    setDownloadModal({ show: true, name: file.name, progress: 20 })
    try {
      const res = await fetch(
        `/manage:upload?filename=${encodeURIComponent(file.name)}&mode=${encodeURIComponent(mode)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file,
        }
      )
      if (!res.ok) throw new Error(`${t("app.toasts.upload_failed", "Upload failed")} (${res.status})`)
      setDownloadModal((prev) => ({ ...prev, progress: 100 }))
      addToast(t("app.toasts.payload_uploaded", "{{fileName}} uploaded", { fileName: file.name }))
      refreshPayloads()
    } catch (e) {
      addToast(e.message || t("app.toasts.upload_failed", "Upload failed"), "error")
    }
    setTimeout(() => setDownloadModal({ show: false }), 800)
  }

  const handleInstall = async (p, sourceId, repoUrl, options = {}) => {
    performInstall(p, sourceId, repoUrl, options)
  }

  const performInstall = async (p, sourceId, repoUrl, options = {}) => {
    setConfirmModal({ show: false })
    const displayName = p.name || p.filename
    setDownloadModal({ show: true, name: displayName, progress: 10 })
    try {
      setDownloadModal((prev) => ({ ...prev, progress: 30 }))
      const payloadId = p.id || slug(p.name || p.filename)
      let url = `/repository_install?id=${encodeURIComponent(payloadId)}`
      if (repoUrl) url += `&source_url=${encodeURIComponent(repoUrl)}`
      if (options.mode) url += `&mode=${encodeURIComponent(options.mode)}`
      if (options.replaceSlot) url += `&replace_slot=${encodeURIComponent(options.replaceSlot)}`

      const res = await fetch(url)
      setDownloadModal((prev) => ({ ...prev, progress: 80 }))

      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) {
        setDownloadModal((prev) => ({ ...prev, progress: 100 }))
        addToast(
          t("app.toasts.payload_installed", "{{fileName}} installed", {
            fileName: displayName,
          })
        )
        refreshPayloads()
        if (data.refreshed) {
          fetchRemote(true)
        }
      } else if (data?.conflict) {
        setDownloadModal({ show: false, name: '', progress: 0 })
        const conflict = data.conflict
        setConfirmModal({
          show: true,
          title: t("storage_hub.conflict_title", "Payload Conflict"),
          message: t(
            "storage_hub.conflict_message",
            "\"{{name}}\" is already installed from {{otherSource}} ({{version}}). Install from {{thisSource}} too?",
            {
              name: displayName,
              otherSource: conflict.source_name || "another repository",
              version: conflict.version || "",
              thisSource: repoUrl || "this repository",
            }
          ),
          onConfirm: () =>
            performInstall(p, sourceId, repoUrl, {
              mode: 'replace',
              replaceSlot: conflict.slot,
            }),
        })
        return
      } else {
        throw new Error(data?.message || t("app.toasts.install_failed", "Installation failed"))
      }
    } catch (e) {
      addToast(e.message || t("app.toasts.install_failed", "Installation failed"), 'error')
    }
    setTimeout(() => setDownloadModal({ show: false }), 800)
  }

  const handleImportFromUsb = (path) => {
    setMoveFromUsbPath(path)
    navigate('move_from_usb', { path })
  }

  const handleSaveConfig = async (newConfig) => {
    const merged = { ...config, ...newConfig }
    const success = await api('/set_config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(merged)
    })
    if (success) {
      refreshConfig()
      return true
    } else {
      addToast(t("app.toasts.save_failed", "Save failed"), "error")
      return false
    }
  }

  useEffect(() => {
    const init = async () => {
      let offline = false
      try {
        const ipRes = await fetch('/getip').then(r => r.text())
        if (ipRes.toLowerCase().includes('<!doctype')) offline = true
        else setIp(ipRes)
      } catch {
        offline = true
      }

      try {
        const verRes = await fetch('/version').then(r => r.text())
        if (verRes.toLowerCase().includes('<!doctype')) offline = true
      } catch {
        offline = true
      }

      if (offline) {
        setIsOffline(true)
      } else {
        refreshPayloads()
        refreshConfig()
        refreshHistory()
      }
    }
    init()
  }, [])




  useEffect(() => {
    if (view === 'autoload' || view === 'storage') {
      const timer = setTimeout(() => {
        refreshConfig()
        refreshPayloads()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [view])

  useEffect(() => {
    let statusTimeout
    async function poll() {
      try {
        const res = await fetch('/autoload_status')
        if (res.ok) {
          const data = await res.json()
          setAutoloadStatus(data)

          // Poll as long as autoload is active (remaining >= 0), including DONE state
          // Only stop when remaining goes negative (after /autoload_clear is called)
          const isActive = data && data.remaining >= 0
          if (isActive) {
            const delay = data.remaining > 0 ? 600 : 500
            statusTimeout = setTimeout(poll, delay)
          }
          return
        }
      } catch {
        // network or server transient error
      }
      statusTimeout = setTimeout(poll, 5000)
    }
    poll()
    return () => clearTimeout(statusTimeout)
  }, [])



  if (isOffline) {
    return (
      <div className="min-h-screen ps5-bg text-zinc-100 font-ps5 flex flex-col items-center justify-center p-4 text-center">
        <div className="max-w-lg p-12 bg-black/40 rounded-3xl border border-white/5">
          <div className="text-7xl font-light text-zinc-400 mb-12 font-mono">:(</div>
          <h1 className="text-2xl font-bold mb-4 text-zinc-300">{t("app.offline.title", "Payload Manager is not running...")}</h1>
          <p className="text-lg text-zinc-400 leading-relaxed">{t("app.offline.message_1", "Please ensure you have loaded")} <strong>pldmgr.elf</strong> {t("app.offline.message_2", "on your PS5 before launching this application.")}</p>
        </div>
      </div>
    )
  }

  // Keep overlay active while remaining >= 0, including DONE state.
  // The overlay is only dismissed when handleFinish() calls /autoload_clear,
  // which resets remaining to -1 on the backend.
  const isAutoloadActive = autoloadStatus && autoloadStatus.remaining >= 0;

  if (isAutoloadActive) {
    return <AutoloadOverlay status={autoloadStatus} onCancel={handleAbort} onFinish={handleFinish} isPS5={isPS5} />;
  }

  return (
    <div className={cn(
      "min-h-screen min-h-[100dvh] ps5-bg text-zinc-100 font-ps5 flex",
      isPS5 ? "flex-row overflow-hidden" : "flex-col md:flex-row md:overflow-hidden"
    )}>
      {/* Toast Container */}
      <div className="fixed top-0 right-0 p-8 z-[2000] space-y-4 pointer-events-none">
        {toasts.map(t => (
          <Toast key={t.id} message={t.message} type={t.type} onClose={() => removeToast(t.id)} />
        ))}
      </div>

      {/* Modals */}
      <Modal show={downloadModal.show} title={t("app.modals.installing.title", "Installing Payload")} onClose={() => { }}>
        <div className="space-y-6">
          <div className="flex justify-between items-end">
            <span className="text-ps-blue font-black uppercase italic tracking-tighter text-2xl">{downloadModal.name}</span>
            <span className="text-white font-bold text-xl">{downloadModal.progress}%</span>
          </div>
          <div className="h-4 bg-white/5 rounded-full overflow-hidden border border-white/10 p-0.5">
            <div className="h-full bg-ps-blue rounded-full transition-all duration-500" style={{ width: `${downloadModal.progress}%` }} />
          </div>
        </div>
      </Modal>

      <Modal
        show={confirmModal.show}
        title={confirmModal.title}
        onClose={() => setConfirmModal({ show: false })}
        footer={
          <>
            <button onClick={() => setConfirmModal({ show: false })} className="flex-1 px-8 py-5 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-bold transition-all uppercase tracking-tight">{t("app.buttons.cancel", "Cancel")}</button>
            <button onClick={confirmModal.onConfirm} className="flex-1 px-8 py-5 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-bold transition-all uppercase tracking-tight">{t("app.buttons.confirm", "Confirm")}</button>
          </>
        }
      >
        {confirmModal.message}
      </Modal>

      <Modal
        show={uploadConflictModal.show}
        title={t("app.modals.overwrite.title", "Upload Payload")}
        onClose={() => setUploadConflictModal({ show: false, file: null, folderName: '' })}
        footer={
          <div className="flex flex-col sm:flex-row w-full gap-3">
            <button
              type="button"
              onClick={() => setUploadConflictModal({ show: false, file: null, folderName: '' })}
              className="flex-1 py-3 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-white font-bold uppercase text-sm transition-all"
            >
              {t("app.buttons.cancel", "Cancel")}
            </button>
            <button
              type="button"
              onClick={() => performUpload(uploadConflictModal.file, 'replace')}
              className="flex-1 py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-black uppercase text-sm transition-all shadow-lg"
            >
              {t("storage_hub.conflict_replace", "Replace")}
            </button>
            <button
              type="button"
              onClick={() => performUpload(uploadConflictModal.file, 'keep_both')}
              className="flex-1 py-3 px-4 rounded-xl bg-ps-blue hover:bg-ps-blue/80 text-white font-black uppercase text-sm transition-all shadow-lg"
            >
              {t("storage_hub.conflict_keep_both", "Keep both")}
            </button>
          </div>
        }
      >
        <p>
          {t(
            "app.modals.overwrite.folder_exists",
            "A version of this payload exists in internal storage ({{folderName}}). Replace the existing version or keep both?",
            { folderName: uploadConflictModal.folderName }
          )}
        </p>
      </Modal>

      <aside className={cn(
        "flex-col bg-black/40 border-r border-white/5 transition-all duration-500 z-[100] h-screen",
        isPS5 ? "flex" : "hidden md:flex",
        sidebarExpanded ? "w-80" : "w-24"
      )}>
        <div className="p-6 flex flex-col h-full">
          <div className="flex items-center mb-12 h-10">
            <button
              onClick={() => setSidebarExpanded(!sidebarExpanded)}
              className="p-3 bg-white/5 hover:bg-ps-blue hover:text-white rounded-xl transition-all mr-4 shrink-0"
            >
              <Menu className="w-6 h-6" />
            </button>
            <div className={cn("flex items-center space-x-3 transition-all duration-500", sidebarExpanded ? "opacity-100 scale-100" : "opacity-0 scale-90 absolute pointer-events-none")}>
              <div className="p-2 bg-ps-blue rounded-xl">
                <LogoIcon className="w-6 h-6 text-white" />
              </div>
              <span className="text-2xl font-bold tracking-tight text-white">PLDMGR</span>
            </div>
          </div>

          <nav className="flex-1 space-y-2">
            <NavButton sidebar sidebarExpanded={sidebarExpanded} active={view === 'dashboard'} onClick={() => navigate('dashboard')} icon={LayoutDashboard} label={t("app.nav.dashboard", "Dashboard")} />
            <NavButton sidebar sidebarExpanded={sidebarExpanded} active={view === 'storage'} onClick={() => navigate('storage')} icon={Database} label={t("app.nav.storage", "Get Payloads")} />
            <NavButton sidebar sidebarExpanded={sidebarExpanded} active={view === 'autoload'} onClick={() => navigate('autoload')} icon={RefreshCw} label={t("app.nav.autoload", "Autoload")} />
            <NavButton sidebar sidebarExpanded={sidebarExpanded} active={view === 'processes'} onClick={() => navigate('processes')} icon={Cpu} label={t("app.nav.processes", "Active Processes")} />
            <NavButton sidebar sidebarExpanded={sidebarExpanded} active={view === 'settings'} onClick={() => navigate('settings')} icon={Settings} label={t("app.nav.settings", "Settings")} />
          </nav>

          <div className="pt-6 border-t border-white/5">
            <NavButton
              sidebar
              sidebarExpanded={sidebarExpanded}
              active={view === 'donate'}
              onClick={() => navigate('donate')}
              icon={Heart}
              label={t("app.nav.donate", "Donate")}
              className={view === 'donate' ? "bg-red-600" : "text-red-500 hover:bg-red-600/10"}
              isDonate
            />
          </div>
        </div>
      </aside>

      {/* MOBILE BOTTOM NAV */}
      <nav className={cn(
        "fixed bottom-0 inset-x-0 z-[100] bg-black/80 border-t border-white/5 h-[calc(5rem+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] flex items-center overflow-x-auto hide-scrollbar",
        isPS5 ? "hidden" : "md:hidden"
      )}>
        <NavButton active={view === 'dashboard'} onClick={() => navigate('dashboard')} icon={LayoutDashboard} label={t("app.nav.dashboard", "Dashboard")} mobileLabel={t("app.nav.home_mobile", "Home")} />
        <NavButton showSeparator active={view === 'storage'} onClick={() => navigate('storage')} icon={Database} label={t("app.nav.storage", "Get Payloads")} mobileLabel={t("app.nav.manage_mobile", "Get")} />
        <NavButton showSeparator active={view === 'autoload'} onClick={() => navigate('autoload')} icon={RefreshCw} label={t("app.nav.autoload", "Autoload")} mobileLabel={t("app.nav.auto_mobile", "Auto")} />
        <NavButton showSeparator active={view === 'processes'} onClick={() => navigate('processes')} icon={Cpu} label={t("app.nav.processes", "Active Processes")} mobileLabel={t("app.nav.processes_mobile", "Processes")} />
        <NavButton showSeparator active={view === 'settings'} onClick={() => navigate('settings')} icon={Settings} label={t("app.nav.settings", "Settings")} mobileLabel={t("app.nav.settings", "Settings")} />
        <NavButton
          showSeparator
          active={view === 'donate'}
          onClick={() => navigate('donate')}
          icon={Heart}
          label={t("app.nav.donate", "Donate")}
          mobileLabel={t("app.nav.donate", "Donate")}
          isDonate
        />
      </nav>

      {/* MAIN CONTENT AREA */}
      <div className={cn(
        "flex flex-col relative",
        isPS5 ? "h-screen flex-1 min-h-0" : "md:h-screen md:flex-1 md:min-h-0"
      )}>
        <main ref={mainRef} className={cn(
          "custom-scrollbar max-w-[1800px] mx-auto w-full flex flex-col",
          isPS5 ? "pt-16 px-16 pb-12 flex-1 overflow-y-auto" : "pt-6 px-6 pb-36 md:pt-16 md:px-16 md:pb-12 md:flex-1 md:overflow-y-auto"
        )}>
          <ErrorBoundary title={t("app.error.view_error", "View Render Error")} canDismiss>
          {view === 'dashboard' && (() => {
            const itemMap = new Map()
            for (const d of dashboardItems) {
              if (d && d.key) itemMap.set(d.key, d)
            }
            const activeFavoriteItems = favoritePayloads
              .map(k => itemMap.get(k))
              .filter(Boolean)
            const activeFavoriteKeys = new Set(activeFavoriteItems.map(d => d.key))
            const unfavorited = dashboardItems.filter(d => !activeFavoriteKeys.has(d.key))
            
            // Extract translations to variables for i18next-parser compatibility
            const txtFavorites = t("app.dashboard.favorites", "Favorites")
            const txtOthers = t("app.dashboard.others", "Others")

            const gridCols = cn(
              "grid gap-4 md:gap-6 transition-all",
              isPS5 ? "grid-cols-3 xl:grid-cols-4" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            )
            const makeCard = (item) => {
              if (!item) return null
              const itemObj = (typeof item === 'string')
                ? (itemMap.get(item) || {
                    key: item,
                    slot: item,
                    path: item,
                    filename: item.split('/').pop(),
                    name: item.split('/').pop(),
                    kind: 'local',
                    isUsb: item.startsWith('/mnt/usb'),
                  })
                : item

              const isUsb = Boolean(itemObj.isUsb)
              let displayName = itemObj.name || itemObj.filename || ''
              let version = itemObj.version || null
              let author = null
              let icon = null
              let sourceName = null

              if (isUsb) {
                const parsed = parsePayloadName(itemObj.filename)
                displayName = parsed.displayName
                version = parsed.version
              } else if (itemObj.kind === 'local') {
                const parsed = parsePayloadName(itemObj.filename)
                displayName = parsed.displayName
                version = itemObj.version || parsed.version
                sourceName = t("app.dashboard.manual_badge", "Manual")
              } else {
                const repoMeta = getRepoEntry(itemObj.source_url, itemObj.id) || findRepoEntryById(itemObj.id)
                displayName = repoMeta?.name || itemObj.name || itemObj.id || itemObj.filename
                version = itemObj.version || repoMeta?.version || null
                author = repoMeta?.author || itemObj.author || null
                icon = repoMeta?.icon || null
                if (itemObj.hasDuplicateId || config.MULTI_SOURCES_ENABLED) {
                  sourceName = itemObj.source_name || repoMeta?.source_name || null
                }
              }

              const pathProp = itemObj.isUsb ? itemObj.path : (itemObj.path || itemObj.filename || itemObj.slot || '')
              const slotOrKey = itemObj.slot || itemObj.key || itemObj.path || ''
              const favIndex = favoritePayloads.indexOf(itemObj.key)
              const isFavorite = favIndex !== -1

              return (
                <PayloadButton
                  key={itemObj.key || slotOrKey}
                  path={pathProp}
                  itemKey={itemObj.key}
                  onClick={() => {
                    if (isManageMode) {
                      if (!isUsb) handleDelete(itemObj.slot || slotOrKey, displayName)
                      return
                    }
                    if (isFavoriteEditMode) toggleFavorite(itemObj.key)
                    else loadPayload(itemObj.isUsb ? itemObj.path : (itemObj.slot || slotOrKey), displayName)
                  }}
                  onDelete={() => handleDelete(itemObj.slot || slotOrKey, displayName)}
                  isLoading={loading && activeLoadingName === (displayName || '').replace(/\.(elf|bin)$/i, '').replace(/_/g, ' ')}
                  sourceName={sourceName}
                  version={version}
                  icon={icon}
                  author={author}
                  displayName={displayName}
                  isFavorite={isFavorite}
                  isLaunched={launchHistory.includes(itemObj.key) || launchHistory.includes(itemObj.path)}
                  isEditMode={isFavoriteEditMode}
                  isManageMode={isManageMode}
                  onMoveFavorite={(dir) => moveFavorite(itemObj.key, dir)}
                  canMoveLeft={isFavorite && favIndex > 0}
                  canMoveRight={isFavorite && favIndex < favoritePayloads.length - 1}
                />
              )
            }
            return (
              <div className={cn(
                "space-y-8 md:space-y-12 transition-all",
                isFavoriteEditMode ? "-m-4 md:-m-6 p-4 md:p-6 border-2 border-yellow-400/50 bg-yellow-400/5 rounded-ps-2xl" :
                isManageMode ? "-m-4 md:-m-6 p-4 md:p-6 border-2 border-red-500/50 bg-red-500/5 rounded-ps-2xl" : ""
              )}>
                <div className="flex items-center justify-between">
                  <h2 className={cn(
                    "text-4xl font-extrabold tracking-tight",
                    isFavoriteEditMode ? "text-yellow-400" : isManageMode ? "text-red-500" : "text-white"
                  )}>
                    {isFavoriteEditMode ? (
                      t("app.dashboard.editFavorites", "Edit Favorites")
                    ) : isManageMode ? (
                      t("app.dashboard.removePayload", "Remove Payload")
                    ) : (
                      <>{t("app.dashboard.title_1", "Launch")} <span className="text-ps-blue">{t("app.dashboard.title_2", "Payload")}</span></>
                    )}
                  </h2>
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => { setIsManageMode(!isManageMode); setIsFavoriteEditMode(false); }}
                      className={cn(
                        "p-3 rounded-full transition-colors flex items-center justify-center",
                        isManageMode ? "bg-red-600/20 text-red-500" : "bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10"
                      )}
                      title={t("app.dashboard.removePayload", "Remove Payload")}
                    >
                      <Trash2 className={cn("w-6 h-6", isManageMode && "text-red-500")} />
                    </button>
                    <button
                      onClick={() => { setIsFavoriteEditMode(!isFavoriteEditMode); setIsManageMode(false); }}
                      className={cn(
                        "p-3 rounded-full transition-colors flex items-center justify-center",
                        isFavoriteEditMode ? "bg-yellow-400/20 text-yellow-400" : "bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10"
                      )}
                      title={t("app.dashboard.editFavorites", "Edit Favorites")}
                    >
                      <Star className={cn("w-6 h-6", isFavoriteEditMode && "fill-yellow-400")} />
                    </button>
                  </div>
                </div>
                {loadingPayloads ? (
                  <div className={gridCols}>
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="glass-card p-6 rounded-ps-xl flex flex-col space-y-2 border-white/5">
                        <div className="h-7 w-40 bg-white/5 rounded-lg" />
                        <div className="h-3 w-20 bg-white/5 rounded-md opacity-50" />
                      </div>
                    ))}
                  </div>
                ) : dashboardItems.length === 0 ? (
                  <div className={gridCols}>
                    <div className="col-span-full py-20 border-2 border-dashed border-white/5 rounded-ps-xl flex flex-col items-center justify-center space-y-6 bg-white/[0.01]">
                      <Package className="w-16 h-16 text-white/10" />
                      <div className="text-center">
                        <p className="text-white font-extrabold tracking-tight text-2xl">{t("app.dashboard.empty.title", "Empty Library")}</p>
                        <p className="text-zinc-500 font-medium">{t("app.dashboard.empty.message", "Add payloads from the Cloud Hub to get started.")}</p>
                      </div>
                      <button onClick={() => { setStorageScrollTarget('cloud-repository'); navigate('storage'); }} className="px-8 py-3 bg-ps-blue text-white rounded-xl font-bold tracking-tight">{t("app.dashboard.empty.button", "Open Repository")}</button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-8 md:space-y-12">
                    {activeFavoriteItems.length > 0 && (
                      <div className="space-y-4">
                        <div className="flex items-center gap-3">
                          <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
                          <span className="text-sm font-bold tracking-widest uppercase text-yellow-400">{txtFavorites}</span>
                        </div>
                        <div className={gridCols}>
                          {activeFavoriteItems.map(makeCard)}
                        </div>
                        <div className="border-t border-white/5 pt-8">
                          <p className="text-sm font-bold tracking-widest uppercase text-zinc-500 mb-4">{txtOthers}</p>
                          <div className={gridCols}>
                            {unfavorited.map(makeCard)}
                          </div>
                        </div>
                      </div>
                    )}
                    {activeFavoriteItems.length === 0 && (
                      <div className={gridCols}>
                        {dashboardItems.map(makeCard)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })()}

          {view === 'storage' && (
            <StorageHub
              items={items}
              payloads={payloads}
              payloadMeta={payloadMeta}
              onInstall={handleInstall}
              onDelete={handleDelete}
              onUpload={handleUpload}
              onImportFromUsb={handleImportFromUsb}
              config={config}
              ip={ip}
              scrollTarget={storageScrollTarget}
              onClearScrollTarget={() => setStorageScrollTarget(null)}
              selectedPayload={selectedPayload}
              onSelectPayload={handleSelectPayload}
              onClosePayload={handleClosePayload}
            />
          )}

          {view === 'move_from_usb' && moveFromUsbPath && (
            <MoveFromUsbView
              path={moveFromUsbPath}
              onBack={() => navigate('storage')}
              onComplete={() => {
                refreshPayloads()
                navigate('storage')
                setMoveFromUsbPath(null)
              }}
              addToast={addToast}
            />
          )}

          {view === 'autoload' && (
            <AutoloadView
              items={items}
              payloads={payloads}
              config={config}
              onSaveConfig={handleSaveConfig}
              onToast={addToast}
              onRedirect={(v, target) => {
                if (target) setStorageScrollTarget(target)
                navigate(v)
              }}
              delayModal={autoloadDelayModal}
              setDelayModal={setAutoloadDelayModal}
            />
          )}

          {view === 'settings' && (
            <SettingsView
              config={config}
              onSaveConfig={handleSaveConfig}
              isPS5={isPS5}
              logs={logs}
              setLogs={setLogs}
              showLogs={showLogs}
              setShowLogs={setShowLogs}
              onNavigate={(v) => navigate(v)}
            />
          )}

          {view === 'sources' && (
            <ManageSourcesView
              onBack={() => navigate('settings')}
              ip={ip}
              addToast={addToast}
              showConfirm={showConfirm}
            />
          )}

          {view === 'processes' && (
            <ActiveProcessesView
              ip={ip}
              addToast={addToast}
              showConfirm={showConfirm}
            />
          )}

          {view === 'donate' && <DonateView />}
          </ErrorBoundary>
        </main>
      </div>

      {loading && (
        <div className="fixed inset-0 bg-ps-black/95 z-[9999] flex flex-col items-center justify-center space-y-12">
          <div className="ps5-robust-spinner" />
          <div className="text-center">
            <h4 className="text-4xl font-extrabold text-white tracking-tight mb-4 uppercase italic">{activeLoadingName || t("app.loading.title", "Launching...")}</h4>
            <p className="label-caps !text-ps-blue tracking-[0.3em] font-black">{t("app.loading.subtitle", "LAUNCHING PAYLOAD...")}</p>
          </div>
        </div>
      )}
      {showLogs && (
        <div className="fixed inset-0 z-[9999] bg-[#08080a] flex flex-col animate-in fade-in duration-300">
          <div className="p-6 md:p-8 border-b border-white/10 flex items-center justify-between bg-[#08080a]/95 backdrop-blur-xl sticky top-0 z-10">
            <div className="flex items-center space-x-4">
              <Terminal className="w-8 h-8 text-ps-blue" />
              <h3 className="text-3xl font-black text-white uppercase italic tracking-tighter">{t("app.logs.title", "Logs")}</h3>
            </div>
            <button
              onClick={() => setShowLogs(false)}
              className="p-4 rounded-2xl bg-white/5 hover:bg-red-600 hover:text-white transition-all border border-white/10 group"
            >
              <X className="w-8 h-8 transition-transform group-hover:rotate-90" />
            </button>
          </div>
          <div className="flex-1 overflow-hidden bg-black/20">
            <LogViewer logs={logs} />
          </div>
        </div>
      )}
    </div>
  )
}

export default App
