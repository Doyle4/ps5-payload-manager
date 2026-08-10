import React from 'react';
import { cn } from '../../utils/helpers';
import { Package } from 'lucide-react';

const COLORS = [
  ['#3b82f6', '#1d4ed8'], // blue
  ['#10b981', '#047857'], // emerald
  ['#8b5cf6', '#6d28d9'], // violet
  ['#f59e0b', '#b45309'], // amber
  ['#ef4444', '#b91c1c'], // red
  ['#ec4899', '#be185d'], // pink
  ['#14b8a6', '#0f766e'], // teal
];

const stringToHash = (str) => {
  let hash = 0;
  if (!str) return 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
};

const PayloadIcon = ({ icon, name, className }) => {
  if (icon) {
    return (
      <div className={cn("rounded-2xl overflow-hidden shadow-lg border border-white/10 shrink-0 bg-white/5", className)}>
        <img src={icon} alt={name || 'Payload'} className="w-full h-full object-cover" />
      </div>
    );
  }

  // Fallback
  const hash = stringToHash(name || 'Payload');
  const [colorStart, colorEnd] = COLORS[hash % COLORS.length];

  return (
    <div 
      className={cn("rounded-2xl flex flex-col items-center justify-center shadow-lg border border-white/10 shrink-0 text-white font-bold relative overflow-hidden", className)}
      style={{
        background: `linear-gradient(135deg, ${colorStart}, ${colorEnd})`
      }}
    >
      <div className="absolute inset-0 bg-black/20" />
      <Package className="w-1/2 h-1/2 opacity-80 z-10 drop-shadow-md" />
    </div>
  );
};

export default PayloadIcon;
