import React, { useState } from 'react';
import { Send, Loader2, Sparkles } from 'lucide-react';

interface JobCreatorProps {
  apiBase: string;
  isLoading: boolean;
  setIsLoading: (v: boolean) => void;
}

type JobType = 'http_request' | 'hash_file' | 'data_pipeline' | 'web_scrape' | 'send_email' | 'dns_lookup' | 'ping_monitor' | 'system_info';
type Priority = 'high' | 'medium' | 'low';
type RetryStrategy = 'fixed' | 'exponential';

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
  custom: { label: '✏️  Custom Job', description: 'Fill in all fields manually', type: 'http_request', payload: {}, priority: 'medium', delaySeconds: 0, maxRetries: 3, retryStrategy: 'exponential', retryDelayMs: 2000 },
  github_api: { label: '🐙  GitHub Zen API', description: 'GET → GitHub Zen (random quote)', type: 'http_request', payload: { url: 'https://api.github.com/zen', method: 'GET' }, priority: 'high', delaySeconds: 0, maxRetries: 3, retryStrategy: 'exponential', retryDelayMs: 2000 },
  httpbin_post: { label: '📮  POST JSON to httpbin', description: 'POST with body → echoes everything back', type: 'http_request', payload: { url: 'https://httpbin.org/post', method: 'POST', body: { name: 'SwiftQueue', version: 2, test: true } }, priority: 'medium', delaySeconds: 0, maxRetries: 2, retryStrategy: 'fixed', retryDelayMs: 3000 },
  hash_linux: { label: '🔐  Hash Linux License', description: 'Downloads COPYING file → SHA-256', type: 'hash_file', payload: { url: 'https://raw.githubusercontent.com/torvalds/linux/master/COPYING' }, priority: 'medium', delaySeconds: 0, maxRetries: 3, retryStrategy: 'exponential', retryDelayMs: 2000 },
  pipeline_posts: { label: '📊  Filter API Posts', description: 'Fetches 100 posts, filters userId=3', type: 'data_pipeline', payload: { url: 'https://jsonplaceholder.typicode.com/posts', filterField: 'userId', filterValue: '3' }, priority: 'medium', delaySeconds: 0, maxRetries: 3, retryStrategy: 'exponential', retryDelayMs: 2000 },
  scrape_example: { label: '🕷️  Scrape example.com', description: 'Extracts title, links, word count', type: 'web_scrape', payload: { url: 'https://example.com' }, priority: 'low', delaySeconds: 0, maxRetries: 2, retryStrategy: 'exponential', retryDelayMs: 2000 },
  send_email: { label: '📧  Send Test Email', description: 'Real SMTP email via Ethereal (viewable online)', type: 'send_email', payload: { to: 'yogesh@example.com', subject: 'Hello from SwiftQueue!', body: '<h1>SwiftQueue</h1><p>Sent by a background worker.</p>' }, priority: 'high', delaySeconds: 0, maxRetries: 3, retryStrategy: 'exponential', retryDelayMs: 2000 },
  dns_google: { label: '🌐  DNS Lookup google.com', description: 'Resolves A, MX, NS, TXT records', type: 'dns_lookup', payload: { domain: 'google.com' }, priority: 'medium', delaySeconds: 0, maxRetries: 2, retryStrategy: 'fixed', retryDelayMs: 1000 },
  dns_github: { label: '🌐  DNS Lookup github.com', description: 'Resolves all DNS records', type: 'dns_lookup', payload: { domain: 'github.com' }, priority: 'low', delaySeconds: 0, maxRetries: 2, retryStrategy: 'fixed', retryDelayMs: 1000 },
  ping_services: { label: '📡  Ping 5 Services', description: 'Parallel health-check on 5 URLs', type: 'ping_monitor', payload: { urls: ['https://google.com', 'https://github.com', 'https://httpbin.org', 'https://jsonplaceholder.typicode.com', 'https://example.com'] }, priority: 'high', delaySeconds: 0, maxRetries: 2, retryStrategy: 'fixed', retryDelayMs: 5000 },
  system_info: { label: '💻  Worker System Info', description: 'Collects CPU, RAM, OS from worker', type: 'system_info', payload: {}, priority: 'low', delaySeconds: 0, maxRetries: 1, retryStrategy: 'fixed', retryDelayMs: 1000 },
  delayed_email: { label: '⏱️  Delayed Email (20s)', description: 'Email sent after 20-second delay', type: 'send_email', payload: { to: 'delayed@example.com', subject: 'Delayed Email', body: '<h1>⏰ Delayed</h1><p>This waited 20 seconds.</p>' }, priority: 'medium', delaySeconds: 20, maxRetries: 3, retryStrategy: 'exponential', retryDelayMs: 2000 },
};

