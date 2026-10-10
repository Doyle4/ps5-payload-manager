import { useEffect, useRef, useCallback } from 'react'

export function getRouteFromHash(hash) {
  const clean = (hash || '').replace(/^#\/?/, '').trim()
  if (!clean || clean === 'dashboard') return { type: 'dashboard' }

  const [rawPath, rawQuery] = clean.split('?')
  const queryParams = new URLSearchParams(rawQuery || '')

  if (rawPath === 'storage') return { type: 'storage' }

  if (rawPath === 'payload' || rawPath === 'storage/payload') {
    return { type: 'storage' }
  }

  if (rawPath.startsWith('payload/') || rawPath.startsWith('storage/payload/')) {
    const slashIdx = rawPath.indexOf('payload/')
    const filename = decodeURIComponent(rawPath.slice(slashIdx + 8).trim())
    if (!filename) return { type: 'storage' }
    const srcId = queryParams.get('src') || null
    return { type: 'payload', filename, srcId }
  }

  if (rawPath === 'autoload') return { type: 'autoload' }
  if (rawPath === 'processes') return { type: 'processes' }
  if (rawPath === 'settings') return { type: 'settings' }
  if (rawPath === 'donate') return { type: 'donate' }
  if (rawPath === 'sources') return { type: 'sources' }

  if (rawPath === 'move-from-usb' || rawPath === 'move_from_usb') {
    const path = queryParams.get('path') || null
    return { type: 'move_from_usb', path }
  }

  if (rawPath.startsWith('move-from-usb/') || rawPath.startsWith('move_from_usb/')) {
    const slashIdx = rawPath.indexOf('/')
    const path = decodeURIComponent(rawPath.slice(slashIdx + 1).trim())
    return { type: 'move_from_usb', path }
  }

  return { type: 'dashboard' }
}

export function formatHash(route) {
  if (!route || route.type === 'dashboard') return '#/'
  if (route.type === 'storage') return '#/storage'
  if (route.type === 'payload') {
    if (!route.filename) return '#/storage'
    const encodedName = encodeURIComponent(route.filename)
    if (route.srcId) {
      return `#/payload/${encodedName}?src=${encodeURIComponent(route.srcId)}`
    }
    return `#/payload/${encodedName}`
  }
  if (route.type === 'autoload') return '#/autoload'
  if (route.type === 'processes') return '#/processes'
  if (route.type === 'settings') return '#/settings'
  if (route.type === 'donate') return '#/donate'
  if (route.type === 'sources') return '#/sources'
  if (route.type === 'move_from_usb') {
    if (route.path) {
      return `#/move-from-usb?path=${encodeURIComponent(route.path)}`
    }
    return '#/move-from-usb'
  }
  return '#/'
}

export function writeHistory(route, replace = false) {
  if (typeof window === 'undefined' || !window.history || !window.history.pushState) return
  const hash = formatHash(route)
  if (!replace && window.location?.hash === hash && !route.isModal) return
  const state = { ...route, hash }
  try {
    if (replace && window.history.replaceState) {
      window.history.replaceState(state, '', hash)
    } else {
      window.history.pushState(state, '', hash)
    }
  } catch {
    /* ignore history write errors */
  }
}

export function getHistoryChain(route) {
  if (!route || route.type === 'dashboard') {
    return [{ type: 'dashboard' }]
  }
  if (route.type === 'sources') {
    return [
      { type: 'dashboard' },
      { type: 'settings' },
      route,
    ]
  }
  if (route.type === 'payload') {
    if (!route.filename) {
      return [
        { type: 'dashboard' },
        { type: 'storage' },
      ]
    }
    return [
      { type: 'dashboard' },
      { type: 'storage' },
      route,
    ]
  }
  if (route.type === 'move_from_usb') {
    return [
      { type: 'dashboard' },
      { type: 'storage' },
      route,
    ]
  }
  return [
    { type: 'dashboard' },
    route,
  ]
}

export function seedHistory(route) {
  if (typeof window === 'undefined' || !window.history || !window.history.pushState || !window.history.replaceState) return

  const chain = getHistoryChain(route)
  for (let i = 0; i < chain.length; i++) {
    const r = chain[i]
    const hash = formatHash(r)
    const state = { ...r, hash }
    try {
      if (i === 0 && window.history.replaceState) {
        window.history.replaceState(state, '', hash)
      } else {
        window.history.pushState(state, '', hash)
      }
    } catch {
      /* ignore history seed errors */
    }
  }
}

function getActiveModals(m, currentView) {
  const list = []
  if (m.confirmModal?.show) list.push('confirmModal')
  if (m.downloadModal?.show) list.push('downloadModal')
  if (m.showLogs) list.push('showLogs')
  if (m.delayModal) list.push('delayModal')
  if (currentView === 'dashboard') {
    if (m.isManageMode) list.push('manageMode')
    if (m.isFavoriteEditMode) list.push('favoriteEditMode')
  }
  return list
}

export function useHistoryNavigation({
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
  delayModal,
  setDelayModal,
}) {
  const currentViewRef = useRef(view)
  const currentRouteRef = useRef(
    selectedPayload
      ? { type: 'payload', filename: selectedPayload.payload?.filename || selectedPayload.filename, srcId: selectedPayload.srcId || null }
      : { type: view, ...(view === 'move_from_usb' ? { path: moveFromUsbPath } : {}) }
  )
  const selectedPayloadRef = useRef(selectedPayload)
  const moveFromUsbPathRef = useRef(moveFromUsbPath)
  const historySeededRef = useRef(false)
  const modalPushedRef = useRef(false)
  const isProgrammaticModalCloseRef = useRef(false)

  const modalStateRef = useRef({
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
    delayModal,
    setDelayModal,
  })

  useEffect(() => {
    currentViewRef.current = view
  }, [view])

  useEffect(() => {
    selectedPayloadRef.current = selectedPayload
  }, [selectedPayload])

  useEffect(() => {
    moveFromUsbPathRef.current = moveFromUsbPath
  }, [moveFromUsbPath])

  useEffect(() => {
    modalStateRef.current = {
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
      delayModal,
      setDelayModal,
    }
  }, [
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
    delayModal,
    setDelayModal,
  ])

  const isModalActive = Boolean(
    confirmModal?.show ||
    showLogs ||
    downloadModal?.show ||
    delayModal ||
    (view === 'dashboard' && (isManageMode || isFavoriteEditMode))
  )

  // Manage modal history entry so Circle on PS5 pops modal without closing browser
  useEffect(() => {
    if (isModalActive) {
      if (!modalPushedRef.current) {
        modalPushedRef.current = true
        try {
          window.history.pushState(
            { ...currentRouteRef.current, isModal: true },
            '',
            window.location.hash
          )
        } catch {
          /* ignore push errors */
        }
      }
    } else {
      if (modalPushedRef.current) {
        modalPushedRef.current = false
        try {
          if (window.history.state?.isModal) {
            isProgrammaticModalCloseRef.current = true
            window.history.back()
          }
        } catch {
          /* ignore pop errors */
        }
      }
    }
  }, [isModalActive])

  // Seed baseline history on initial load
  useEffect(() => {
    if (historySeededRef.current) return
    historySeededRef.current = true

    const hashRoute = getRouteFromHash(window.location.hash)
    currentRouteRef.current = hashRoute
    seedHistory(hashRoute)

    if (hashRoute.type === 'payload') {
      setView('storage')
      if (hashRoute.filename) {
        setSelectedPayload({ filename: hashRoute.filename, srcId: hashRoute.srcId })
      }
    } else if (hashRoute.type === 'move_from_usb') {
      if (hashRoute.path) {
        setMoveFromUsbPath(hashRoute.path)
        setView('move_from_usb')
      } else if (!modalStateRef.current.moveFromUsbPath) {
        setView('storage')
        writeHistory({ type: 'storage' }, true)
      } else {
        setView('move_from_usb')
      }
    } else if (hashRoute.type !== 'dashboard') {
      setView(hashRoute.type)
    }
  }, [setView, setSelectedPayload, setMoveFromUsbPath])

  // Handlers for payload selection / closing
  const handleClosePayload = useCallback(() => {
    if (typeof window !== 'undefined' && window.history && window.history.length > 1 && currentRouteRef.current?.type === 'payload') {
      window.history.back()
    } else {
      if (modalStateRef.current.setSelectedPayload) {
        modalStateRef.current.setSelectedPayload(null)
      }
      selectedPayloadRef.current = null
      const route = { type: 'storage' }
      currentRouteRef.current = route
      writeHistory(route, true)
      setView('storage')
    }
  }, [setView])

  const handleSelectPayload = useCallback((payloadData) => {
    if (!payloadData) {
      handleClosePayload()
      return
    }
    const filename = payloadData.payload?.filename || payloadData.filename
    const srcId = payloadData.srcId || null
    const route = { type: 'payload', filename, srcId }
    setSelectedPayload(payloadData)
    selectedPayloadRef.current = payloadData
    currentRouteRef.current = route
    writeHistory(route, false)
  }, [setSelectedPayload, handleClosePayload])

  // Listen to popstate (Circle button on PS5 controller or browser back/forward)
  useEffect(() => {
    const handlePopState = () => {
      if (isProgrammaticModalCloseRef.current) {
        isProgrammaticModalCloseRef.current = false
        return
      }

      const m = modalStateRef.current
      const curView = currentViewRef.current
      const activeModals = getActiveModals(m, curView)

      // 1. Dismiss any open modal or panel first
      if (activeModals.length > 0) {
        const top = activeModals[0]
        if (top === 'confirmModal') {
          m.setConfirmModal({ show: false, title: '', message: '', onConfirm: null })
        } else if (top === 'downloadModal') {
          m.setDownloadModal({ show: false, name: '', progress: 0 })
        } else if (top === 'showLogs') {
          m.setShowLogs(false)
        } else if (top === 'delayModal') {
          if (m.setDelayModal) m.setDelayModal(false)
        } else if (top === 'manageMode') {
          if (m.setIsManageMode) m.setIsManageMode(false)
        } else if (top === 'favoriteEditMode') {
          if (m.setIsFavoriteEditMode) m.setIsFavoriteEditMode(false)
        }

        // If another modal or mode is still active underneath, re-push so next Back press pops it
        if (activeModals.length > 1) {
          try {
            window.history.pushState(
              { ...currentRouteRef.current, isModal: true },
              '',
              window.location.hash
            )
            modalPushedRef.current = true
          } catch {
            /* ignore push errors */
          }
        } else {
          modalPushedRef.current = false
        }
        return
      }

      // 2. Read destination target
      const target = getRouteFromHash(window.location.hash)

      // 3. If user was ALREADY on dashboard and target is dashboard (Circle pressed on root), close PS5 browser
      if (curView === 'dashboard' && target.type === 'dashboard' && !selectedPayloadRef.current) {
        try {
          window.close()
        } catch {
          /* ignore close error */
        }
        try {
          window.history.back()
        } catch {
          /* ignore back error */
        }
        return
      }

      // 4. View transition
      currentRouteRef.current = target

      if (target.type === 'payload') {
        currentViewRef.current = 'storage'
        setView('storage')
        if (m.setSelectedPayload) {
          m.setSelectedPayload({ filename: target.filename, srcId: target.srcId })
        }
        return
      }

      if (target.type === 'storage') {
        if (m.setSelectedPayload) {
          m.setSelectedPayload(null)
        }
        if (curView === 'move_from_usb' && m.setMoveFromUsbPath) {
          m.setMoveFromUsbPath(null)
        }
        currentViewRef.current = 'storage'
        setView('storage')
        return
      }

      if (target.type === 'move_from_usb') {
        if (target.path && m.setMoveFromUsbPath) {
          m.setMoveFromUsbPath(target.path)
        } else if (!m.moveFromUsbPath) {
          currentRouteRef.current = { type: 'storage' }
          currentViewRef.current = 'storage'
          setView('storage')
          return
        }
        if (m.setSelectedPayload) m.setSelectedPayload(null)
        currentViewRef.current = 'move_from_usb'
        setView('move_from_usb')
        return
      }

      // Other views: clear payload & usb path
      if (m.setSelectedPayload) m.setSelectedPayload(null)
      if (curView === 'move_from_usb' && m.setMoveFromUsbPath) {
        m.setMoveFromUsbPath(null)
      }

      currentViewRef.current = target.type
      setView(target.type)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [setView])

  // Navigate between views
  const navigate = useCallback((newView, options = {}) => {
    if (newView === currentViewRef.current && !selectedPayloadRef.current) return
    const prevView = currentViewRef.current

    // Returning to storage while viewing a payload detail should pop history back to storage
    if (currentRouteRef.current?.type === 'payload' && newView === 'storage') {
      handleClosePayload()
      return
    }

    if (selectedPayloadRef.current) {
      if (modalStateRef.current.setSelectedPayload) {
        modalStateRef.current.setSelectedPayload(null)
      }
      selectedPayloadRef.current = null
    }

    if (newView === 'dashboard') {
      const curChain = getHistoryChain(currentRouteRef.current)
      if (curChain.length > 1 && window.history && window.history.length > 1) {
        window.history.go(-(curChain.length - 1))
        return
      }
      writeHistory({ type: 'dashboard' }, true)
      setView('dashboard')
      currentRouteRef.current = { type: 'dashboard' }
      currentViewRef.current = 'dashboard'
      return
    }

    let route = { type: newView }
    if (newView === 'move_from_usb') {
      const usbPath = options?.path || modalStateRef.current.moveFromUsbPath
      route = { type: 'move_from_usb', path: usbPath }
      if (options?.path && modalStateRef.current.setMoveFromUsbPath) {
        modalStateRef.current.setMoveFromUsbPath(options.path)
      }
    }

    if (prevView === 'dashboard') {
      writeHistory(route, false)
    } else if (newView === 'sources' || newView === 'move_from_usb') {
      writeHistory(route, false)
    } else if (prevView === 'sources' && newView === 'settings') {
      if (window.history && window.history.length > 1) {
        window.history.back()
        return
      }
      writeHistory({ type: 'settings' }, true)
    } else if (prevView === 'move_from_usb' && newView === 'storage') {
      if (window.history && window.history.length > 1) {
        window.history.back()
        return
      }
      writeHistory({ type: 'storage' }, true)
    } else {
      // Switching between top-level pages replaces state so stack remains [0: dashboard, 1: current page]
      writeHistory(route, true)
    }

    setView(newView)
    currentRouteRef.current = route
    currentViewRef.current = newView
  }, [setView, handleClosePayload])

  return { navigate, handleSelectPayload, handleClosePayload }
}
