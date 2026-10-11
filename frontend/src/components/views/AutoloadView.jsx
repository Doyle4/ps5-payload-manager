import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { RefreshCw, ArrowLeft, ArrowRight, Activity, Zap, ChevronUp, ChevronDown, Trash2, Globe } from 'lucide-react'
import { cn, isPS5, isSystemPayload, parsePayloadName } from '../../utils/helpers'
import { useTranslation } from 'react-i18next'
import PayloadName from '../ui/PayloadName'
import PayloadIcon from '../ui/PayloadIcon'
import Modal from '../ui/Modal'
import { useRepository } from '../../contexts/RepositoryContext'

const AutoloadView = ({
  items = [],
  payloads = [],
  config,
  onSaveConfig,
  onToast,
  onRedirect,
  delayModal: delayModalProp,
  setDelayModal: setDelayModalProp,
}) => {
  const { t } = useTranslation()
  const repoContext = useRepository()
  const getRepoEntry = repoContext?.getRepoEntry
  const findRepoEntryById = repoContext?.findRepoEntryById
  const [subView, setSubView] = useState('list')
  const [enabled, setEnabled] = useState(false)
  const [autoloadList, setAutoloadList] = useState([])
  const [localDelayModal, setLocalDelayModal] = useState(false)
  const showDelayModal = delayModalProp !== undefined ? delayModalProp : localDelayModal
  const setShowDelayModal = setDelayModalProp || setLocalDelayModal
  const [customDelay, setCustomDelay] = useState('')
  const [isInitialized, setIsInitialized] = useState(false)
  const stateRef = useRef({ enabled: false, list: [] })
  stateRef.current = { enabled, list: autoloadList }

  const isSavingRef = useRef(false)
  const pendingSaveRef = useRef(false)
  const lastSyncedRef = useRef('')

  // Load initial config
  useEffect(() => {
    if (config && !isInitialized) {
      const en = config.AUTOLOAD_ENABLED === true || config.AUTOLOAD_ENABLED === "true"
      const listStr = config.AUTOLOAD_LIST || ''
      setEnabled(en)
      const parsedList = listStr.split(',').filter(Boolean)
      setAutoloadList(parsedList)
      stateRef.current = { enabled: en, list: parsedList }
      lastSyncedRef.current = `${en}:${listStr}`
      setIsInitialized(true)
    }
  }, [config, isInitialized])

  // Immediate save coordinator with in-flight queueing
  const saveState = useCallback(async (targetList, targetEnabled) => {
    const listToSave = targetList !== undefined ? targetList : stateRef.current.list
    const enabledToSave = targetEnabled !== undefined ? targetEnabled : stateRef.current.enabled

    const finalList = listToSave.map((p) => (p === 'DELAY' ? '!1000' : p))
    const finalStr = finalList.join(',')
    const syncKey = `${enabledToSave}:${finalStr}`

    if (syncKey === lastSyncedRef.current) return

    if (isSavingRef.current) {
      pendingSaveRef.current = true
      return
    }

    isSavingRef.current = true
    pendingSaveRef.current = false

    try {
      const success = await onSaveConfig({
        AUTOLOAD_ENABLED: enabledToSave,
        AUTOLOAD_LIST: finalStr,
      })

      if (success) {
        lastSyncedRef.current = syncKey
      }
    } finally {
      isSavingRef.current = false
      if (pendingSaveRef.current) {
        saveState()
      }
    }
  }, [onSaveConfig])

  // Safety flush on component unmount and window unload/pagehide
  useEffect(() => {
    const flushSave = () => {
      const { list, enabled: en } = stateRef.current
      const finalList = list.map((p) => (p === 'DELAY' ? '!1000' : p))
      const finalStr = finalList.join(',')
      const syncKey = `${en}:${finalStr}`
      if (syncKey !== lastSyncedRef.current) {
        lastSyncedRef.current = syncKey
        try {
          const body = JSON.stringify({
            ...config,
            AUTOLOAD_ENABLED: en,
            AUTOLOAD_LIST: finalStr,
          })
          if (navigator.sendBeacon) {
            navigator.sendBeacon('/set_config', body)
          } else {
            fetch('/set_config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body,
              keepalive: true,
            })
          }
        } catch {
          /* ignore flush errors */
        }
      }
    }

    window.addEventListener('beforeunload', flushSave)
    window.addEventListener('pagehide', flushSave)
    return () => {
      flushSave()
      window.removeEventListener('beforeunload', flushSave)
      window.removeEventListener('pagehide', flushSave)
    }
  }, [config])

  const availableSlots = useMemo(() => {
    if (items && items.length > 0) {
      return items.filter(
        (it) => it.slot && !isSystemPayload(it.filename) && !isSystemPayload(it.name) && it.id !== 'pldmgr' && !autoloadList.includes(it.slot)
      )
    }
    // Fallback if items not loaded yet
    return payloads
      .filter((p) => !p.includes('/mnt/usb') && !isSystemPayload(p))
      .map((p) => {
        const fn = p.split('/').pop()
        return { slot: fn, filename: fn, name: fn }
      })
      .filter((it) => !autoloadList.includes(it.slot))
  }, [items, payloads, autoloadList])

  const getItemInfo = useCallback(
    (key) => {
      if (!key) return null
      if (items && items.length > 0) {
        const match = items.find(
          (it) => it.slot === key || it.filename === key || it.path === key
        )
        if (match) return match
      }
      return null
    },
    [items]
  )

  const idCounts = useMemo(() => {
    const counts = {}
    if (items) {
      for (const it of items) {
        if (it?.kind === 'repo' && it?.id) {
          counts[it.id] = (counts[it.id] || 0) + 1
        }
      }
    }
    return counts
  }, [items])

  const resolveCardMeta = useCallback(
    (keyOrItem) => {
      if (!keyOrItem) return null
      const item = typeof keyOrItem === 'object' ? keyOrItem : getItemInfo(keyOrItem)
      const rawKey = typeof keyOrItem === 'string' ? keyOrItem : (keyOrItem.slot || keyOrItem.filename || '')

      const parsed = parsePayloadName(item?.filename || rawKey)
      if (parsed.isDelay) {
        return {
          isDelay: true,
          displayName: t("autoload.delay_item", "Delay ({{seconds}}s)", { seconds: parsed.delaySeconds || 1 }),
          version: null,
          author: null,
          icon: null,
          sourceName: null,
          iconName: 'Delay',
        }
      }

      const itemObj = item || {
        slot: rawKey,
        filename: rawKey.split('/').pop(),
        name: rawKey.split('/').pop(),
        kind: 'local',
      }

      let displayName = itemObj.name || itemObj.filename || ''
      let version = itemObj.version || null
      let author = null
      let icon = null
      let sourceName = null

      if (itemObj.kind === 'local') {
        displayName = itemObj.name || parsed.displayName
        version = itemObj.version || parsed.version
        sourceName = t("app.dashboard.other_source_badge", "Other Source")
      } else {
        const repoMeta = (getRepoEntry && itemObj.source_url && itemObj.id)
          ? getRepoEntry(itemObj.source_url, itemObj.id)
          : (findRepoEntryById && itemObj.id ? findRepoEntryById(itemObj.id) : null)
        displayName = repoMeta?.name || itemObj.name || itemObj.id || itemObj.filename
        version = itemObj.version || repoMeta?.version || null
        author = repoMeta?.author || itemObj.author || null
        icon = repoMeta?.icon || null
        const hasDup = Boolean(itemObj.id && idCounts[itemObj.id] > 1)
        if (hasDup || config?.MULTI_SOURCES_ENABLED) {
          sourceName = itemObj.source_name || repoMeta?.source_name || null
        }
      }

      return {
        isDelay: false,
        slot: itemObj.slot || rawKey,
        filename: itemObj.filename || rawKey,
        displayName,
        version,
        author,
        icon,
        sourceName,
        iconName: itemObj.filename || displayName || 'Payload',
      }
    },
    [getItemInfo, getRepoEntry, findRepoEntryById, idCounts, config, t]
  )

  const handleToggle = (val) => {
    setEnabled(val)
    stateRef.current = { enabled: val, list: autoloadList }
    saveState(autoloadList, val)
  }

  const addPayload = (slotKey) => {
    const isKstuff = slotKey.toLowerCase().includes('kstuff')
    if (isKstuff) {
      const existing = autoloadList.find((x) => x.toLowerCase().includes('kstuff'))
      if (existing) {
        onToast(t("autoload.conflict_kstuff", "Conflict: Multiple KStuff payloads detected."), 'error')
        return
      }
    }
    const nextList = [...autoloadList, slotKey]
    setAutoloadList(nextList)
    stateRef.current = { enabled, list: nextList }
    saveState(nextList, enabled)
    setSubView('list')
  }

  const addDelay = (ms) => {
    const nextList = [...autoloadList, `!${ms}`]
    setAutoloadList(nextList)
    stateRef.current = { enabled, list: nextList }
    saveState(nextList, enabled)
    setShowDelayModal(false)
    setSubView('list')
  }

  const removePayload = (index) => {
    const nextList = autoloadList.filter((_, idx) => idx !== index)
    setAutoloadList(nextList)
    stateRef.current = { enabled, list: nextList }
    saveState(nextList, enabled)
  }

  const moveUp = (index) => {
    if (index === 0) return
    const nextList = [...autoloadList]
    ;[nextList[index - 1], nextList[index]] = [nextList[index], nextList[index - 1]]
    setAutoloadList(nextList)
    stateRef.current = { enabled, list: nextList }
    saveState(nextList, enabled)
  }

  const moveDown = (index) => {
    if (index === autoloadList.length - 1) return
    const nextList = [...autoloadList]
    ;[nextList[index + 1], nextList[index]] = [nextList[index], nextList[index + 1]]
    setAutoloadList(nextList)
    stateRef.current = { enabled, list: nextList }
    saveState(nextList, enabled)
  }

  const renderAvailable = () => (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between shrink-0 h-11 mb-4">
        <div className="flex items-center space-x-4">
          {subView === 'add' && (
            <button onClick={() => setSubView('list')} className="p-2 bg-white/5 rounded-xl border border-white/10 lg:hidden">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <h2 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
            {t("autoload.available_title", "Available Payloads")}
          </h2>
        </div>
      </div>
      <div className="glass-panel p-4 md:p-5 rounded-ps-3xl border-white/10 flex-1 overflow-hidden flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar min-h-0 pb-2">
          <div className="grid grid-cols-1 gap-2.5">
            {availableSlots.map((item) => {
              const meta = resolveCardMeta(item)
              const isKstuff = (item.id || item.filename || item.slot || '').toLowerCase().includes('kstuff')
              const hasKstuff = autoloadList.some((x) => x.toLowerCase().includes('kstuff'))
              const isBlocked = isKstuff && hasKstuff

              return (
                <button
                  key={item.slot}
                  onClick={() => !isBlocked && addPayload(item.slot)}
                  disabled={isBlocked}
                  className={cn(
                    "group glass-card pl-4 pr-3 py-2.5 rounded-ps-xl flex flex-col justify-center border transition-all text-left relative min-h-[72px] w-full",
                    isBlocked
                      ? "opacity-40 grayscale cursor-not-allowed border-white/5"
                      : "border-white/5 hover:border-ps-blue hover:bg-ps-blue/5 focus:border-ps-blue focus:outline-none"
                  )}
                >
                  <div className="flex items-center justify-between w-full z-10 my-auto">
                    <div className="flex items-center gap-3.5 min-w-0 pr-2 flex-1">
                      <PayloadIcon icon={meta?.icon} name={meta?.iconName} className="w-11 h-11 text-xl shrink-0" />
                      <div className="min-w-0 flex-1 flex flex-col justify-center">
                        <PayloadName
                          path={meta?.filename || meta?.slot}
                          version={meta?.version}
                          hideVersion={true}
                          displayName={meta?.displayName}
                          className="text-white text-lg md:text-xl leading-snug"
                          stacked={false}
                        />
                        <div className="flex items-center gap-2 mt-0.5">
                          {meta?.version && (
                            <span className="text-[10px] text-zinc-400 font-bold bg-white/10 px-1.5 py-0.5 rounded uppercase shrink-0 leading-none">
                              {meta.version}
                            </span>
                          )}
                          {meta?.author && (
                            <div className="text-[10px] text-zinc-500 font-medium truncate leading-none">
                              {meta.author}
                            </div>
                          )}
                        </div>
                        {meta?.sourceName && (
                          <div className="flex items-center mt-0.5">
                            <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400 font-bold bg-white/10 px-1.5 py-0.5 rounded uppercase shrink-0 max-w-full select-none leading-none">
                              <Globe className="w-3 h-3 text-zinc-400 shrink-0" />
                              <span className="truncate">{meta.sourceName}</span>
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <ArrowRight className={cn(
                        "w-5 h-5 transition-all shrink-0",
                        isBlocked
                          ? "text-zinc-800"
                          : "text-zinc-500 group-hover:text-ps-blue group-hover:translate-x-1"
                      )} />
                    </div>
                  </div>
                  <div className="absolute inset-0 rounded-ps-xl bg-ps-blue/0 group-hover:bg-ps-blue/5 transition-colors z-0 pointer-events-none" />
                </button>
              )
            })}
            <div className="pt-2 border-t border-white/10 mt-1">
              <button
                onClick={() => setShowDelayModal(true)}
                className="group glass-card pl-4 pr-3 py-2.5 rounded-ps-xl flex items-center justify-between border border-dashed border-white/20 hover:border-ps-blue hover:bg-ps-blue/5 focus:border-ps-blue focus:outline-none transition-all text-left relative min-h-[58px] w-full"
              >
                <div className="flex items-center gap-3.5 min-w-0 pr-2">
                  <div className="w-10 h-10 text-lg shrink-0 rounded-xl flex items-center justify-center border border-ps-blue/30 bg-ps-blue/10 text-ps-blue">
                    <Zap className="w-5 h-5" />
                  </div>
                  <span className="font-bold text-white uppercase tracking-tight text-base leading-none">
                    {t("autoload.add_delay_btn", "Add Delay")}
                  </span>
                </div>
                <ArrowRight className="w-5 h-5 text-zinc-500 group-hover:text-ps-blue group-hover:translate-x-1 transition-all shrink-0" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const renderSequence = () => (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between shrink-0 h-11 mb-4">
        <h2 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
          {t("autoload.sequence_title_1", "Autoload")} <span className="text-ps-blue">{t("autoload.sequence_title_2", "Sequence")}</span>
        </h2>
        <button
          onClick={() => handleToggle(false)}
          className="px-3.5 py-1.5 rounded-xl font-black uppercase italic tracking-wider bg-red-600/10 text-red-500 border border-red-500/30 hover:bg-red-600 hover:text-white transition-all shadow-lg text-xs shrink-0"
        >
          {t("autoload.disable_btn", "Disable Autoload")}
        </button>
      </div>

      <div className="glass-panel p-4 md:p-5 rounded-ps-3xl border-white/10 flex-1 overflow-hidden flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 min-h-0 pb-2">
          <div className="grid grid-cols-1 gap-2.5">
            {autoloadList.map((p, i) => {
              const meta = resolveCardMeta(p)
              return (
                <div
                  key={`${p}-${i}`}
                  tabIndex={0}
                  className="group glass-card pl-4 pr-3 py-2.5 rounded-ps-xl flex flex-col justify-center border border-white/5 hover:border-ps-blue/40 focus:border-ps-blue focus:outline-none transition-all text-left relative min-h-[72px]"
                >
                  <div className="flex items-center justify-between w-full z-10 my-auto">
                    <div className="flex items-center gap-3.5 min-w-0 pr-2 flex-1">
                      <div className="relative shrink-0">
                        {meta?.isDelay ? (
                          <div className="w-11 h-11 text-xl rounded-2xl flex items-center justify-center border border-ps-blue/30 bg-ps-blue/10 text-ps-blue">
                            <Zap className="w-5 h-5" />
                          </div>
                        ) : (
                          <PayloadIcon icon={meta?.icon} name={meta?.iconName} className="w-11 h-11 text-xl shrink-0" />
                        )}
                        <div className="absolute -top-1.5 -left-1.5 z-20 w-5 h-5 rounded-full bg-ps-blue border border-black/60 flex items-center justify-center text-[10px] font-black text-white shadow select-none">
                          {i + 1}
                        </div>
                      </div>
                      <div className="min-w-0 flex-1 flex flex-col justify-center">
                        <PayloadName
                          path={meta?.filename || p}
                          version={meta?.version}
                          hideVersion={true}
                          displayName={meta?.displayName}
                          className="text-white text-lg md:text-xl leading-snug"
                          stacked={false}
                        />
                        <div className="flex items-center gap-2 mt-0.5">
                          {meta?.version && (
                            <span className="text-[10px] text-zinc-400 font-bold bg-white/10 px-1.5 py-0.5 rounded uppercase shrink-0 leading-none">
                              {meta.version}
                            </span>
                          )}
                          {meta?.author && (
                            <div className="text-[10px] text-zinc-500 font-medium truncate leading-none">
                              {meta.author}
                            </div>
                          )}
                        </div>
                        {meta?.sourceName && (
                          <div className="flex items-center mt-0.5">
                            <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400 font-bold bg-white/10 px-1.5 py-0.5 rounded uppercase shrink-0 max-w-full select-none leading-none">
                              <Globe className="w-3 h-3 text-zinc-400 shrink-0" />
                              <span className="truncate">{meta.sourceName}</span>
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 z-20 ml-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          moveUp(i)
                        }}
                        disabled={i === 0}
                        title={t("autoload.move_up", "Move Up")}
                        className="p-1.5 bg-white/5 hover:bg-ps-blue hover:text-white text-zinc-400 rounded-lg border border-white/5 hover:border-ps-blue transition-all disabled:opacity-20 disabled:pointer-events-none"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          moveDown(i)
                        }}
                        disabled={i === autoloadList.length - 1}
                        title={t("autoload.move_down", "Move Down")}
                        className="p-1.5 bg-white/5 hover:bg-ps-blue hover:text-white text-zinc-400 rounded-lg border border-white/5 hover:border-ps-blue transition-all disabled:opacity-20 disabled:pointer-events-none"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          removePayload(i)
                        }}
                        title={t("autoload.remove", "Remove")}
                        className="p-1.5 bg-white/5 hover:bg-red-600 hover:text-white text-zinc-400 hover:border-red-500 rounded-lg border border-white/5 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="absolute inset-0 rounded-ps-xl bg-ps-blue/0 group-hover:bg-ps-blue/5 transition-colors z-0 pointer-events-none" />
                </div>
              )
            })}
          </div>
          {autoloadList.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center opacity-10 italic py-20">
              <RefreshCw className="w-16 h-16 mb-4" />
              <p className="text-2xl font-bold">{t("autoload.sequence_empty", "Sequence Empty")}</p>
            </div>
          )}

          <div className={cn("pt-4 mt-2", isPS5 ? "hidden" : "lg:hidden")}>
            <button
              onClick={() => setSubView('add')}
              className="w-full flex items-center justify-center space-x-4 p-6 bg-ps-blue/10 hover:bg-ps-blue text-ps-blue hover:text-white rounded-2xl border border-dashed border-ps-blue/30 hover:border-ps-blue transition-all group shadow-lg"
            >
              <Activity className="w-6 h-6" />
              <span className="font-black italic text-xl uppercase tracking-tighter">{t("autoload.add_item_btn", "Add Item to Sequence")}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  if (!enabled) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center space-y-8 text-center p-6 md:p-12">
        <div className="relative h-24 w-24 md:h-32 md:w-32 mx-auto">
          <div className="absolute inset-0 bg-ps-blue/20 rounded-full" />
          <div className="relative flex items-center justify-center h-full w-full bg-black/40 border border-white/10 rounded-3xl md:rounded-[2.5rem] shadow-2xl">
            <RefreshCw className="w-10 h-10 md:w-16 md:h-16 text-ps-blue" />
          </div>
        </div>
        <div className="space-y-3 md:space-y-4 px-4 max-w-2xl">
          <h2 className="text-3xl md:text-5xl font-black text-white uppercase italic tracking-tighter">
            {t("autoload.sequence_title_1", "Autoload")} <span className="text-ps-blue">{t("autoload.sequence_title_2", "Sequence")}</span>
          </h2>
          <p className="text-md md:text-xl text-zinc-400 font-medium leading-relaxed">
            {t("autoload.enable_desc", "Chain multiple payloads to be executed automatically every time Payload Manager starts.")}
          </p>
        </div>
        <button
          onClick={() => handleToggle(true)}
          className="px-8 md:px-12 py-5 md:py-6 bg-ps-blue text-white text-lg md:text-2xl font-extrabold rounded-2xl md:rounded-[1.5rem] hover:bg-ps-blue/80 transition-all transform active:scale-95 shadow-[0_0_40px_rgba(0,149,255,0.3)]"
        >
          {t("autoload.enable_btn", "Enable Autoload")}
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex-1 flex flex-col min-h-0">
        <div className={cn(
          "gap-8 h-full min-h-0",
          isPS5 ? "grid grid-cols-2" : "hidden lg:grid lg:grid-cols-2"
        )}>
          {renderAvailable()}
          {renderSequence()}
        </div>
        <div className={cn(
          "h-full flex flex-col min-h-0",
          isPS5 ? "hidden" : "lg:hidden"
        )}>
          {subView === 'list' ? renderSequence() : renderAvailable()}
        </div>
      </div>

      <Modal
        show={showDelayModal}
        title={t("autoload.delay_modal.title", "Configure Delay")}
        onClose={() => setShowDelayModal(false)}
        footer={
          <button
            onClick={() => setShowDelayModal(false)}
            className="w-full py-4 bg-white/5 hover:bg-white/10 text-white rounded-2xl font-bold uppercase tracking-tight transition-all"
          >
            {t("autoload.delay_modal.cancel", "Cancel")}
          </button>
        }
      >
        <div className="space-y-6 md:space-y-8">
          <div className="grid grid-cols-3 gap-3 md:gap-4">
            {[1, 3, 5].map(s => (
              <button
                key={s}
                onClick={() => addDelay(s * 1000)}
                className="py-4 md:py-6 bg-ps-blue/20 hover:bg-ps-blue border border-ps-blue/30 text-white rounded-2xl font-black text-xl md:text-2xl transition-all shadow-lg"
              >
                {s}s
              </button>
            ))}
          </div>

          <div className="space-y-3 md:space-y-4">
            <p className="label-caps !text-zinc-500 text-sm md:text-base">{t("autoload.delay_modal.custom_delay_label", "Custom Delay (ms)")}</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="number"
                placeholder={t("autoload.delay_modal.placeholder", "e.g. 2500")}
                value={customDelay}
                onChange={(e) => setCustomDelay(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-4 md:p-5 text-white font-mono text-xl md:text-2xl focus:border-ps-blue outline-none transition-all"
              />
              <button
                onClick={() => customDelay && addDelay(parseInt(customDelay))}
                className="py-4 md:py-0 px-8 md:px-10 bg-ps-blue text-white rounded-2xl font-black uppercase italic tracking-tighter text-lg md:text-xl shadow-2xl hover:bg-ps-blue/80 transition-all shrink-0"
              >
                {t("autoload.delay_modal.add_btn", "Add")}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default AutoloadView
