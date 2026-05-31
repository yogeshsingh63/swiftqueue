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

const STATUS_STYLES = {
  completed: { icon: CheckCircle2, label: 'OK', color: 'text-emerald-400' },
  dlq: { icon: Skull, label: 'DLQ', color: 'text-red-400' },
  failed: { icon: XCircle, label: 'FAIL', color: 'text-amber-400' },
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

  useEffect(() => {
    fetchHistory();
    const interval = setInterval(fetchHistory, 3000);
    return () => clearInterval(interval);
  }, [fetchHistory]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchHistory();
    setTimeout(() => setIsRefreshing(false), 400);
  };

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedResult(null);
      return;
    }
    setExpandedId(id);
    setExpandedResult(null);
    try {
      const res = await fetch(`${apiBase}/${id}/result`);
      setExpandedResult(res.ok ? await res.json() : { error: 'Result expired or unavailable' });
    } catch {
      setExpandedResult({ error: 'Failed to fetch' });
    }
  };

  const formatTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-zinc-800">
        <div className="flex items-center space-x-2">
          <History className="w-4 h-4 text-zinc-400" />
          <h2 className="text-sm font-semibold text-zinc-200">Job History</h2>
          <span className="text-[10px] font-mono text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">{history.length}</span>
        </div>
        <button id="btn-refresh-history" onClick={handleRefresh}
          className="flex items-center space-x-1.5 text-[11px] px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors">
          <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {history.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-zinc-600">
          <p className="text-xs">No completed jobs yet.</p>
        </div>
      ) : (
        <div className="space-y-0.5 max-h-[380px] overflow-y-auto">
          {history.map((entry) => {
            const cfg = STATUS_STYLES[entry.status] || STATUS_STYLES.failed;
            const StatusIcon = cfg.icon;
            const isOpen = expandedId === entry.id;

            return (
              <div key={entry.id + entry.completedAt}>
                <button onClick={() => handleExpand(entry.id)}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-md hover:bg-zinc-800/60 transition-colors text-left group">
                  <div className="flex items-center space-x-2.5 min-w-0">
                    {isOpen ? <ChevronDown className="w-3 h-3 text-zinc-500" /> : <ChevronRight className="w-3 h-3 text-zinc-600" />}
                    <StatusIcon className={`w-3.5 h-3.5 flex-shrink-0 ${cfg.color}`} />
                    <span className="text-[11px] font-mono text-zinc-400">#{entry.id.substring(0, 8)}</span>
                    <span className="text-[11px] text-zinc-300 truncate">{entry.type}</span>
                  </div>
                  <div className="flex items-center space-x-2 flex-shrink-0">
                    <span className={`text-[9px] font-medium uppercase px-1.5 py-0.5 rounded border ${
                      entry.priority === 'high' ? 'text-red-400 border-red-500/20 bg-red-500/5' :
                      entry.priority === 'medium' ? 'text-amber-400 border-amber-500/20 bg-amber-500/5' :
                      'text-zinc-500 border-zinc-700 bg-zinc-800/50'
                    }`}>{entry.priority}</span>
                    <span className="text-[11px] font-mono text-zinc-500">{entry.duration}s</span>
                    <span className="text-[11px] font-mono text-zinc-600">{formatTime(entry.completedAt)}</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="ml-6 mt-0.5 mb-1.5 p-3 bg-zinc-900 border border-zinc-800 rounded-md">
                    {expandedResult === null ? (
                      <p className="text-xs text-zinc-500 animate-pulse">Loading...</p>
                    ) : expandedResult.error && !expandedResult.result ? (
                      <p className="text-xs text-red-400">{expandedResult.error}</p>
                    ) : (
                      <pre className="text-[11px] font-mono text-zinc-300 whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto leading-relaxed">
                        {JSON.stringify(expandedResult.result || expandedResult, null, 2)}
                      </pre>
                    )}
                    {entry.error && (
                      <div className="mt-2 text-xs text-red-400 border-t border-zinc-800 pt-2">
                        <span className="font-medium">Error: </span>{entry.error}
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
