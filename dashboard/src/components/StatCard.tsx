import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  id?: string;
  title: string;
  value: number | string;
  icon: LucideIcon;
  variant: 'blue' | 'purple' | 'green' | 'red' | 'yellow';
  description: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  id,
  title,
  value,
  icon: Icon,
  variant,
  description,
}) => {
  // Variant mapping to glow and text colors
  const variantStyles = {
    blue: {
      glow: 'glow-blue',
      iconBg: 'bg-sky-500/10 text-sky-400 border-sky-500/25',
      textGlow: 'text-sky-400 drop-shadow-[0_0_8px_rgba(56,189,248,0.4)]',
    },
    purple: {
      glow: 'glow-purple',
      iconBg: 'bg-purple-500/10 text-purple-400 border-purple-500/25',
      textGlow: 'text-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.4)]',
    },
    green: {
      glow: 'glow-green',
      iconBg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
      textGlow: 'text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.4)]',
    },
    red: {
      glow: 'glow-red',
      iconBg: 'bg-rose-500/10 text-rose-400 border-rose-500/25',
      textGlow: 'text-rose-400 drop-shadow-[0_0_8px_rgba(248,113,113,0.4)]',
    },
    yellow: {
      glow: 'glow-yellow',
      iconBg: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
      textGlow: 'text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.4)]',
    },
  };

  const style = variantStyles[variant];

  return (
    <div
      id={id}
      className={`glass-panel transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl ${style.glow} flex flex-col justify-between p-6`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium tracking-wide text-slate-400">{title}</p>
          <h3 className={`font-outfit text-3xl font-bold mt-2 ${style.textGlow}`}>
            {typeof value === 'number' ? value.toLocaleString() : value}
          </h3>
        </div>
        <div className={`border p-3 rounded-xl ${style.iconBg} transition-transform duration-300 hover:rotate-6`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
      <p className="text-xs text-slate-500 mt-4 leading-relaxed">{description}</p>
    </div>
  );
};
