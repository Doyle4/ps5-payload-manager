import { useEffect, useRef, useCallback } from 'react'

export function getRouteFromHash(hash) {
  const clean = (hash || '').replace(/^#\/?/, '').split('?')[0].trim()
  if (!clean || clean === 'dashboard') return { type: 'dashboard' }
  if (clean === 'storage') return { type: 'storage' }
  if (clean === 'autoload') return { type: 'autoload' }
  if (clean === 'processes') return { type: 'processes' }
  if (clean === 'settings') return { type: 'settings' }
  if (clean === 'donate') return { type: 'donate' }
  if (clean === 'sources') return { type: 'sources' }
  if (clean === 'move-from-usb' || clean === 'move_from_usb') return { type: 'move_from_usb' }
  return { type: 'dashboard' }
}

export function formatHash(route) {
  if (!route || route.type === 'dashboard') return '#/'
  if (route.type === 'storage') return '#/storage'
  if (route.type === 'autoload') return '#/autoload'
  if (route.type === 'processes') return '#/processes'
  if (route.type === 'settings') return '#/settings'
  if (route.type === 'donate') return '#/donate'
  if (route.type === 'sources') return '#/sources'
  if (route.type === 'move_from_usb') return '#/move-from-usb'
  return '#/'
}

export function writeHistory(route, replace = false) {
  if (!window.history || !window.history.pushState) return
  const hash = formatHash(route)
  if (!replace && window.location.hash === hash && !route.isModal) return
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
  if (!window.history || !window.history.pushState || !window.history.replaceState) return

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
  if (m.selectedPayload) list.push('selectedPayload')
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
  const currentRouteRef = useRef({ type: view })
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
    selectedPayload ||
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

    if (hashRoute.type !== 'dashboard') {
      if (hashRoute.type === 'move_from_usb' && !modalStateRef.current.moveFromUsbPath) {
        setView('storage')
        writeHistory({ type: 'storage' }, true)
      } else {
        setView(hashRoute.type)
      }
    }
  }, [setView])

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
        } else if (top === 'selectedPayload') {
          if (m.setSelectedPayload) m.setSelectedPayload(null)
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

      // Fallback for move_from_usb if no path is loaded
      if (target.type === 'move_from_usb' && !m.moveFromUsbPath) {
        currentRouteRef.current = { type: 'storage' }
        currentViewRef.current = 'storage'
        setView('storage')
        return
      }

      // 3. If user was ALREADY on dashboard and pressed Back, close PS5 browser
      if (curView === 'dashboard' && target.type === 'dashboard') {
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
      currentViewRef.current = target.type

      if (curView === 'move_from_usb' && target.type !== 'move_from_usb') {
        if (m.setMoveFromUsbPath) m.setMoveFromUsbPath(null)
      }

      setView(target.type)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [setView])

  // Navigate between views
  const navigate = useCallback((newView) => {
    if (newView === currentViewRef.current) return
    const prevView = currentViewRef.current

    if (newView === 'dashboard') {
      if (prevView !== 'dashboard') {
        if (window.history && window.history.length > 1) {
          window.history.back()
          return
        }
      }
      writeHistory({ type: 'dashboard' }, true)
      setView('dashboard')
      currentRouteRef.current = { type: 'dashboard' }
      currentViewRef.current = 'dashboard'
      return
    }

    if (prevView === 'dashboard') {
      writeHistory({ type: newView }, false)
    } else if (newView === 'sources' || newView === 'move_from_usb') {
      writeHistory({ type: newView }, false)
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
      writeHistory({ type: newView }, true)
    }

    setView(newView)
    currentRouteRef.current = { type: newView }
    currentViewRef.current = newView
  }, [setView])

  return { navigate }
}
