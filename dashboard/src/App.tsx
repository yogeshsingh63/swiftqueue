import { useState, useEffect, useRef } from 'react';
import {
  Layers,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Skull,
  TrendingUp,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

import { StatCard } from './components/StatCard';
import { TriggerActions } from './components/TriggerActions';
import { JobLog, LogEntry } from './components/JobLog';
import { JobCreator } from './components/JobCreator';
import { JobHistory } from './components/JobHistory';

interface QueueStats {
  waiting: number;
  waitingByPriority?: { high: number; medium: number; low: number };
  processing: number;
  delayed: number;
  dlq: number;
  stats: { success: number; failure: number; enqueued: number };
}

interface ChartDataPoint {
  time: string;
  Pending: number;
  Active: number;
  Delayed: number;
  DLQ: number;
}

const API_BASE = `http://${window.location.hostname}:5000/api/jobs`;
const WS_URL = `ws://${window.location.hostname}:5000`;

export default function App() {
  const [stats, setStats] = useState<QueueStats>({
    waiting: 0, processing: 0, delayed: 0, dlq: 0,
    stats: { success: 0, failure: 0, enqueued: 0 },
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [chartHistory, setChartHistory] = useState<ChartDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [connStatus, setConnStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const connectWS = () => {
      setConnStatus('connecting');
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        setConnStatus('connected');
        setLogs((prev) => [...prev, { timestamp: Date.now(), level: 'success', message: 'Connected to SwiftQueue server.' }]);
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'stats') {
            const data: QueueStats = payload.data;
            setStats(data);
            const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            setChartHistory((prev) => [...prev, { time: t, Pending: data.waiting, Active: data.processing, Delayed: data.delayed, DLQ: data.dlq }].slice(-20));
          } else if (payload.type === 'log') {
            setLogs((prev) => [...prev, payload.data].slice(-150));
          }
        } catch (e) {
          console.error('WS parse error:', e);
        }
      };

      ws.onclose = () => {
        setConnStatus('disconnected');
        wsRef.current = null;
        setTimeout(connectWS, 3000);
      };

      wsRef.current = ws;
    };

    connectWS();
    return () => { wsRef.current?.close(); };
  }, []);

  const addInstantJobs = async () => {
    setIsLoading(true);
    try { await fetch(`${API_BASE}/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: 10 }) }); }
    catch (e) { console.error(e); }
    finally { setIsLoading(false); }
  };

  const addDelayedJobs = async () => {
    setIsLoading(true);
    try { await fetch(`${API_BASE}/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: 5, delayMs: 10000 }) }); }
    catch (e) { console.error(e); }
    finally { setIsLoading(false); }
  };

  const triggerFailureJob = async () => {
    setIsLoading(true);
    try { await fetch(API_BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'http_request', payload: { url: 'https://httpbin.org/get' }, forceFail: true }) }); }
    catch (e) { console.error(e); }
    finally { setIsLoading(false); }
  };

  const handleReplayDLQ = async () => {
    setIsLoading(true);
    try { await fetch(`${API_BASE}/dlq/replay`, { method: 'POST' }); }
    catch (e) { console.error(e); }
    finally { setIsLoading(false); }
  };

  const handleClearDLQ = async () => {
    setIsLoading(true);
    try { await fetch(`${API_BASE}/dlq/clear`, { method: 'DELETE' }); }
    catch (e) { console.error(e); }
    finally { setIsLoading(false); }
  };

  return (
    <div className="min-h-screen pb-12 bg-[#111113]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">

        {/* Header */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-zinc-800 pb-5 mb-6 gap-3">
          <div className="flex items-center space-x-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Layers className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-zinc-100">SwiftQueue</h1>
              <p className="text-[11px] text-zinc-500">Distributed Task Queue Console</p>
            </div>
          </div>

          <div className="flex items-center space-x-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${
              connStatus === 'connected' ? 'bg-emerald-400' :
              connStatus === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-red-400'
            }`} />
            <span className="text-zinc-400 font-medium">{connStatus}</span>
          </div>
        </header>

        {/* Stat Cards */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard id="card-active" title="Active" value={stats.processing} icon={Activity} variant="blue"
            description="Currently executing in workers." />
          <StatCard id="card-pending" title="Pending" value={stats.waiting} icon={Layers} variant="purple"
            description={stats.waitingByPriority ? `H:${stats.waitingByPriority.high} M:${stats.waitingByPriority.medium} L:${stats.waitingByPriority.low}` : 'Waiting for workers.'} />
          <StatCard id="card-delayed" title="Delayed" value={stats.delayed} icon={Clock} variant="yellow"
            description="Scheduled or retry-backoff jobs." />
          <StatCard id="card-dlq" title="DLQ" value={stats.dlq} icon={Skull} variant="red"
            description="Failed after max retries." />
        </section>

        {/* Counters */}
        <section className="card p-4 mb-6 grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-[10px] font-medium text-zinc-500 uppercase">Enqueued</p>
            <p className="text-2xl font-bold text-zinc-200 tabular-nums mt-1">{stats.stats.enqueued.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium text-zinc-500 uppercase">Successful</p>
            <p className="text-2xl font-bold text-emerald-400 tabular-nums mt-1 flex items-center justify-center gap-1.5">
              <CheckCircle2 className="w-5 h-5" />{stats.stats.success.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium text-zinc-500 uppercase">Failed</p>
            <p className="text-2xl font-bold text-red-400 tabular-nums mt-1 flex items-center justify-center gap-1.5">
              <XCircle className="w-5 h-5" />{stats.stats.failure.toLocaleString()}
            </p>
          </div>
        </section>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start mb-6">
          {/* Left: Chart + Logs */}
          <div className="lg:col-span-2 space-y-6">
            <div className="card p-5">
              <div className="flex items-center space-x-2 pb-3 mb-4 border-b border-zinc-800">
                <TrendingUp className="w-4 h-4 text-zinc-400" />
                <h2 className="text-sm font-semibold text-zinc-200">Queue Volume</h2>
              </div>
              <div className="h-[220px] w-full">
                {chartHistory.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-zinc-600">
                    <p className="text-xs">Waiting for data...</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartHistory} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gPending" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gActive" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gDelayed" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gDlq" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="time" stroke="#52525b" fontSize={10} />
                      <YAxis stroke="#52525b" fontSize={10} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{
                          background: '#18181b', border: '1px solid #3f3f46',
                          borderRadius: '8px', color: '#e4e4e7', fontSize: '11px',
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                      />
                      <Area type="monotone" dataKey="Pending" stroke="#8b5cf6" fillOpacity={1} fill="url(#gPending)" strokeWidth={1.5} />
                      <Area type="monotone" dataKey="Active" stroke="#3b82f6" fillOpacity={1} fill="url(#gActive)" strokeWidth={1.5} />
                      <Area type="monotone" dataKey="Delayed" stroke="#f59e0b" fillOpacity={1} fill="url(#gDelayed)" strokeWidth={1.5} />
                      <Area type="monotone" dataKey="DLQ" stroke="#ef4444" fillOpacity={1} fill="url(#gDlq)" strokeWidth={1.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <JobLog logs={logs} onClear={() => setLogs([])} />
          </div>

          {/* Right: Creator + Actions */}
          <div className="space-y-6">
            <JobCreator apiBase={API_BASE} isLoading={isLoading} setIsLoading={setIsLoading} />
            <TriggerActions
              onAddInstantJobs={addInstantJobs}
              onAddDelayedJobs={addDelayedJobs}
              onTriggerFailureJob={triggerFailureJob}
              onReplayDLQ={handleReplayDLQ}
              onClearDLQ={handleClearDLQ}
              dlqCount={stats.dlq}
              isLoading={isLoading}
            />
          </div>
        </div>

        {/* History */}
        <JobHistory apiBase={API_BASE} />
      </div>
    </div>
  );
}
