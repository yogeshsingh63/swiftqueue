import React from 'react';
import { Play, Clock, AlertOctagon, RotateCcw, Trash2, Loader2 } from 'lucide-react';

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
    <div className="glass-panel p-6 flex flex-col justify-between h-full">
      <div>
        <div className="flex items-center space-x-2 border-b border-slate-800/80 pb-4 mb-4">
          <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-ping" />
          <h2 className="font-outfit font-semibold text-lg text-slate-200">System Controls</h2>
        </div>
        <p className="text-xs text-slate-400 mb-6 leading-relaxed">
          Inject test jobs into the distributed cluster or manage stalled jobs residing in the Dead Letter Queue.
        </p>

        <div className="space-y-3.5">
          {/* Add 10 Instant Jobs */}
          <button
            id="btn-add-instant"
            onClick={onAddInstantJobs}
            disabled={isLoading}
            className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-sky-600/20 to-indigo-600/20 hover:from-sky-600/30 hover:to-indigo-600/30 disabled:opacity-50 disabled:pointer-events-none text-sky-200 border border-sky-500/20 rounded-xl transition-all duration-300 group hover:shadow-neonBlue hover:border-sky-400/50"
          >
            <div className="flex items-center space-x-3">
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
              ) : (
                <Play className="w-5 h-5 text-sky-400 group-hover:scale-110 transition-transform" />
              )}
              <span className="text-sm font-medium">Inject 10 Instant Jobs</span>
            </div>
            <span className="text-[10px] uppercase font-mono tracking-widest text-sky-400/80 bg-sky-400/10 px-2 py-0.5 rounded-md">
              Fast
            </span>
          </button>

          {/* Add 5 Delayed Jobs */}
          <button
            id="btn-add-delayed"
            onClick={onAddDelayedJobs}
            disabled={isLoading}
            className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-purple-600/20 to-indigo-600/20 hover:from-purple-600/30 hover:to-indigo-600/30 disabled:opacity-50 disabled:pointer-events-none text-purple-200 border border-purple-500/20 rounded-xl transition-all duration-300 group hover:shadow-neonPurple hover:border-purple-400/50"
          >
            <div className="flex items-center space-x-3">
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
              ) : (
                <Clock className="w-5 h-5 text-purple-400 group-hover:scale-110 transition-transform" />
              )}
              <span className="text-sm font-medium">Inject 5 Delayed Jobs (10s)</span>
            </div>
            <span className="text-[10px] uppercase font-mono tracking-widest text-purple-400/80 bg-purple-400/10 px-2 py-0.5 rounded-md">
              10s Wait
            </span>
          </button>

          {/* Trigger Fail Job */}
          <button
            id="btn-trigger-fail"
            onClick={onTriggerFailureJob}
            disabled={isLoading}
            className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-rose-600/20 to-pink-600/20 hover:from-rose-600/30 hover:to-pink-600/30 disabled:opacity-50 disabled:pointer-events-none text-rose-200 border border-rose-500/20 rounded-xl transition-all duration-300 group hover:shadow-neonRed hover:border-rose-400/50"
          >
            <div className="flex items-center space-x-3">
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-rose-400" />
              ) : (
                <AlertOctagon className="w-5 h-5 text-rose-400 group-hover:scale-110 transition-transform" />
              )}
              <span className="text-sm font-medium">Trigger Failing Job</span>
            </div>
            <span className="text-[10px] uppercase font-mono tracking-widest text-rose-400/80 bg-rose-400/10 px-2 py-0.5 rounded-md">
              DLQ Test
            </span>
          </button>
        </div>
      </div>

      <div className="mt-8 border-t border-slate-800/80 pt-6">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Dead Letter Queue</span>
          <span className="text-xs font-mono bg-rose-400/10 text-rose-400 border border-rose-400/20 px-2.5 py-0.5 rounded-full font-bold">
            {dlqCount} stalled
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Replay DLQ */}
          <button
            id="btn-replay-dlq"
            onClick={onReplayDLQ}
            disabled={isLoading || dlqCount === 0}
            className="flex items-center justify-center space-x-2 px-3 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/25 border border-emerald-500/20 disabled:opacity-30 disabled:hover:bg-emerald-500/10 text-emerald-300 text-xs font-semibold rounded-xl transition-all duration-300 hover:shadow-neonGreen"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Replay DLQ</span>
          </button>

          {/* Clear DLQ */}
          <button
            id="btn-clear-dlq"
            onClick={onClearDLQ}
            disabled={isLoading || dlqCount === 0}
            className="flex items-center justify-center space-x-2 px-3 py-2.5 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 disabled:opacity-30 disabled:hover:bg-slate-800/60 text-slate-300 text-xs font-semibold rounded-xl transition-all duration-300"
          >
            <Trash2 className="w-4 h-4" />
            <span>Clear DLQ</span>
          </button>
        </div>
      </div>
    </div>
  );
};
