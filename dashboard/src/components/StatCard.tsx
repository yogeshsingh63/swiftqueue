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

const VARIANT_COLORS = {
  blue: { accent: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  purple: { accent: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
  green: { accent: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  red: { accent: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  yellow: { accent: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
};

export const StatCard: React.FC<StatCardProps> = ({
  id,
  title,
  value,
  icon: Icon,
  variant,
  description,
}) => {
  const colors = VARIANT_COLORS[variant];

  return (
    <div id={id} className="card p-5 transition-colors duration-200">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-zinc-400">{title}</p>
          <h3 className={`text-3xl font-bold mt-1.5 tabular-nums ${colors.accent}`}>
            {typeof value === 'number' ? value.toLocaleString() : value}
          </h3>
        </div>
        <div className={`p-2.5 rounded-lg border ${colors.bg} ${colors.border}`}>
          <Icon className={`w-5 h-5 ${colors.accent}`} />
        </div>
      </div>
      <p className="text-[11px] text-zinc-500 mt-3 leading-relaxed">{description}</p>
    </div>
  );
};