const JOB_TYPE_LABELS: Record<JobType, { label: string; desc: string }> = {
  http_request: { label: 'HTTP Request', desc: 'Make a real HTTP call to any URL' },
  hash_file: { label: 'Hash File', desc: 'Download a file and compute SHA-256' },
  data_pipeline: { label: 'Data Pipeline', desc: 'Fetch, filter, and aggregate JSON data' },
  web_scrape: { label: 'Web Scrape', desc: 'Extract metadata from an HTML page' },
  send_email: { label: 'Send Email', desc: 'Send a real email via Ethereal SMTP' },
  dns_lookup: { label: 'DNS Lookup', desc: 'Resolve DNS records for a domain' },
  ping_monitor: { label: 'Ping Monitor', desc: 'Health-check multiple URLs in parallel' },
  system_info: { label: 'System Info', desc: 'Collect worker CPU, memory, OS metrics' },
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

  const [httpUrl, setHttpUrl] = useState('https://httpbin.org/get');
  const [httpMethod, setHttpMethod] = useState('GET');
  const [httpBody, setHttpBody] = useState('');
  const [hashUrl, setHashUrl] = useState('https://raw.githubusercontent.com/torvalds/linux/master/COPYING');
  const [pipelineUrl, setPipelineUrl] = useState('https://jsonplaceholder.typicode.com/posts');
  const [filterField, setFilterField] = useState('userId');
  const [filterValue, setFilterValue] = useState('1');
  const [scrapeUrl, setScrapeUrl] = useState('https://example.com');
  const [emailTo, setEmailTo] = useState('test@example.com');
  const [emailSubject, setEmailSubject] = useState('Hello from SwiftQueue!');
  const [emailBody, setEmailBody] = useState('<h1>Test</h1><p>Sent by SwiftQueue worker.</p>');
  const [dnsDomain, setDnsDomain] = useState('google.com');
  const [pingUrls, setPingUrls] = useState('https://google.com\nhttps://github.com\nhttps://httpbin.org');

  const applyPreset = (key: string) => {
    setSelectedPreset(key);
    const p = PRESETS[key];
    if (!p || key === 'custom') return;
    setJobType(p.type); setPriority(p.priority); setDelaySeconds(p.delaySeconds);
    setMaxRetries(p.maxRetries); setRetryStrategy(p.retryStrategy); setRetryDelayMs(p.retryDelayMs);
    switch (p.type) {
      case 'http_request': setHttpUrl(p.payload.url || ''); setHttpMethod(p.payload.method || 'GET'); setHttpBody(p.payload.body ? JSON.stringify(p.payload.body, null, 2) : ''); break;
      case 'hash_file': setHashUrl(p.payload.url || ''); break;
      case 'data_pipeline': setPipelineUrl(p.payload.url || ''); setFilterField(p.payload.filterField || ''); setFilterValue(p.payload.filterValue || ''); break;
      case 'web_scrape': setScrapeUrl(p.payload.url || ''); break;
      case 'send_email': setEmailTo(p.payload.to || ''); setEmailSubject(p.payload.subject || ''); setEmailBody(p.payload.body || ''); break;
      case 'dns_lookup': setDnsDomain(p.payload.domain || ''); break;
      case 'ping_monitor': setPingUrls((p.payload.urls || []).join('\n')); break;
      case 'system_info': break;
    }
  };

  const buildPayload = (): Record<string, any> => {
    switch (jobType) {
      case 'http_request': {
        const p: Record<string, any> = { url: httpUrl, method: httpMethod };
        if (httpBody.trim()) { try { p.body = JSON.parse(httpBody); } catch { p.body = httpBody; } }
        return p;
      }
      case 'hash_file': return { url: hashUrl };
      case 'data_pipeline': return { url: pipelineUrl, ...(filterField ? { filterField, filterValue } : {}) };
      case 'web_scrape': return { url: scrapeUrl };
      case 'send_email': return { to: emailTo, subject: emailSubject, body: emailBody };
      case 'dns_lookup': return { domain: dnsDomain };
      case 'ping_monitor': return { urls: pingUrls.split('\n').map(u => u.trim()).filter(Boolean) };
      case 'system_info': return {};
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setLastResult(null);
    try {
      const res = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: jobType, payload: buildPayload(), priority, delayMs: delaySeconds * 1000, maxRetries, retryStrategy, retryDelayMs }),
      });
      const data = await res.json();
      setLastResult(res.ok ? `✓ ${data.job.id.substring(0, 8)} enqueued` : `✗ ${data.error}`);
    } catch (err: any) {
      setLastResult(`✗ ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const inp = 'w-full bg-zinc-900 border border-zinc-700 rounded-md px-2.5 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors';
  const lbl = 'block text-[11px] font-medium text-zinc-400 mb-1';

  return (
    <div className="card p-5">
      <div className="flex items-center space-x-2 pb-3 mb-3 border-b border-zinc-800">
        <Send className="w-4 h-4 text-zinc-400" />
        <h2 className="text-sm font-semibold text-zinc-200">Create Job</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Preset */}
        <div>
          <label className={lbl}><Sparkles className="w-3 h-3 inline mr-1 text-amber-400" />Preset</label>
          <select id="select-preset" value={selectedPreset} onChange={(e) => applyPreset(e.target.value)} className={`${inp} cursor-pointer`}>
            {Object.entries(PRESETS).map(([k, { label }]) => <option key={k} value={k}>{label}</option>)}
          </select>
          {selectedPreset !== 'custom' && <p className="text-[10px] text-zinc-500 mt-1">{PRESETS[selectedPreset].description}</p>}
        </div>

        {/* Job Type */}
        <div>
          <label className={lbl}>Job Type</label>
          <select id="select-job-type" value={jobType} onChange={(e) => { setJobType(e.target.value as JobType); setSelectedPreset('custom'); }} className={`${inp} cursor-pointer`}>
            {Object.entries(JOB_TYPE_LABELS).map(([k, { label }]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <p className="text-[10px] text-zinc-500 mt-1">{JOB_TYPE_LABELS[jobType].desc}</p>
        </div>

        {/* Payload */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-md p-2.5 space-y-2">
          <p className="text-[10px] font-semibold text-zinc-500 uppercase">Payload</p>

          {jobType === 'http_request' && (<>
            <div><label className={lbl}>URL</label><input type="text" value={httpUrl} onChange={(e) => { setHttpUrl(e.target.value); setSelectedPreset('custom'); }} className={inp} /></div>
            <div><label className={lbl}>Method</label><select value={httpMethod} onChange={(e) => { setHttpMethod(e.target.value); setSelectedPreset('custom'); }} className={`${inp} cursor-pointer`}>{['GET','POST','PUT','PATCH','DELETE','HEAD'].map(m => <option key={m} value={m}>{m}</option>)}</select></div>
            {['POST','PUT','PATCH'].includes(httpMethod) && <div><label className={lbl}>Body (JSON)</label><textarea value={httpBody} onChange={(e) => { setHttpBody(e.target.value); setSelectedPreset('custom'); }} className={`${inp} font-mono text-xs h-16 resize-none`} /></div>}
          </>)}

          {jobType === 'hash_file' && <div><label className={lbl}>File URL</label><input type="text" value={hashUrl} onChange={(e) => { setHashUrl(e.target.value); setSelectedPreset('custom'); }} className={inp} /></div>}

          {jobType === 'data_pipeline' && (<>
            <div><label className={lbl}>API URL</label><input type="text" value={pipelineUrl} onChange={(e) => { setPipelineUrl(e.target.value); setSelectedPreset('custom'); }} className={inp} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={lbl}>Filter Field</label><input type="text" value={filterField} onChange={(e) => { setFilterField(e.target.value); setSelectedPreset('custom'); }} className={inp} /></div>
              <div><label className={lbl}>Filter Value</label><input type="text" value={filterValue} onChange={(e) => { setFilterValue(e.target.value); setSelectedPreset('custom'); }} className={inp} /></div>
            </div>
          </>)}

          {jobType === 'web_scrape' && <div><label className={lbl}>Target URL</label><input type="text" value={scrapeUrl} onChange={(e) => { setScrapeUrl(e.target.value); setSelectedPreset('custom'); }} className={inp} /></div>}

          {jobType === 'send_email' && (<>
            <div><label className={lbl}>To</label><input type="text" value={emailTo} onChange={(e) => { setEmailTo(e.target.value); setSelectedPreset('custom'); }} className={inp} /></div>
            <div><label className={lbl}>Subject</label><input type="text" value={emailSubject} onChange={(e) => { setEmailSubject(e.target.value); setSelectedPreset('custom'); }} className={inp} /></div>
            <div><label className={lbl}>Body (HTML)</label><textarea value={emailBody} onChange={(e) => { setEmailBody(e.target.value); setSelectedPreset('custom'); }} className={`${inp} font-mono text-xs h-16 resize-none`} /></div>
          </>)}

          {jobType === 'dns_lookup' && <div><label className={lbl}>Domain</label><input type="text" value={dnsDomain} onChange={(e) => { setDnsDomain(e.target.value); setSelectedPreset('custom'); }} className={inp} /></div>}

          {jobType === 'ping_monitor' && <div><label className={lbl}>URLs (one per line)</label><textarea value={pingUrls} onChange={(e) => { setPingUrls(e.target.value); setSelectedPreset('custom'); }} className={`${inp} font-mono text-xs h-20 resize-none`} /></div>}

          {jobType === 'system_info' && <p className="text-[11px] text-zinc-500 italic py-1">No payload needed — reads from worker OS.</p>}
        </div>

        {/* Priority */}
        <div>
          <label className={lbl}>Priority</label>
          <div className="flex gap-1.5">
            {(['high', 'medium', 'low'] as Priority[]).map((p) => (
              <button key={p} type="button" onClick={() => setPriority(p)}
                className={`flex-1 text-xs font-medium py-1.5 rounded-md border transition-colors ${
                  priority === p
                    ? p === 'high' ? 'bg-red-500/15 border-red-500/30 text-red-300'
                      : p === 'medium' ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                      : 'bg-zinc-700/50 border-zinc-600 text-zinc-300'
                    : 'bg-zinc-900 border-zinc-700 text-zinc-500 hover:text-zinc-300'
                }`}>
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Config */}
        <div className="grid grid-cols-2 gap-2">
          <div><label className={lbl}>Delay (sec)</label><input type="number" min={0} max={300} value={delaySeconds} onChange={(e) => setDelaySeconds(parseInt(e.target.value) || 0)} className={inp} /></div>
          <div><label className={lbl}>Max Retries</label><input type="number" min={0} max={10} value={maxRetries} onChange={(e) => setMaxRetries(parseInt(e.target.value) || 0)} className={inp} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={lbl}>Retry Strategy</label><select value={retryStrategy} onChange={(e) => setRetryStrategy(e.target.value as RetryStrategy)} className={`${inp} cursor-pointer`}><option value="exponential">Exponential</option><option value="fixed">Fixed</option></select></div>
          <div><label className={lbl}>Base Delay (ms)</label><input type="number" min={500} max={30000} step={500} value={retryDelayMs} onChange={(e) => setRetryDelayMs(parseInt(e.target.value) || 2000)} className={inp} /></div>
        </div>

        {/* Submit */}
        <button id="btn-create-job" type="submit" disabled={isLoading}
          className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg transition-colors text-sm font-medium">
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          <span>Enqueue Job</span>
        </button>

        {lastResult && (
          <div className={`text-xs font-mono px-2.5 py-1.5 rounded border ${lastResult.startsWith('✓') ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
            {lastResult}
          </div>
        )}
      </form>
    </div>
  );
};
