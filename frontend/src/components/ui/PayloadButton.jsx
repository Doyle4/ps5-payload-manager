import React from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Globe, Star, ChevronLeft, ChevronRight, CheckCircle2, Trash2 } from 'lucide-react'
import PayloadName from './PayloadName'
import PayloadIcon from './PayloadIcon'
import { cn } from '../../utils/helpers'

const PayloadButton = ({
  path = '',
  itemKey,
  onClick,
  onDelete,
  isLoading,
  sourceName,
  version,
  icon,
  author,
  displayName,
  isFavorite,
  isLaunched,
  isEditMode,
  isManageMode,
  onMoveFavorite,
  canMoveLeft,
  canMoveRight,
}) => {
  const { t } = useTranslation()
  const safePath = typeof path === 'string' ? path : ''
  const isUsb = Boolean(safePath && safePath.startsWith('/mnt/usb'))
  const iconName = safePath ? safePath.split('/').pop() : (displayName || 'Payload')

  const handleClick = (e) => {
    if (isManageMode) {
      if (!isUsb) {
        if (onDelete) onDelete()
        else if (onClick) onClick(e)
      }
    } else if (onClick) {
      onClick(e)
    }
  }

  const handleMove = (e, direction) => {
    e.stopPropagation()
    if (!onMoveFavorite) return
    if (onMoveFavorite.length === 1) {
      onMoveFavorite(direction)
    } else {
      onMoveFavorite(itemKey || safePath, direction)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={isLoading || (isManageMode && isUsb)}
      title={isManageMode && !isUsb ? t("app.dashboard.removePayload", "Remove Payload") : undefined}
      className={cn(
        "group glass-card pl-4 pr-3 py-4 rounded-ps-xl flex flex-col border transition-all text-left relative",
        isManageMode ? "border-red-500/20 hover:border-red-500 hover:bg-red-500/10" : "border-white/5 hover:border-ps-blue hover:bg-ps-blue/5",
        isManageMode && isUsb && "opacity-50 grayscale cursor-not-allowed"
      )}
    >
      <div className="flex items-start justify-between w-full z-10">
        <div className="flex items-center gap-4 min-w-0 pr-2">
          <PayloadIcon icon={icon} name={iconName} className="w-12 h-12 text-xl" />
          <div className="min-w-0 flex-1">
            <PayloadName path={safePath} version={version} hideVersion={true} displayName={displayName} className="text-white text-xl" stacked={false} />
            <div className="flex items-center gap-2 mt-0.5">
              {version && <span className="text-[10px] text-zinc-400 font-bold bg-white/10 px-1.5 py-0.5 rounded uppercase shrink-0">{version}</span>}
              {author && (
                <div className="text-[10px] text-zinc-500 font-medium truncate">
                  {author}
                </div>
              )}
            </div>
            {sourceName && !isUsb && (
              <div className="flex items-center mt-1">
                <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400 font-bold bg-white/10 px-1.5 py-0.5 rounded uppercase shrink-0 max-w-full select-none">
                  <Globe className="w-3 h-3 text-zinc-400 shrink-0" />
                  <span className="truncate">{sourceName}</span>
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isEditMode && (
            <div
              className={cn(
                "p-1 rounded-lg transition-all",
                isFavorite ? "text-yellow-400 opacity-100" : "text-zinc-600 opacity-50"
              )}
            >
              <Star className={cn("w-5 h-5", isFavorite && "fill-yellow-400")} />
            </div>
          )}
          {isManageMode && !isUsb && (
            <div
              className="p-1.5 rounded-lg text-red-500 transition-all opacity-50 group-hover:opacity-100"
            >
              <Trash2 className="w-5 h-5" />
            </div>
          )}
          {isLaunched && !isEditMode && !isManageMode && !isLoading && (
            <div className="group/tooltip relative p-1 text-green-400">
              <CheckCircle2 className="w-5 h-5" />
              <div className="absolute bottom-full right-0 mb-2 px-2 py-1 bg-ps-black border border-white/10 shadow-lg text-xs font-bold text-white rounded opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                {t("app.dashboard.launched_tooltip", "Launched recently")}
              </div>
            </div>
          )}
          {isLoading && <Loader2 className="w-6 h-6 animate-spin text-ps-blue" />}
        </div>
      </div>
      {isUsb && (
        <div className="mt-3 text-[10px] text-zinc-500 font-medium truncate opacity-60 group-hover:opacity-100 transition-opacity z-10 select-none">
          {safePath}
        </div>
      )}
      {(isEditMode && isFavorite) && (
        <div className="absolute bottom-2 right-3 flex items-center gap-2 z-20">
          <button
            onClick={(e) => { if (canMoveLeft) handleMove(e, -1); }}
            disabled={!canMoveLeft}
            className="p-1.5 bg-ps-black border border-white/10 rounded-lg hover:bg-ps-blue/20 hover:border-ps-blue hover:text-ps-blue transition-colors disabled:opacity-30 disabled:pointer-events-none text-zinc-400"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => { if (canMoveRight) handleMove(e, 1); }}
            disabled={!canMoveRight}
            className="p-1.5 bg-ps-black border border-white/10 rounded-lg hover:bg-ps-blue/20 hover:border-ps-blue hover:text-ps-blue transition-colors disabled:opacity-30 disabled:pointer-events-none text-zinc-400"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className="absolute inset-0 rounded-ps-xl bg-ps-blue/0 group-hover:bg-ps-blue/5 transition-colors z-0 pointer-events-none" />
    </button>
  )
}

export default PayloadButton
