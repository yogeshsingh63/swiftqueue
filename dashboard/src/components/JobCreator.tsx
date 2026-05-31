import React, { useState } from 'react';
import { Send, ChevronDown, Loader2, Sparkles } from 'lucide-react';

interface JobCreatorProps {
  apiBase: string;
  isLoading: boolean;
  setIsLoading: (v: boolean) => void;
}

type JobType = 'http_request' | 'hash_file' | 'data_pipeline' | 'web_scrape';
type Priority = 'high' | 'medium' | 'low';
type RetryStrategy = 'fixed' | 'exponential';

// =============================================================================
// PRESET JOBS
// =============================================================================
// 7 ready-to-go job templates. Selecting one auto-fills the entire form.
// The user can still tweak any field before submitting.
// =============================================================================

interface Preset {
  label: string;
  description: string;
  type: JobType;
  payload: Record<string, any>;
  priority: Priority;
  delaySeconds: number;
  maxRetries: number;
  retryStrategy: RetryStrategy;
  retryDelayMs: number;
}

const PRESETS: Record<string, Preset> = {
  custom: {
    label: '✏️  Custom Job (Manual)',
    description: 'Fill in all fields yourself',
    type: 'http_request',
    payload: {},
    priority: 'medium',
    delaySeconds: 0,
    maxRetries: 3,
    retryStrategy: 'exponential',
    retryDelayMs: 2000,
  },
  github_api: {
    label: '🐙  GitHub API Health Check',
    description: 'GET request to GitHub Zen API — returns a random philosophy quote',
    type: 'http_request',
    payload: { url: 'https://api.github.com/zen', method: 'GET' },
    priority: 'high',
    delaySeconds: 0,
    maxRetries: 3,
    retryStrategy: 'exponential',
    retryDelayMs: 2000,
  },
  httpbin_post: {
    label: '📮  POST with JSON Body',
    description: 'Sends a POST request to httpbin.org with a JSON payload — echoes back everything',
    type: 'http_request',
    payload: {
      url: 'https://httpbin.org/post',
      method: 'POST',
      body: { name: 'SwiftQueue', version: 2, test: true },
    },
    priority: 'medium',
    delaySeconds: 0,
    maxRetries: 2,
    retryStrategy: 'fixed',
    retryDelayMs: 3000,
  },
  hash_linux_license: {
    label: '🔐  Hash Linux License File',
    description: 'Downloads the Linux kernel COPYING file and computes its SHA-256 hash',
    type: 'hash_file',
    payload: { url: 'https://raw.githubusercontent.com/torvalds/linux/master/COPYING' },
    priority: 'medium',
    delaySeconds: 0,
    maxRetries: 3,
    retryStrategy: 'exponential',
    retryDelayMs: 2000,
  },
  hash_node_license: {
    label: '🔑  Hash Node.js License',
    description: 'Downloads the Node.js LICENSE file and computes its SHA-256 hash',
    type: 'hash_file',
    payload: { url: 'https://raw.githubusercontent.com/nodejs/node/main/LICENSE' },
    priority: 'low',
    delaySeconds: 0,
    maxRetries: 2,
    retryStrategy: 'exponential',
    retryDelayMs: 1500,
  },
  pipeline_user_posts: {
    label: '📊  Filter Posts by User',
    description: 'Fetches 100 posts from JSONPlaceholder, filters by userId=3, analyzes fields',
    type: 'data_pipeline',
    payload: {
      url: 'https://jsonplaceholder.typicode.com/posts',
      filterField: 'userId',
      filterValue: '3',
    },
    priority: 'medium',
    delaySeconds: 0,
    maxRetries: 3,
    retryStrategy: 'exponential',
    retryDelayMs: 2000,
  },
  scrape_example: {
    label: '🕷️  Scrape Example.com',
    description: 'Extracts title, meta description, links, and word count from example.com',
    type: 'web_scrape',
    payload: { url: 'https://example.com' },
    priority: 'low',
    delaySeconds: 0,
    maxRetries: 2,
    retryStrategy: 'exponential',
    retryDelayMs: 2000,
  },
  delayed_scrape: {
    label: '⏱️  Delayed Scrape (15s)',
    description: 'Scrapes httpbin.org but delayed by 15 seconds — watch the Delayed counter!',
    type: 'web_scrape',
    payload: { url: 'https://httpbin.org' },
    priority: 'high',
    delaySeconds: 15,
    maxRetries: 3,
    retryStrategy: 'exponential',
    retryDelayMs: 2000,
  },
};

