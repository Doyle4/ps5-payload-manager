import React from 'react';
import { cn } from '../../utils/helpers';
import PayloadName from './PayloadName';
import PayloadIcon from './PayloadIcon';

const PayloadCard = ({ payload, onClick, isUpdate, isInstalled }) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex flex-col p-4 md:p-6 bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 hover:border-ps-blue/30 rounded-3xl transition-all text-left relative",
        (isInstalled && !isUpdate) && "opacity-60"
      )}
    >
      <div className="flex justify-center mb-4 w-full">
        <PayloadIcon icon={payload.icon} name={payload.filename} className="w-20 h-20 md:w-28 md:h-28" />
      </div>
      <div className="flex flex-col flex-1 min-w-0 w-full text-center">
        <PayloadName path={payload.filename} hideVersion={true} centered={true} className="text-lg md:text-xl text-white font-extrabold truncate w-full flex justify-center" />
        <div className="flex items-center justify-center gap-2 mt-1 w-full">
          {payload.version && <span className="text-[10px] text-zinc-400 font-bold bg-white/10 px-1.5 py-0.5 rounded uppercase shrink-0">{payload.version}</span>}
          {payload.author && (
            <div className="text-zinc-500 font-medium text-[11px] md:text-xs truncate">
              {payload.author}
            </div>
          )}
        </div>
      </div>
      
      {/* Badges */}
      <div className="absolute top-4 right-4 flex flex-col gap-2">
        {isUpdate && (
          <span className="px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold text-[10px] uppercase tracking-widest border border-emerald-500/20">
            Update
          </span>
        )}
      </div>
    </button>
  );
};

export default PayloadCard;
