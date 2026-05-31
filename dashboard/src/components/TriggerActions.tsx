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
  const btnClass =
    'w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition-colors text-sm';

  return (
    <div className="card p-5">
      <div className="flex items-center space-x-2 pb-3 mb-3 border-b border-zinc-800">
        <Play className="w-4 h-4 text-zinc-400" />
        <h2 className="text-sm font-semibold text-zinc-200">Quick Actions</h2>
      </div>
      <p className="text-[11px] text-zinc-500 mb-4">
        Bulk inject real jobs for load testing or trigger failure scenarios.
      </p>

      <div className="space-y-2">
        <button
          id="btn-add-instant"
          onClick={onAddInstantJobs}
          disabled={isLoading}
          className={`${btnClass} bg-zinc-800/50 hover:bg-zinc-800 border-zinc-700/50 text-zinc-300 disabled:opacity-40`}
        >
          <div className="flex items-center space-x-2">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 text-blue-400" />}
            <span>Inject 10 Real Jobs</span>
          </div>
          <span className="text-[10px] text-zinc-500 font-mono">MIXED</span>
        </button>

        <button
          id="btn-add-delayed"
          onClick={onAddDelayedJobs}
          disabled={isLoading}
          className={`${btnClass} bg-zinc-800/50 hover:bg-zinc-800 border-zinc-700/50 text-zinc-300 disabled:opacity-40`}
        >
          <div className="flex items-center space-x-2">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4 text-amber-400" />}
            <span>Inject 5 Delayed (10s)</span>
          </div>
          <span className="text-[10px] text-zinc-500 font-mono">DELAY</span>
        </button>

        <button
          id="btn-trigger-fail"
          onClick={onTriggerFailureJob}
          disabled={isLoading}
          className={`${btnClass} bg-zinc-800/50 hover:bg-zinc-800 border-zinc-700/50 text-zinc-300 disabled:opacity-40`}
        >
          <div className="flex items-center space-x-2">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertOctagon className="w-4 h-4 text-red-400" />}
            <span>Trigger Failing Job</span>
          </div>
          <span className="text-[10px] text-zinc-500 font-mono">DLQ</span>
        </button>
      </div>

      {/* DLQ Controls */}
      <div className="mt-4 pt-3 border-t border-zinc-800">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[11px] font-medium text-zinc-400">Dead Letter Queue</span>
          <span className="text-[11px] font-mono text-red-400 bg-red-500/10 px-2 py-0.5 rounded">
            {dlqCount}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            id="btn-replay-dlq"
            onClick={onReplayDLQ}
            disabled={isLoading || dlqCount === 0}
            className="flex items-center justify-center space-x-1.5 px-2.5 py-2 bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 disabled:opacity-25 text-emerald-400 text-[12px] font-medium rounded-lg transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Replay</span>
          </button>

          <button
            id="btn-clear-dlq"
            onClick={onClearDLQ}
            disabled={isLoading || dlqCount === 0}
            className="flex items-center justify-center space-x-1.5 px-2.5 py-2 bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 disabled:opacity-25 text-zinc-400 text-[12px] font-medium rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
        </div>
      </div>
    </div>
  );
};