const JOB_TYPE_LABELS: Record<JobType, { label: string; description: string }> = {
  http_request: { label: 'HTTP Request', description: 'Make a real HTTP call to any URL' },
  hash_file: { label: 'Hash File', description: 'Download a file and compute SHA-256' },
  data_pipeline: { label: 'Data Pipeline', description: 'Fetch, filter, and aggregate JSON data' },
  web_scrape: { label: 'Web Scrape', description: 'Extract metadata from an HTML page' },
};

const PRIORITY_COLORS: Record<Priority, string> = {
  high: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  medium: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  low: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
};

export const JobCreator: React.FC<JobCreatorProps> = ({ apiBase, isLoading, setIsLoading }) => {
  const [selectedPreset, setSelectedPreset] = useState<string>('custom');
  const [jobType, setJobType] = useState<JobType>('http_request');
  const [priority, setPriority] = useState<Priority>('medium');
  const [delaySeconds, setDelaySeconds] = useState(0);
  const [maxRetries, setMaxRetries] = useState(3);
  const [retryStrategy, setRetryStrategy] = useState<RetryStrategy>('exponential');
  const [retryDelayMs, setRetryDelayMs] = useState(2000);
  const [lastResult, setLastResult] = useState<string | null>(null);

  // Type-specific payload fields
  const [httpUrl, setHttpUrl] = useState('https://httpbin.org/get');
  const [httpMethod, setHttpMethod] = useState('GET');
  const [httpBody, setHttpBody] = useState('');
  const [hashUrl, setHashUrl] = useState('https://raw.githubusercontent.com/torvalds/linux/master/COPYING');
  const [pipelineUrl, setPipelineUrl] = useState('https://jsonplaceholder.typicode.com/posts');
  const [filterField, setFilterField] = useState('userId');
  const [filterValue, setFilterValue] = useState('1');
  const [scrapeUrl, setScrapeUrl] = useState('https://example.com');

  // Apply a preset — fills in all fields at once
  const applyPreset = (presetKey: string) => {
    setSelectedPreset(presetKey);
    const preset = PRESETS[presetKey];
    if (!preset || presetKey === 'custom') return;

    setJobType(preset.type);
    setPriority(preset.priority);
    setDelaySeconds(preset.delaySeconds);
    setMaxRetries(preset.maxRetries);
    setRetryStrategy(preset.retryStrategy);
    setRetryDelayMs(preset.retryDelayMs);

    // Fill type-specific payload fields
    switch (preset.type) {
      case 'http_request':
        setHttpUrl(preset.payload.url || '');
        setHttpMethod(preset.payload.method || 'GET');
        setHttpBody(preset.payload.body ? JSON.stringify(preset.payload.body, null, 2) : '');
        break;
      case 'hash_file':
        setHashUrl(preset.payload.url || '');
        break;
      case 'data_pipeline':
        setPipelineUrl(preset.payload.url || '');
        setFilterField(preset.payload.filterField || '');
        setFilterValue(preset.payload.filterValue || '');
        break;
      case 'web_scrape':
        setScrapeUrl(preset.payload.url || '');
        break;
    }
  };

  const buildPayload = (): Record<string, any> => {
    switch (jobType) {
      case 'http_request': {
        const payload: Record<string, any> = { url: httpUrl, method: httpMethod };
        if (httpBody.trim()) {
          try {
            payload.body = JSON.parse(httpBody);
          } catch {
            payload.body = httpBody;
          }
        }
        return payload;
      }
      case 'hash_file':
        return { url: hashUrl };
      case 'data_pipeline':
        return {
          url: pipelineUrl,
          ...(filterField ? { filterField, filterValue } : {}),
        };
      case 'web_scrape':
        return { url: scrapeUrl };
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setLastResult(null);

    try {
      const res = await fetch(`${apiBase}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: jobType,
          payload: buildPayload(),
          priority,
          delayMs: delaySeconds * 1000,
          maxRetries,
          retryStrategy,
          retryDelayMs,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setLastResult(`✓ Job ${data.job.id.substring(0, 8)} enqueued (${jobType}, ${priority})`);
      } else {
        setLastResult(`✗ ${data.error}`);
      }
    } catch (err: any) {
      setLastResult(`✗ Network error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const inputClass =
    'w-full bg-slate-950/80 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-all';

  const labelClass = 'block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5';

  return (
    <div className="glass-panel p-5 flex flex-col">
      <div className="flex items-center space-x-2 border-b border-slate-800/80 pb-3 mb-4">
        <Send className="w-4 h-4 text-indigo-400" />
        <h2 className="font-outfit font-semibold text-base text-slate-200">Create Job</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3.5">

        {/* Preset Selector */}
        <div>
          <label className={labelClass}>
            <span className="flex items-center space-x-1.5">
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span>Quick Preset</span>
            </span>
          </label>
          <div className="relative">
            <select
              id="select-preset"
              value={selectedPreset}
              onChange={(e) => applyPreset(e.target.value)}
              className={`${inputClass} appearance-none cursor-pointer pr-8`}
            >
              {Object.entries(PRESETS).map(([key, { label }]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
          </div>
          {selectedPreset !== 'custom' && (
            <p className="text-[10px] text-indigo-400/70 mt-1">{PRESETS[selectedPreset].description}</p>
          )}
        </div>

        {/* Job Type */}
        <div>
          <label className={labelClass}>Job Type</label>
          <div className="relative">
            <select
              id="select-job-type"
              value={jobType}
              onChange={(e) => { setJobType(e.target.value as JobType); setSelectedPreset('custom'); }}
              className={`${inputClass} appearance-none cursor-pointer pr-8`}
            >
              {Object.entries(JOB_TYPE_LABELS).map(([key, { label }]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
          </div>
          <p className="text-[10px] text-slate-500 mt-1">{JOB_TYPE_LABELS[jobType].description}</p>
        </div>

        {/* Dynamic Payload Fields */}
        <div className="bg-slate-900/40 border border-slate-800/50 rounded-lg p-3 space-y-2.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Payload</p>

          {jobType === 'http_request' && (
            <>
              <div>
                <label className={labelClass}>URL</label>
                <input id="input-http-url" type="text" value={httpUrl} onChange={(e) => { setHttpUrl(e.target.value); setSelectedPreset('custom'); }} className={inputClass} placeholder="https://httpbin.org/get" />
              </div>
              <div>
                <label className={labelClass}>Method</label>
                <select id="select-http-method" value={httpMethod} onChange={(e) => { setHttpMethod(e.target.value); setSelectedPreset('custom'); }} className={`${inputClass} appearance-none cursor-pointer`}>
                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              {['POST', 'PUT', 'PATCH'].includes(httpMethod) && (
                <div>
                  <label className={labelClass}>Body (JSON)</label>
                  <textarea
                    id="input-http-body"
                    value={httpBody}
                    onChange={(e) => { setHttpBody(e.target.value); setSelectedPreset('custom'); }}
                    className={`${inputClass} font-mono text-xs h-20 resize-none`}
                    placeholder='{"key": "value"}'
                  />
                </div>
              )}
            </>
          )}

          {jobType === 'hash_file' && (
            <div>
              <label className={labelClass}>File URL</label>
              <input id="input-hash-url" type="text" value={hashUrl} onChange={(e) => { setHashUrl(e.target.value); setSelectedPreset('custom'); }} className={inputClass} placeholder="https://example.com/file.txt" />
            </div>
          )}

          {jobType === 'data_pipeline' && (
            <>
              <div>
                <label className={labelClass}>API URL</label>
                <input id="input-pipeline-url" type="text" value={pipelineUrl} onChange={(e) => { setPipelineUrl(e.target.value); setSelectedPreset('custom'); }} className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelClass}>Filter Field</label>
                  <input id="input-filter-field" type="text" value={filterField} onChange={(e) => { setFilterField(e.target.value); setSelectedPreset('custom'); }} className={inputClass} placeholder="userId" />
                </div>
                <div>
                  <label className={labelClass}>Filter Value</label>
                  <input id="input-filter-value" type="text" value={filterValue} onChange={(e) => { setFilterValue(e.target.value); setSelectedPreset('custom'); }} className={inputClass} placeholder="1" />
                </div>
              </div>
            </>
          )}

          {jobType === 'web_scrape' && (
            <div>
              <label className={labelClass}>Target URL</label>
              <input id="input-scrape-url" type="text" value={scrapeUrl} onChange={(e) => { setScrapeUrl(e.target.value); setSelectedPreset('custom'); }} className={inputClass} placeholder="https://example.com" />
            </div>
          )}
        </div>

        {/* Priority */}
        <div>
          <label className={labelClass}>Priority</label>
          <div className="flex gap-2">
            {(['high', 'medium', 'low'] as Priority[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={`flex-1 text-xs font-bold uppercase tracking-wider py-1.5 rounded-lg border transition-all ${
                  priority === p
                    ? PRIORITY_COLORS[p]
                    : 'border-slate-800/50 bg-slate-900/30 text-slate-600 hover:text-slate-400'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Delay + Retries row */}
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className={labelClass}>Delay (seconds)</label>
            <input id="input-delay" type="number" min={0} max={300} value={delaySeconds} onChange={(e) => setDelaySeconds(parseInt(e.target.value) || 0)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Max Retries</label>
            <input id="input-retries" type="number" min={0} max={10} value={maxRetries} onChange={(e) => setMaxRetries(parseInt(e.target.value) || 0)} className={inputClass} />
          </div>
        </div>

        {/* Retry Strategy */}
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className={labelClass}>Retry Strategy</label>
            <select
              id="select-retry-strategy"
              value={retryStrategy}
              onChange={(e) => setRetryStrategy(e.target.value as RetryStrategy)}
              className={`${inputClass} appearance-none cursor-pointer`}
            >
              <option value="exponential">Exponential</option>
              <option value="fixed">Fixed</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Base Delay (ms)</label>
            <input id="input-retry-delay" type="number" min={500} max={30000} step={500} value={retryDelayMs} onChange={(e) => setRetryDelayMs(parseInt(e.target.value) || 2000)} className={inputClass} />
          </div>
        </div>

        {/* Submit */}
        <button
          id="btn-create-job"
          type="submit"
          disabled={isLoading}
          className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600/30 to-sky-600/30 hover:from-indigo-600/50 hover:to-sky-600/50 disabled:opacity-40 text-indigo-200 border border-indigo-500/30 rounded-xl transition-all duration-300 hover:shadow-[0_0_20px_rgba(99,102,241,0.2)] font-semibold text-sm"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          <span>Enqueue Job</span>
        </button>

        {/* Result feedback */}
        {lastResult && (
          <div className={`text-xs font-mono px-3 py-2 rounded-lg border ${
            lastResult.startsWith('✓')
              ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400'
              : 'bg-rose-500/5 border-rose-500/20 text-rose-400'
          }`}>
            {lastResult}
          </div>
        )}
      </form>
    </div>
  );
};
