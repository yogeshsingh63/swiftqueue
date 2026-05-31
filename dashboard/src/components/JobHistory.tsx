import React, { useState, useEffect, useCallback } from 'react';
import { History, ChevronDown, ChevronRight, RefreshCw, CheckCircle2, XCircle, Skull } from 'lucide-react';

interface HistoryEntry {
  id: string;
  type: string;
  priority: string;
  status: 'completed' | 'dlq' | 'failed';
  duration: number;
  createdAt: number;
  completedAt: number;
  error?: string;
}

interface JobHistoryProps {
  apiBase: string;
}

const STATUS_CONFIG = {
  completed: { icon: CheckCircle2, label: 'Success', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  dlq: { icon: Skull, label: 'DLQ', color: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
  failed: { icon: XCircle, label: 'Failed', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
};

const PRIORITY_BADGE = {
  high: 'bg-rose-500/15 text-rose-300 border-rose-500/25',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  low: 'bg-slate-500/15 text-slate-400 border-slate-500/25',
};

export const JobHistory: React.FC<JobHistoryProps> = ({ apiBase }) => {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedResult, setExpandedResult] = useState<any>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/history?limit=50`);
      const data = await res.json();
      setHistory(data.history || []);
    } catch (e) {
      console.error('Failed to fetch history:', e);
    }
  }, [apiBase]);

  // Auto-refresh history every 3 seconds
  useEffect(() => {
    fetchHistory();
    const interval = setInterval(fetchHistory, 3000);
    return () => clearInterval(interval);
  }, [fetchHistory]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchHistory();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedResult(null);
      return;
    }
    setExpandedId(id);
    setExpandedResult(null);

    // Fetch the full result
    try {
      const res = await fetch(`${apiBase}/${id}/result`);
      if (res.ok) {
        const data = await res.json();
        setExpandedResult(data);
      } else {
        setExpandedResult({ error: 'Result expired or not available' });
      }
    } catch (e) {
      setExpandedResult({ error: 'Failed to fetch result' });
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="glass-panel p-6">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-4 mb-4">
        <div className="flex items-center space-x-2.5">
          <History className="w-5 h-5 text-purple-400" />
          <h2 className="font-outfit font-semibold text-lg text-slate-200">Job History</h2>
          <span className="text-[10px] font-mono bg-slate-800/80 text-slate-400 px-2 py-0.5 rounded-md border border-slate-700/50">
            {history.length} entries
          </span>
        </div>
        <button
          id="btn-refresh-history"
          onClick={handleRefresh}
          className="flex items-center space-x-1.5 text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700/80 border border-slate-700/50 rounded-lg text-slate-400 hover:text-slate-200 transition-all duration-300"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {history.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-slate-600 space-y-2">
          <History className="w-8 h-8 opacity-40" />
          <p className="text-xs tracking-wider">No completed jobs yet. Create and run some jobs!</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
          {history.map((entry) => {
            const statusConfig = STATUS_CONFIG[entry.status] || STATUS_CONFIG.failed;
            const StatusIcon = statusConfig.icon;
            const isExpanded = expandedId === entry.id;
            const priorityStyle = PRIORITY_BADGE[entry.priority as keyof typeof PRIORITY_BADGE] || PRIORITY_BADGE.low;

            return (
              <div key={entry.id + entry.completedAt}>
                {/* Row */}
                <button
                  onClick={() => handleExpand(entry.id)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-slate-800/40 hover:border-slate-700/60 hover:bg-slate-800/20 transition-all duration-200 text-left group"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                    )}

                    {/* Status badge */}
                    <span className={`flex items-center space-x-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border flex-shrink-0 ${statusConfig.color}`}>
                      <StatusIcon className="w-3 h-3" />
                      <span>{statusConfig.label}</span>
                    </span>

                    {/* Job ID */}
                    <span className="text-xs font-mono text-slate-400 flex-shrink-0">
                      #{entry.id.substring(0, 8)}
                    </span>

                    {/* Type */}
                    <span className="text-xs text-slate-300 truncate">
                      {entry.type}
                    </span>
                  </div>

                  <div className="flex items-center space-x-2.5 flex-shrink-0">
                    {/* Priority */}
                    <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${priorityStyle}`}>
                      {entry.priority}
                    </span>

                    {/* Duration */}
                    <span className="text-[11px] font-mono text-slate-500">
                      {entry.duration}s
                    </span>

                    {/* Time */}
                    <span className="text-[11px] font-mono text-slate-600">
                      {formatTime(entry.completedAt)}
                    </span>
                  </div>
                </button>

                {/* Expanded Result */}
                {isExpanded && (
                  <div className="ml-7 mt-1 mb-2 p-3 bg-[#04060f]/80 border border-slate-800/60 rounded-lg">
                    {expandedResult === null ? (
                      <p className="text-xs text-slate-500 animate-pulse">Loading result...</p>
                    ) : expandedResult.error && !expandedResult.result ? (
                      <p className="text-xs text-rose-400">{expandedResult.error}</p>
                    ) : (
                      <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto leading-relaxed">
                        {JSON.stringify(expandedResult.result || expandedResult, null, 2)}
                      </pre>
                    )}
                    {entry.error && (
                      <div className="mt-2 text-xs text-rose-400 border-t border-slate-800/50 pt-2">
                        <span className="font-semibold">Error: </span>{entry.error}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
