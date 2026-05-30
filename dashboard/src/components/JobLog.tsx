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

export const JobLog: React.FC<JobLogProps> = ({ logs, onClear }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new log entries
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  const levelStyles = {
    info: 'text-sky-400 bg-sky-500/5 border-sky-500/10',
    success: 'text-emerald-400 bg-emerald-500/5 border-emerald-500/10',
    warning: 'text-amber-400 bg-amber-500/5 border-amber-500/10',
    error: 'text-rose-400 bg-rose-500/5 border-rose-500/10',
  };

  const padZero = (n: number) => n.toString().padStart(2, '0');

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${padZero(d.getHours())}:${padZero(d.getMinutes())}:${padZero(d.getSeconds())}.${d.getMilliseconds().toString().padStart(3, '0')}`;
  };

  return (
    <div className="glass-panel p-6 flex flex-col h-[400px]">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-4 mb-4">
        <div className="flex items-center space-x-2.5">
          <Terminal className="w-5 h-5 text-indigo-400" />
          <h2 className="font-outfit font-semibold text-lg text-slate-200">Live Queue Telemetry</h2>
        </div>
        <button
          id="btn-clear-logs"
          onClick={onClear}
          className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700/80 border border-slate-700/50 rounded-lg text-slate-400 hover:text-slate-200 transition-all duration-300"
        >
          Clear Logs
        </button>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto bg-[#04060f]/90 border border-slate-900 rounded-xl p-4 font-mono text-[12px] leading-relaxed space-y-2 select-text"
      >
        {logs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-2">
            <Terminal className="w-8 h-8 opacity-40 animate-pulse" />
            <p className="font-sans text-xs tracking-wider">Awaiting telemetry logs...</p>
          </div>
        ) : (
          logs.map((log, idx) => (
            <div
              key={idx}
              className={`flex items-start space-x-3 p-2 rounded-lg border transition-all duration-300 hover:bg-slate-800/20 ${levelStyles[log.level]}`}
            >
              <span className="text-slate-500 select-none flex-shrink-0">{formatTime(log.timestamp)}</span>
              <span className="flex-shrink-0 uppercase text-[9px] font-bold tracking-widest px-1.5 py-0.5 rounded border bg-slate-950/80">
                {log.level}
              </span>
              <span className="break-all">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
