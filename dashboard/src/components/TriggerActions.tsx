import React from 'react';
import { Play, Clock, AlertOctagon, RotateCcw, Trash2, Loader2, Zap } from 'lucide-react';

interface TriggerActionsProps {
  onAddInstantJobs: () => void;
  onAddDelayedJobs: () => void;
  onTriggerFailureJob: () => void;
  onReplayDLQ: () => void;
  onClearDLQ: () => void;
  dlqCount: number;
  isLoading: boolean;
}

export const TriggerActions: React.FC<TriggerActionsProps> = ({
  onAddInstantJobs,
  onAddDelayedJobs,
  onTriggerFailureJob,
  onReplayDLQ,
  onClearDLQ,
  dlqCount,
  isLoading,
}) => {
  return (
    <div className="glass-panel p-5 flex flex-col">
      <div className="flex items-center space-x-2 border-b border-slate-800/80 pb-3 mb-3">
        <Zap className="w-4 h-4 text-amber-400" />
        <h2 className="font-outfit font-semibold text-base text-slate-200">Quick Actions</h2>
      </div>
      <p className="text-[10px] text-slate-500 mb-4 leading-relaxed">
        Bulk inject real jobs for load testing or trigger failure scenarios for DLQ demonstration.
      </p>

      <div className="space-y-2.5">
        {/* Add 10 Instant Jobs */}
        <button
          id="btn-add-instant"
          onClick={onAddInstantJobs}
          disabled={isLoading}
          className="w-full flex items-center justify-between px-3 py-2.5 bg-gradient-to-r from-sky-600/15 to-indigo-600/15 hover:from-sky-600/25 hover:to-indigo-600/25 disabled:opacity-40 text-sky-200 border border-sky-500/20 rounded-xl transition-all duration-300 group hover:border-sky-400/40"
        >
          <div className="flex items-center space-x-2.5">
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
            ) : (
              <Play className="w-4 h-4 text-sky-400 group-hover:scale-110 transition-transform" />
            )}
            <span className="text-xs font-medium">Inject 10 Real Jobs</span>
          </div>
          <span className="text-[9px] uppercase font-mono tracking-widest text-sky-400/70 bg-sky-400/10 px-1.5 py-0.5 rounded">
            Mixed
          </span>
        </button>

        {/* Add 5 Delayed Jobs */}
        <button
          id="btn-add-delayed"
          onClick={onAddDelayedJobs}
          disabled={isLoading}
          className="w-full flex items-center justify-between px-3 py-2.5 bg-gradient-to-r from-purple-600/15 to-indigo-600/15 hover:from-purple-600/25 hover:to-indigo-600/25 disabled:opacity-40 text-purple-200 border border-purple-500/20 rounded-xl transition-all duration-300 group hover:border-purple-400/40"
        >
          <div className="flex items-center space-x-2.5">
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
            ) : (
              <Clock className="w-4 h-4 text-purple-400 group-hover:scale-110 transition-transform" />
            )}
            <span className="text-xs font-medium">Inject 5 Delayed (10s)</span>
          </div>
          <span className="text-[9px] uppercase font-mono tracking-widest text-purple-400/70 bg-purple-400/10 px-1.5 py-0.5 rounded">
            Delay
          </span>
        </button>

        {/* Trigger Fail Job */}
        <button
          id="btn-trigger-fail"
          onClick={onTriggerFailureJob}
          disabled={isLoading}
          className="w-full flex items-center justify-between px-3 py-2.5 bg-gradient-to-r from-rose-600/15 to-pink-600/15 hover:from-rose-600/25 hover:to-pink-600/25 disabled:opacity-40 text-rose-200 border border-rose-500/20 rounded-xl transition-all duration-300 group hover:border-rose-400/40"
        >
          <div className="flex items-center space-x-2.5">
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-rose-400" />
            ) : (
              <AlertOctagon className="w-4 h-4 text-rose-400 group-hover:scale-110 transition-transform" />
            )}
            <span className="text-xs font-medium">Trigger Failing Job</span>
          </div>
          <span className="text-[9px] uppercase font-mono tracking-widest text-rose-400/70 bg-rose-400/10 px-1.5 py-0.5 rounded">
            DLQ
          </span>
        </button>
      </div>

      {/* DLQ Controls */}
      <div className="mt-5 border-t border-slate-800/80 pt-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Dead Letter Queue</span>
          <span className="text-[10px] font-mono bg-rose-400/10 text-rose-400 border border-rose-400/20 px-2 py-0.5 rounded-full font-bold">
            {dlqCount} stalled
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            id="btn-replay-dlq"
            onClick={onReplayDLQ}
            disabled={isLoading || dlqCount === 0}
            className="flex items-center justify-center space-x-1.5 px-2.5 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 disabled:opacity-25 text-emerald-300 text-[11px] font-semibold rounded-xl transition-all duration-300"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Replay</span>
          </button>

          <button
            id="btn-clear-dlq"
            onClick={onClearDLQ}
            disabled={isLoading || dlqCount === 0}
            className="flex items-center justify-center space-x-1.5 px-2.5 py-2 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 disabled:opacity-25 text-slate-300 text-[11px] font-semibold rounded-xl transition-all duration-300"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
        </div>
      </div>
    </div>
  );
};
