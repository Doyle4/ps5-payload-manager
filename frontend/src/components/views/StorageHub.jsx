import React, { useState, useEffect, useMemo, useLayoutEffect, useRef, useCallback } from 'react'
import { CloudDownload, Upload, Package, Database, RefreshCw, Trash2, Loader2, AlertTriangle, HardDrive, Usb, ChevronDown, Globe, Search, ArrowUpDown, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { QRCodeSVG } from 'qrcode.react'
import { cn, isPS5, isIOS } from '../../utils/helpers'
import PayloadName from '../ui/PayloadName'
import { useRepository } from '../../contexts/RepositoryContext'
import PayloadCard from '../ui/PayloadCard'
import PayloadDetailPanel from '../ui/PayloadDetailPanel'

const StorageHub = ({ payloads, payloadMeta, onInstall, onDelete, onUpload, onImportFromUsb, config, ip, scrollTarget, onClearScrollTarget, selectedPayload: selectedPayloadProp, onSelectPayload, onClosePayload }) => {
  const { t, i18n } = useTranslation()
  const multiSources = config?.MULTI_SOURCES_ENABLED === true

  const { repoData, loading, error, fetchRemote } = useRepository()

  const [expandedSource, setExpandedSource] = useState(null) // id of expanded catalog
  const [search, setSearch] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const searchInputRef = useRef(null)
  const [sortMode, setSortMode] = useState(() => {
    return localStorage.getItem('repoSortMode') || 'name'
  })
  
  const [localSelectedPayload, setLocalSelectedPayload] = useState(null)
  const selectedPayload = selectedPayloadProp !== undefined ? selectedPayloadProp : localSelectedPayload
  const setSelectedPayload = onSelectPayload || setLocalSelectedPayload
  const [savedScroll, setSavedScroll] = useState(0)

  const handlePayloadSelect = (payloadData) => {
    const mainEl = document.querySelector('main')
    if (mainEl) setSavedScroll(mainEl.scrollTop)
    if (onSelectPayload) {
      onSelectPayload(payloadData)
    } else {
      setSelectedPayload(payloadData)
    }
  }

  const handleCloseDetail = useCallback(() => {
    if (onClosePayload) {
      onClosePayload()
    } else {
      setSelectedPayload(null)
    }
  }, [onClosePayload, setSelectedPayload])

  const handleSortChange = (mode) => {
    setSortMode(mode)
    localStorage.setItem('repoSortMode', mode)
  }


  useEffect(() => {
    if (scrollTarget) {
      const timer = setTimeout(() => {
        const element = document.getElementById(scrollTarget);
        if (element) element.scrollIntoView({ behavior: 'smooth' });
        if (onClearScrollTarget) onClearScrollTarget();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [scrollTarget]);

  const localFilenames = useMemo(() => payloads.map(p => p.split('/').pop()), [payloads])
  const internalPayloads = payloads.filter(p => !p.includes('/mnt/usb'))

  const getBaseName = (filename) => {
    if (!filename) return '';
    let clean = filename.replace(/\.(elf|bin)$/i, '');
    const versionMatch = clean.match(/[_-]v?(\d+[\d.a-z-]+)/i);
    if (versionMatch) clean = clean.replace(versionMatch[0], '');
    return clean.replace(/[_-]ps[45]$/i, '');
  }

  /* ---- Derive remote status for a flat list of payloads ---- */
  const enrichPayloads = (list) =>
    list.map(p => {
      const isInstalled = p.filename ? localFilenames.includes(p.filename) : false
      const baseName = getBaseName(p.filename)
      const installedVersion = localFilenames.find(f => getBaseName(f) === baseName)
      const isUpdate = !isInstalled && !!installedVersion
      return { ...p, isInstalled, isUpdate, installedFilename: installedVersion }
    }).sort((a, b) => {
      if (a.isUpdate && !b.isUpdate) return -1
      if (!a.isUpdate && b.isUpdate) return 1
      
      const nameA = (a.name || a.filename || '').toLowerCase()
      const nameB = (b.name || b.filename || '').toLowerCase()
      return nameA.localeCompare(nameB)
    })

  /* ---- Source-grouped data ---- */
  const enrichedSources = useMemo(() => {
    if (repoData?.sources) {
      return repoData.sources.map(src => ({
        ...src,
        id: src.id || src.url,
        payloads: enrichPayloads(src.payloads || [])
      }))
    } else if (repoData?.payloads) {
      return [{
        id: 'legacy-repo',
        name: repoData.name || t("storage_hub.default_repository", "Default Repository"),
        url: repoData.repo_url || '',
        last_update: repoData.last_update || 0,
        payloads: enrichPayloads(repoData.payloads)
      }]
    }
    return []
  }, [repoData, localFilenames, t])

  const legacyRepoUrl = repoData?.repo_url || ''

  /* ---- Source badge helper: look up source name from metadata ---- */
  const getSourceBadge = (fileName) => {
    if (!multiSources || !payloadMeta) return null
    const meta = payloadMeta[fileName]
    return meta?.source_name || meta?.install_source_detail || null
  }

  const resolvedPayloadData = useMemo(() => {
    if (!selectedPayload) return null

    // If it already contains the full payload object
    if (selectedPayload.payload && (selectedPayload.payload.name || selectedPayload.payload.filename)) {
      const fn = selectedPayload.payload.filename
      const isInstalled = fn ? localFilenames.includes(fn) : selectedPayload.isInstalled
      const baseName = getBaseName(fn)
      const installedVersion = localFilenames.find(f => getBaseName(f) === baseName)
      const isUpdate = !isInstalled && !!installedVersion
      return {
        ...selectedPayload,
        isInstalled,
        isUpdate,
      }
    }

    // If it's a filename reference (e.g. from URL deep link or reload)
    const targetFilename = selectedPayload.filename || selectedPayload.payload?.filename || (typeof selectedPayload === 'string' ? selectedPayload : null)
    if (!targetFilename) return null

    // If a specific source ID was requested in the URL (?src=...), check that source first
    if (selectedPayload.srcId) {
      const targetSrc = enrichedSources.find(s => s.id === selectedPayload.srcId)
      if (targetSrc) {
        const match = targetSrc.payloads?.find(p => p.filename === targetFilename)
        if (match) {
          return {
            payload: match,
            srcId: targetSrc.id === 'legacy-repo' ? null : targetSrc.id,
            srcUrl: targetSrc.url,
            isInstalled: match.isInstalled,
            isUpdate: match.isUpdate,
          }
        }
      }
    }

    for (const src of enrichedSources) {
      const match = src.payloads?.find(p => p.filename === targetFilename)
      if (match) {
        return {
          payload: match,
          srcId: selectedPayload.srcId || (src.id === 'legacy-repo' ? null : src.id),
          srcUrl: src.url,
          isInstalled: match.isInstalled,
          isUpdate: match.isUpdate,
        }
      }
    }

    return null
  }, [selectedPayload, enrichedSources, localFilenames])

  useLayoutEffect(() => {
    const mainEl = document.querySelector('main')
    if (!mainEl) return
    
    if (resolvedPayloadData) {
      mainEl.scrollTop = 0
    } else {
      mainEl.scrollTop = savedScroll
    }
  }, [resolvedPayloadData, savedScroll])

  useEffect(() => {
    if (selectedPayload && !resolvedPayloadData && !loading && repoData) {
      handleCloseDetail()
    }
  }, [selectedPayload, resolvedPayloadData, loading, repoData, handleCloseDetail])

  if (selectedPayload && !resolvedPayloadData && (loading || !repoData)) {
    return (
      <div className="py-24 flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-10 h-10 text-ps-blue animate-spin" />
        <p className="text-zinc-400 font-medium">{t("storage_hub.loading", "Loading repository...")}</p>
      </div>
    )
  }

  if (resolvedPayloadData) {
    return (
      <PayloadDetailPanel
        payload={resolvedPayloadData.payload}
        srcId={resolvedPayloadData.srcId}
        srcUrl={resolvedPayloadData.srcUrl}
        isInstalled={resolvedPayloadData.isInstalled}
        isUpdate={resolvedPayloadData.isUpdate}
        onClose={handleCloseDetail}
        onInstall={(p, sid, surl) => {
          onInstall(p, sid, surl)
          handleCloseDetail()
        }}
      />
    )
  }

  return (
    <div className="space-y-12 animate-in fade-in duration-300">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight shrink-0">
          {t("storage_hub.title_1", "Get")} <span className="text-ps-blue">{t("storage_hub.title_2", "Payloads")}</span>
        </h2>

        <div className="flex items-center space-x-2 sm:space-x-3">
          {isSearchOpen ? (
            <div className="flex items-center bg-black/40 border border-white/10 rounded-full px-3 py-1.5 sm:px-4 sm:py-2 focus-within:border-ps-blue/50 transition-all w-40 sm:w-64 md:w-80">
              <Search className="w-4 h-4 sm:w-5 sm:h-5 text-ps-blue mr-2 shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder={t("storage_hub.search_placeholder", "Search payloads by name or description...")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-transparent border-none outline-none text-white w-full text-xs sm:text-sm font-medium placeholder:text-zinc-600 min-w-0"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setIsSearchOpen(false)
                    setSearch('')
                  }
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="p-1 hover:text-white text-zinc-500 shrink-0"
                  title={t("app.buttons.clear", "Clear")}
                >
                  <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setIsSearchOpen(false)
                  setSearch('')
                }}
                className="p-1 hover:text-white text-zinc-500 ml-1 shrink-0"
                title={t("app.buttons.close", "Close")}
              >
                <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              className={cn(
                "p-3 rounded-full transition-colors flex items-center justify-center",
                search ? "bg-ps-blue/20 text-ps-blue" : "bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10"
              )}
              title={t("storage_hub.search_placeholder", "Search payloads by name or description...")}
            >
              <Search className="w-6 h-6" />
            </button>
          )}

          <div className="relative">
            <button
              type="button"
              className={cn(
                "p-3 rounded-full transition-colors flex items-center justify-center",
                sortMode !== 'name' ? "bg-ps-blue/20 text-ps-blue" : "bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10"
              )}
              title={`${t("storage_hub.sort_by", "Sort by:")} ${
                sortMode === 'category'
                  ? t("storage_hub.sort_category", "Category")
                  : sortMode === 'update_time'
                  ? t("storage_hub.sort_time", "Update Time")
                  : t("storage_hub.sort_name", "Name")
              }`}
            >
              <ArrowUpDown className="w-6 h-6" />
            </button>
            <select 
              value={sortMode}
              onChange={e => handleSortChange(e.target.value)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              title={t("storage_hub.sort_by", "Sort by:")}
            >
              <option value="name" className="bg-[#121214] text-white">{t("storage_hub.sort_name", "Name")}</option>
              <option value="category" className="bg-[#121214] text-white">{t("storage_hub.sort_category", "Category")}</option>
              <option value="update_time" className="bg-[#121214] text-white">{t("storage_hub.sort_time", "Update Time")}</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => fetchRemote(true)}
            disabled={loading}
            className="p-3 rounded-full transition-colors flex items-center justify-center bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10 disabled:opacity-50"
            title={t("storage_hub.refresh", "Refresh Repository")}
          >
            <RefreshCw className={cn("w-6 h-6", loading && "animate-spin text-ps-blue")} />
          </button>

          {!isPS5 && (
            <label
              className="p-3 rounded-full transition-colors flex items-center justify-center bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
              title={t("storage_hub.upload_btn", "Upload ELF Payload")}
            >
              <Upload className="w-6 h-6" />
              <input type="file" className="hidden" onChange={onUpload} accept={isIOS ? undefined : ".elf,.bin"} />
            </label>
          )}
        </div>
      </div>

      {/* Cloud Repository Section */}
      <section id="cloud-repository" className="space-y-6">

        {loading && !repoData ? (
          <div className="py-24 glass-panel rounded-ps-3xl border-white/5 flex flex-col items-center justify-center space-y-6">
            <Loader2 className="w-16 h-16 text-ps-blue animate-spin" />
            <p className="label-caps">{t("storage_hub.syncing", "Syncing with Repository...")}</p>
          </div>
        ) : error ? (
          <div className="py-20 glass-card rounded-ps-3xl border-red-500/20 flex flex-col items-center justify-center space-y-6 bg-red-950/5">
            <AlertTriangle className="w-16 h-16 text-red-500 opacity-50" />
            <div className="text-center">
              <p className="text-xl font-bold text-white uppercase tracking-tight">{t("storage_hub.repo_unavailable", "Repository Unavailable")}</p>
              <p className="text-zinc-500 mt-1">{t("storage_hub.repo_unavailable_desc", "Check your internet connection and try again.")}</p>
            </div>
            <button onClick={() => fetchRemote(true)} className="px-8 py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white rounded-xl font-bold uppercase text-xs transition-all">{t("storage_hub.retry_btn", "Retry Connection")}</button>
          </div>
        ) : enrichedSources.length > 0 ? (
          /* ===== REPOSITORY CATALOGS ===== */
          <div className="space-y-4">
            {enrichedSources.map(src => {
              let availablePayloads = [...src.payloads]
              
              if (search.trim() !== '') {
                const q = search.toLowerCase()
                availablePayloads = availablePayloads.filter(p => 
                  (p.name && p.name.toLowerCase().includes(q)) || 
                  (p.filename && p.filename.toLowerCase().includes(q)) || 
                  (p.description && p.description.toLowerCase().includes(q))
                )
              }
              
              // Auto-expand if there's only 1 source, otherwise respect state or active search
              const isExpanded = (enrichedSources.length === 1) || expandedSource === src.id || search.trim() !== ''

              let hasMultipleCategories = false
              let groupedPayloads = {}
              let categories = []

              if (sortMode === 'category' && search.trim() === '') {
                groupedPayloads = availablePayloads.reduce((acc, p) => {
                  // If p.category exists, attempt to translate it using its English name as key.
                  const catName = p.category ? t(`category.${p.category}`, p.category) : t("storage_hub.uncategorized", "Uncategorized")
                  if (!acc[catName]) acc[catName] = []
                  acc[catName].push(p)
                  return acc
                }, {})
                categories = Object.keys(groupedPayloads).sort()
                hasMultipleCategories = categories.length > 1
              } else {
                // sort flat list
                availablePayloads.sort((a, b) => {
                  if (sortMode === 'update_time') {
                    // Descending by last_update
                    const dateA = a.last_update || ''
                    const dateB = b.last_update || ''
                    return dateB.localeCompare(dateA)
                  } else if (sortMode === 'name') {
                    const nameA = a.name || a.filename || ''
                    const nameB = b.name || b.filename || ''
                    return nameA.localeCompare(nameB)
                  }
                  return 0
                })
              }

              return (
                <div key={src.id} className={cn(
                  multiSources ? "bg-ps-card border border-ps-border rounded-ps-3xl overflow-hidden" : "flex flex-col space-y-4"
                )}>
                  {/* Last Sync for single-source mode */}
                  {!multiSources && src.last_update > 0 && (
                    <p className="px-2 text-xs uppercase tracking-widest text-zinc-500">
                      {t("storage_hub.last_sync", "Last Sync: {{date}}", { date: new Date(src.last_update * 1000).toLocaleString(i18n.resolvedLanguage) })}
                    </p>
                  )}

                  {/* Catalog header (only for multi-source) */}
                  {multiSources && (
                    <button
                      onClick={() => setExpandedSource(isExpanded ? null : src.id)}
                      className="w-full flex items-center justify-between p-6 md:p-8 hover:bg-white/5 transition-colors"
                    >
                    <div className="flex items-center space-x-4">
                      <div className="p-2.5 bg-ps-blue/10 rounded-xl">
                        <Globe className="w-5 h-5 text-ps-blue" />
                      </div>
                      <div className="text-left">
                        <p className="font-bold text-white text-lg">{src.name}</p>
                        {src.error && (
                          <p className="text-xs text-red-400 flex items-center space-x-1 mt-0.5">
                            <AlertTriangle className="w-3 h-3" />
                            <span>{t("storage_hub.fetch_failed", "Fetch failed")}</span>
                          </p>
                        )}
                        {src.last_update > 0 && (
                          <p className="text-xs text-zinc-500 uppercase tracking-widest mt-1">
                            {t("storage_hub.updated_at", "Updated {{date}}", { date: new Date(src.last_update * 1000).toLocaleString(i18n.resolvedLanguage) })}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <span className="px-3 py-1 rounded-full bg-white/5 text-zinc-500 text-xs font-bold">
                        {t("storage_hub.payload_count", "{{count}} payloads", { count: availablePayloads.length })}
                      </span>
                      {enrichedSources.length > 1 && (
                        <ChevronDown className={cn("w-5 h-5 text-zinc-500 transition-transform", isExpanded && "rotate-180")} />
                      )}
                    </div>
                  </button>
                  )}

                  {/* Catalog payload grid */}
                  {isExpanded && (
                    <div className={cn(
                      multiSources ? "border-t border-white/5 p-4 md:p-6" : ""
                    )}>
                      {src.payloads.length === 0 ? (
                        <div className="py-12 flex flex-col items-center justify-center space-y-3 text-zinc-600">
                          <p className="text-sm font-bold uppercase tracking-widest italic">{t("storage_hub.source_empty", "Source is empty")}</p>
                        </div>
                      ) : hasMultipleCategories ? (
                        categories.map(cat => (
                          <div key={cat} className="space-y-4 mb-8 last:mb-0">
                            <h4 className="text-white/80 font-bold uppercase tracking-widest text-sm px-2">{cat}</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                              {groupedPayloads[cat].map(p => (
                                <PayloadCard
                                  key={p.filename}
                                  payload={p}
                                  isUpdate={p.isUpdate}
                                  isInstalled={p.isInstalled}
                                  onClick={() => handlePayloadSelect({
                                    payload: p,
                                    srcId: src.id === 'legacy-repo' ? null : src.id,
                                    srcUrl: src.url,
                                    isInstalled: p.isInstalled,
                                    isUpdate: p.isUpdate
                                  })}
                                />
                              ))}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                          {availablePayloads.map(p => (
                            <PayloadCard
                              key={p.filename}
                              payload={p}
                              isUpdate={p.isUpdate}
                              isInstalled={p.isInstalled}
                              onClick={() => handlePayloadSelect({
                                payload: p,
                                srcId: src.id === 'legacy-repo' ? null : src.id,
                                srcUrl: src.url,
                                isInstalled: p.isInstalled,
                                isUpdate: p.isUpdate
                              })}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="py-20 border-2 border-dashed border-white/5 rounded-ps-3xl flex flex-col items-center justify-center space-y-4 bg-white/[0.01]">
            <CloudDownload className="w-16 h-16 text-white/5" />
            <p className="text-zinc-500 font-bold uppercase tracking-widest text-sm italic">{t("storage_hub.repo_empty", "Repository is empty")}</p>
          </div>
        )}
      </section>

      {/* USB Storage Section */}
      <section id="usb-storage" className="space-y-6">
        <div className="flex items-center justify-between px-2">
          <h3 className="label-caps !text-ps-blue flex items-center space-x-4 text-lg">
            <HardDrive className="w-6 h-6" />
            <span>{t("storage_hub.usb_storage_title", "USB Storage")}</span>
          </h3>
          <span className="bg-ps-blue/5 px-4 py-1 rounded-full text-ps-blue font-bold text-xs border border-ps-blue/20">
            {t("storage_hub.files_count", "{{count}} File", { count: payloads.filter(p => p.includes('/mnt/usb')).length })}
          </span>
        </div>

        <div className={cn("grid gap-4", isPS5 ? "grid-cols-2" : "grid-cols-1 lg:grid-cols-2")}>
          {payloads.filter(p => p.includes('/mnt/usb')).length === 0 ? (
            <div className="col-span-full py-20 border-2 border-dashed border-white/5 rounded-ps-3xl flex flex-col items-center justify-center space-y-6 bg-white/[0.01]">
              <div className="relative">
                <HardDrive className="w-16 h-16 text-white/5" />
                {!config.SCAN_USB_PAYLOADS && (
                  <div className="absolute -top-1 -right-1 bg-amber-500/20 rounded-full p-1 border border-amber-500/50">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                  </div>
                )}
              </div>
              <div className="text-center space-y-2">
                <p className="text-zinc-500 font-bold uppercase tracking-widest text-sm italic">{t("storage_hub.no_usb_payloads", "No USB Payloads Found")}</p>
                {!config.SCAN_USB_PAYLOADS && (
                  <p className="text-xs text-zinc-600 max-w-xs mx-auto leading-relaxed">
                    {t("storage_hub.usb_scan_disabled_1", "Extended USB scanning is currently disabled.")} <br /> 
                    <span dangerouslySetInnerHTML={{ __html: t("storage_hub.usb_scan_disabled_2", "Enable <strong>\"Scan USB Payloads\"</strong> in settings to search for payloads on connected drives.") }} />
                  </p>
                )}
              </div>
            </div>
          ) : (
            payloads.filter(p => p.includes('/mnt/usb')).map((path) => {
              return (
                <div key={path} className="group flex flex-row items-center justify-between p-4 md:p-6 glass-card rounded-ps-2xl border-white/10 hover:border-ps-blue/30 gap-4">
                  <div className="flex items-center space-x-4 md:space-x-6 min-w-0">
                    <div className="p-3 md:p-4 bg-white/5 rounded-2xl group-hover:bg-ps-blue/10 transition-colors shrink-0">
                      <Usb className="w-6 h-6 md:w-8 md:h-8 text-zinc-400 group-hover:text-ps-blue transition-colors" />
                    </div>
                    <div className="space-y-1 min-w-0 flex-1">
                      <PayloadName path={path} className="text-xl md:text-2xl text-white" stacked hideIcon={true} />
                      <p className="text-[10px] text-zinc-600 font-medium font-mono uppercase tracking-tighter opacity-60 truncate">{path}</p>
                    </div>
                  </div>
                  <div className="flex items-center shrink-0">
                    <button
                      onClick={() => onImportFromUsb(path)}
                      className="flex items-center space-x-2 md:space-x-3 px-4 md:px-6 py-3 md:py-4 bg-white/5 hover:bg-ps-blue text-white rounded-xl font-bold text-xs md:text-sm transition-all border border-white/10 hover:border-ps-blue group/btn"
                    >
                      <Database className="w-4 h-4 md:w-5 md:h-5 text-ps-blue group-hover/btn:text-white transition-colors" />
                      <span>{t("storage_hub.move_internal_btn", "Move to Internal")}</span>
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

      {/* Footer Info for PS5 */}
      {isPS5 && (
        <div className={cn(
          "glass-card p-6 md:p-10 rounded-ps-3xl flex items-center gap-8 md:gap-12 border-white/10 bg-black/40 mt-12 md:mt-16",
          isPS5 ? "flex-row" : "flex-col md:flex-row"
        )}>
          <div className="flex flex-col items-center space-y-4 md:space-y-6 shrink-0">
            <div className="bg-white p-4 md:p-6 rounded-3xl">
              <QRCodeSVG value={`http://${ip}:8084`} size={isPS5 ? 160 : 120} level="M" />
            </div>
            <code className="text-white font-mono text-base md:text-lg font-black opacity-90 italic tracking-tight uppercase">{ip}:8084</code>
          </div>
          <div className="flex-1 space-y-3 md:space-y-4 text-center md:text-left">
            <h4 className="label-caps !text-white !opacity-100 text-xl md:text-2xl tracking-widest flex items-center justify-center md:justify-start space-x-3 md:space-x-4">
              <div className="w-1.5 h-6 md:w-2 md:h-8 bg-ps-blue rounded-full" />
              <span>{t("storage_hub.remote_management_title", "Remote Management")}</span>
            </h4>
            <p className="text-lg md:text-xl text-zinc-400 leading-relaxed italic font-medium max-w-3xl">
              {t("storage_hub.remote_management_desc", "Access this dashboard from your computer or phone to manage and upload payloads directly from your local network.")}
            </p>
          </div>
        </div>
      )}

    </div>
  )
}

export default StorageHub
