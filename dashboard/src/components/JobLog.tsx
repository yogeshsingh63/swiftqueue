import React, { useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';

export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
}

interface JobLogProps {
  logs: LogEntry[];
  onClear: () => void;
}

const LEVEL_DOT: Record<string, string> = {
  info: 'bg-blue-400',
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  error: 'bg-red-400',
};

const LEVEL_TEXT: Record<string, string> = {
  info: 'text-zinc-300',
  success: 'text-emerald-300',
  warning: 'text-amber-300',
  error: 'text-red-300',
};

export const JobLog: React.FC<JobLogProps> = ({ logs, onClear }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="card p-5 flex flex-col h-[380px]">
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-zinc-800">
        <div className="flex items-center space-x-2">
          <Terminal className="w-4 h-4 text-zinc-400" />
          <h2 className="text-sm font-semibold text-zinc-200">Live Logs</h2>
          <span className="text-[10px] font-mono text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">
            {logs.length}
          </span>
        </div>
        <button
          id="btn-clear-logs"
          onClick={onClear}
          className="text-[11px] px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          Clear
        </button>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-lg p-3 font-mono text-[11px] leading-[1.7] space-y-0.5 select-text"
      >
        {logs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-zinc-600">
            <p className="font-sans text-xs">Waiting for events...</p>
          </div>
        ) : (
          logs.map((log, idx) => (
            <div key={idx} className="flex items-start space-x-2 py-0.5 hover:bg-zinc-900/50 px-1.5 rounded">
              <span className="text-zinc-600 flex-shrink-0">{formatTime(log.timestamp)}</span>
              <span className={`w-1.5 h-1.5 rounded-full mt-[6px] flex-shrink-0 ${LEVEL_DOT[log.level]}`} />
              <span className={`break-all ${LEVEL_TEXT[log.level]}`}>{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
