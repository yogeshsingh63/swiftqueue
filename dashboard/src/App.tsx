import { useState, useEffect, useRef } from 'react';
import {
  Layers,
  Activity,
  CheckCircle2,
  XCircle,
  Network,
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
  waitingByPriority?: {
    high: number;
    medium: number;
    low: number;
  };
  processing: number;
  delayed: number;
  dlq: number;
  stats: {
    success: number;
    failure: number;
    enqueued: number;
  };
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
    waiting: 0,
    processing: 0,
    delayed: 0,
    dlq: 0,
    stats: { success: 0, failure: 0, enqueued: 0 },
  });

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [chartHistory, setChartHistory] = useState<ChartDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [connStatus, setConnStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);

  // Initialize WebSockets
  useEffect(() => {
    const connectWS = () => {
      console.log(`[WebSocket] Connecting to ${WS_URL}...`);
      setConnStatus('connecting');
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log('[WebSocket] Connection established.');
        setConnStatus('connected');
        setLogs((prev) => [
          ...prev,
          {
            timestamp: Date.now(),
            level: 'success',
            message: 'Dashboard connected to SwiftQueue V2 server.',
          },
        ]);
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          
          if (payload.type === 'stats') {
            const data: QueueStats = payload.data;
            setStats(data);
            
            // Record chart history
            const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            setChartHistory((prev) => {
              const next = [
                ...prev,
                {
                  time: timeString,
                  Pending: data.waiting,
                  Active: data.processing,
                  Delayed: data.delayed,
                  DLQ: data.dlq,
                },
              ];
              return next.slice(-20);
            });

          } else if (payload.type === 'log') {
            const data: LogEntry = payload.data;
            setLogs((prev) => [...prev, data].slice(-150));
          } else if (payload.type === 'progress') {
            // Progress events can be used for live progress bars in the future
            // For now, we log them as telemetry
            console.log(`[Progress] Job ${payload.data.jobId}: ${payload.data.percent}%`);
          }
        } catch (e) {
          console.error('[WebSocket] Message parsing error:', e);
        }
      };

      ws.onerror = (err) => {
        console.error('[WebSocket] Socket error:', err);
      };

      ws.onclose = () => {
        console.warn('[WebSocket] Socket closed. Attempting reconnect in 3s...');
        setConnStatus('disconnected');
        wsRef.current = null;
        setTimeout(() => {
          connectWS();
        }, 3000);
      };

      wsRef.current = ws;
    };

    connectWS();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // REST API Methods for quick actions
  const addInstantJobs = async () => {
    setIsLoading(true);
    try {
      await fetch(`${API_BASE}/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 10 }),
      });
    } catch (e) {
      console.error('Failed to inject instant jobs:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const addDelayedJobs = async () => {
    setIsLoading(true);
    try {
      await fetch(`${API_BASE}/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 5, delayMs: 10000 }),
      });
    } catch (e) {
      console.error('Failed to inject delayed jobs:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const triggerFailureJob = async () => {
    setIsLoading(true);
    try {
      await fetch(`${API_BASE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'http_request', payload: { url: 'https://httpbin.org/get' }, forceFail: true }),
      });
    } catch (e) {
      console.error('Failed to inject failing job:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReplayDLQ = async () => {
    setIsLoading(true);
    try {
      await fetch(`${API_BASE}/dlq/replay`, { method: 'POST' });
    } catch (e) {
      console.error('Failed to replay DLQ:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearDLQ = async () => {
    setIsLoading(true);
    try {
      await fetch(`${API_BASE}/dlq/clear`, { method: 'DELETE' });
    } catch (e) {
      console.error('Failed to clear DLQ:', e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen pb-12 relative overflow-hidden bg-[#060913]">
      {/* Decorative Neon Blurs */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-900/20 rounded-full blur-[120px] pointer-events-none pulse-bg" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-sky-950/20 rounded-full blur-[120px] pointer-events-none pulse-bg" />

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        
        {/* Header Block */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-800/80 pb-6 mb-8 gap-4">
          <div className="flex items-center space-x-3">
            <div className="bg-gradient-to-tr from-indigo-500 to-sky-400 p-2.5 rounded-2xl shadow-lg shadow-indigo-500/20">
              <Layers className="w-8 h-8 text-slate-900 stroke-[2]" />
            </div>
            <div>
              <h1 className="font-outfit text-3xl font-extrabold tracking-tight bg-gradient-to-r from-slate-50 via-slate-200 to-slate-400 bg-clip-text text-transparent">
                SwiftQueue
              </h1>
              <p className="text-xs text-slate-400 font-medium tracking-wide mt-0.5">
                Custom Distributed Task Queue — V2
              </p>
            </div>
          </div>

          {/* Connection Status Badge */}
          <div className="flex items-center space-x-3 bg-slate-900/80 border border-slate-800/80 px-4 py-2 rounded-2xl">
            <div className="flex items-center space-x-2">
              <Network className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-mono font-medium text-slate-400">Server:</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className={`w-2 h-2 rounded-full ${
                connStatus === 'connected' ? 'bg-emerald-400 animate-pulse' :
                connStatus === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-rose-400'
              }`} />
              <span className={`text-xs font-bold font-sans uppercase tracking-wider ${
                connStatus === 'connected' ? 'text-emerald-400' :
                connStatus === 'connecting' ? 'text-amber-400' : 'text-rose-400'
              }`}>
                {connStatus}
              </span>
            </div>
          </div>
        </header>

        {/* Primary Statistics Row */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard
            id="card-active"
            title="Active Processing"
            value={stats.processing}
            icon={Activity}
            variant="blue"
            description="Jobs currently executing in worker processes."
          />
          <StatCard
            id="card-pending"
            title="Pending In Queue"
            value={stats.waiting}
            icon={Layers}
            variant="purple"
            description={stats.waitingByPriority ? `H:${stats.waitingByPriority.high} M:${stats.waitingByPriority.medium} L:${stats.waitingByPriority.low}` : 'Waiting for workers to pick up.'}
          />
          <StatCard
            id="card-delayed"
            title="Delayed Execution"
            value={stats.delayed}
            icon={Clock}
            variant="yellow"
            description="Scheduled jobs or retry-backoff jobs waiting for their timestamp."
          />
          <StatCard
            id="card-dlq"
            title="Dead Letter Queue"
            value={stats.dlq}
            icon={Skull}
            variant="red"
            description="Failed after max retries. Replay or clear from controls."
          />
        </section>

        {/* Cluster Counters Block */}
        <section className="glass-panel p-6 mb-8 grid grid-cols-1 sm:grid-cols-3 gap-6 text-center divide-y sm:divide-y-0 sm:divide-x divide-slate-800/80">
          <div className="pt-4 sm:pt-0">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Total Enqueued</p>
            <h4 className="font-outfit text-3xl font-bold text-indigo-400 mt-2">
              {stats.stats.enqueued.toLocaleString()}
            </h4>
          </div>
          <div className="pt-4 sm:pt-0">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Successful</p>
            <h4 className="font-outfit text-3xl font-bold text-emerald-400 mt-2 flex items-center justify-center space-x-1.5">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
              <span>{stats.stats.success.toLocaleString()}</span>
            </h4>
          </div>
          <div className="pt-4 sm:pt-0">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Failed → DLQ</p>
            <h4 className="font-outfit text-3xl font-bold text-rose-400 mt-2 flex items-center justify-center space-x-1.5">
              <XCircle className="w-6 h-6 text-rose-400" />
              <span>{stats.stats.failure.toLocaleString()}</span>
            </h4>
          </div>
        </section>

        {/* Main Grid: Chart + Controls */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start mb-8">
          {/* Left: Chart + Logs */}
          <div className="lg:col-span-2 space-y-8">
            {/* Live Chart */}
            <div className="glass-panel p-6">
              <div className="flex items-center space-x-2.5 border-b border-slate-800/80 pb-4 mb-6">
                <TrendingUp className="w-5 h-5 text-sky-400" />
                <h2 className="font-outfit font-semibold text-lg text-slate-200">Real-time Queue Volume</h2>
              </div>
              
              <div className="h-[250px] w-full">
                {chartHistory.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-600">
                    <p className="text-xs font-medium tracking-wide">Awaiting metrics data...</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartHistory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorPending" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#a855f7" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorActive" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#38bdf8" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorDelayed" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#fbbf24" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorDlq" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f87171" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#f87171" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                      <XAxis dataKey="time" stroke="rgba(255,255,255,0.3)" fontSize={10} />
                      <YAxis stroke="rgba(255,255,255,0.3)" fontSize={10} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{
                          background: '#0d1426',
                          borderColor: 'rgba(255,255,255,0.15)',
                          borderRadius: '12px',
                          color: '#f8fafc',
                          fontSize: '11px',
                          fontFamily: 'Fira Code, monospace',
                        }}
                      />
                      <Area type="monotone" dataKey="Pending" stroke="#a855f7" fillOpacity={1} fill="url(#colorPending)" strokeWidth={2} />
                      <Area type="monotone" dataKey="Active" stroke="#38bdf8" fillOpacity={1} fill="url(#colorActive)" strokeWidth={2} />
                      <Area type="monotone" dataKey="Delayed" stroke="#fbbf24" fillOpacity={1} fill="url(#colorDelayed)" strokeWidth={2} />
                      <Area type="monotone" dataKey="DLQ" stroke="#f87171" fillOpacity={1} fill="url(#colorDlq)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Logs Console */}
            <JobLog logs={logs} onClear={() => setLogs([])} />
          </div>

          {/* Right: Job Creator + Quick Actions (stacked) */}
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

        {/* Job History — Full Width */}
        <JobHistory apiBase={API_BASE} />

      </div>
    </div>
  );
}
