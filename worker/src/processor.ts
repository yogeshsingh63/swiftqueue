// =============================================================================
// JOB PROCESSOR (V2) — The Real Work Happens Here
// =============================================================================
// This file contains the handler functions that actually EXECUTE jobs.
// The worker calls processJob() with a job payload, and this file decides
// what to do based on job.type.
//
// CURRENT JOB TYPES:
//   - http_request:    Makes actual HTTP calls to real URLs
//   - hash_file:       Downloads a file and computes its SHA-256 hash
//   - data_pipeline:   Fetches JSON from an API, transforms/aggregates it
//   - web_scrape:      Fetches HTML and extracts metadata
//   - send_email:      Sends a real email via Ethereal SMTP (viewable online)
//   - dns_lookup:      Resolves DNS records for a domain (A, MX, NS, TXT)
//   - ping_monitor:    Health-checks multiple URLs in parallel
//   - system_info:     Collects worker system metrics (CPU, memory, OS)
//
// ADDING A NEW JOB TYPE:
//   1. Write an async handler function at the bottom of this file
//   2. Add a `case` in the switch statement in processJob()
//   3. Add the type string to JobType union in producer.ts
//   That's it. The queue engine handles everything else automatically.
// =============================================================================

import crypto from 'crypto';
import dns from 'dns/promises';
import os from 'os';
import nodemailer from 'nodemailer';

export interface JobPayload {
  id: string;
  type: string;
  payload: Record<string, any>;
  priority: 'high' | 'medium' | 'low';
  retryCount: number;
  maxRetries: number;
  retryStrategy: 'fixed' | 'exponential';
  retryDelayMs: number;
  createdAt: number;
  progress: number;
  status: string;
  forceFail?: boolean;
}

// The progress callback type — worker passes this in so we can report progress
export type ProgressCallback = (percent: number) => Promise<void>;

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

export async function processJob(
  job: JobPayload,
  workerId: string,
  onProgress: ProgressCallback
): Promise<any> {
  console.log(`[Worker ${workerId}] Starting Job ${job.id.substring(0, 8)} (${job.type})`);

  // forceFail flag — for testing retries and DLQ
  if (job.forceFail) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    throw new Error('Forced failure for testing/DLQ demonstration.');
  }

  switch (job.type) {
    case 'http_request':
      return await handleHttpRequest(job, workerId, onProgress);
    case 'hash_file':
      return await handleHashFile(job, workerId, onProgress);
    case 'data_pipeline':
      return await handleDataPipeline(job, workerId, onProgress);
    case 'web_scrape':
      return await handleWebScrape(job, workerId, onProgress);
    case 'send_email':
      return await handleSendEmail(job, workerId, onProgress);
    case 'dns_lookup':
      return await handleDnsLookup(job, workerId, onProgress);
    case 'ping_monitor':
      return await handlePingMonitor(job, workerId, onProgress);
    case 'system_info':
      return await handleSystemInfo(job, workerId, onProgress);
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

// =============================================================================
// HANDLER 1: HTTP REQUEST
// =============================================================================
// Makes a real HTTP request to a user-specified URL.
//
// USE CASES:
//   - Webhook delivery (Stripe sends payment events to your app)
//   - API-to-API communication
//   - Health checks
// =============================================================================

async function handleHttpRequest(
  job: JobPayload,
  workerId: string,
  onProgress: ProgressCallback
): Promise<any> {
  const { url, method = 'GET', headers = {}, body, timeoutMs = 10000 } = job.payload;

  if (!url) throw new Error('http_request requires a "url" in payload');

  await onProgress(10);

  const startTime = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await onProgress(30);

    const fetchOptions: RequestInit = {
      method: method.toUpperCase(),
      headers: {
        'User-Agent': `SwiftQueue-Worker/${workerId}`,
        ...headers,
      },
      signal: controller.signal,
    };

    if (['POST', 'PUT', 'PATCH'].includes(method.toUpperCase()) && body) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      if (!headers['Content-Type']) {
        (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(url, fetchOptions);

    await onProgress(70);

    const responseBody = await response.text();
    const latencyMs = Date.now() - startTime;

    await onProgress(100);

    const result = {
      statusCode: response.status,
      statusText: response.statusText,
      responseHeaders: Object.fromEntries(response.headers.entries()),
      bodyLength: responseBody.length,
      bodyPreview: responseBody.substring(0, 500),
      latencyMs,
      url,
      method: method.toUpperCase(),
    };

    console.log(`[Worker ${workerId}] HTTP ${method.toUpperCase()} ${url} → ${response.status} (${latencyMs}ms)`);

    if (response.status >= 500) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }

    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

// =============================================================================
// HANDLER 2: HASH FILE
// =============================================================================
// Downloads a file from a URL and computes its SHA-256 hash.
//
// USE CASES:
//   - Verifying file integrity after upload/download
//   - Detecting duplicate files by comparing hashes
// =============================================================================

async function handleHashFile(
  job: JobPayload,
  workerId: string,
  onProgress: ProgressCallback
): Promise<any> {
  const { url } = job.payload;

  if (!url) throw new Error('hash_file requires a "url" in payload');

  await onProgress(5);

  const startTime = Date.now();
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download file: HTTP ${response.status} ${response.statusText}`);
  }

  await onProgress(20);

  const buffer = await response.arrayBuffer();
  const data = Buffer.from(buffer);

  await onProgress(60);

  const hash = crypto.createHash('sha256');
  hash.update(data);
  const hexDigest = hash.digest('hex');

  await onProgress(90);

  const downloadDurationMs = Date.now() - startTime;

  await onProgress(100);

  const result = {
    sha256: hexDigest,
    fileSize: data.length,
    fileSizeHuman: formatBytes(data.length),
    contentType: response.headers.get('content-type') || 'unknown',
    downloadDurationMs,
    url,
  };

  console.log(`[Worker ${workerId}] Hashed file ${url} → SHA-256: ${hexDigest.substring(0, 16)}... (${result.fileSizeHuman}, ${downloadDurationMs}ms)`);

  return result;
}

// =============================================================================
// HANDLER 3: DATA PIPELINE
// =============================================================================
// Fetches JSON data from a public API, applies transformations, and returns
// aggregated statistics.
//
// USE CASES:
//   - ETL (Extract-Transform-Load) jobs in data engineering
//   - Aggregating data from multiple API sources
// =============================================================================

async function handleDataPipeline(
  job: JobPayload,
  workerId: string,
  onProgress: ProgressCallback
): Promise<any> {
  const {
    url = 'https://jsonplaceholder.typicode.com/posts',
    filterField,
    filterValue,
  } = job.payload;

  await onProgress(10);

  const startTime = Date.now();

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Data pipeline fetch failed: HTTP ${response.status}`);
  }

  const rawData = await response.json();

  await onProgress(40);

  if (!Array.isArray(rawData)) {
    throw new Error('Data pipeline expects the API to return a JSON array');
  }

  let filteredData = rawData;
  if (filterField && filterValue !== undefined) {
    filteredData = rawData.filter((item: any) => {
      const fieldVal = String(item[filterField]);
      return fieldVal === String(filterValue);
    });
  }

  await onProgress(70);

  const fieldAnalysis: Record<string, { type: string; uniqueValues: number; sample: any }> = {};
  if (filteredData.length > 0) {
    const sampleRecord = filteredData[0];
    for (const key of Object.keys(sampleRecord)) {
      const values = filteredData.map((item: any) => item[key]);
      const uniqueValues = new Set(values.map((v: any) => JSON.stringify(v))).size;
      fieldAnalysis[key] = {
        type: typeof sampleRecord[key],
        uniqueValues,
        sample: sampleRecord[key],
      };
    }
  }

  await onProgress(90);

  const durationMs = Date.now() - startTime;

  await onProgress(100);

  const result = {
    sourceUrl: url,
    totalRecords: rawData.length,
    filteredRecords: filteredData.length,
    filterApplied: filterField ? `${filterField} = ${filterValue}` : 'none',
    fields: Object.keys(fieldAnalysis),
    fieldAnalysis,
    sampleRecords: filteredData.slice(0, 3),
    pipelineDurationMs: durationMs,
  };

  console.log(`[Worker ${workerId}] Data pipeline: ${rawData.length} records → ${filteredData.length} after filter (${durationMs}ms)`);

  return result;
}

// =============================================================================
// HANDLER 4: WEB SCRAPE
// =============================================================================
// Fetches an HTML page and extracts metadata without heavy dependencies.
//
// USE CASES:
//   - SEO auditing
//   - Link validation
//   - Content monitoring
// =============================================================================

async function handleWebScrape(
  job: JobPayload,
  workerId: string,
  onProgress: ProgressCallback
): Promise<any> {
  const { url } = job.payload;

  if (!url) throw new Error('web_scrape requires a "url" in payload');

  await onProgress(10);

  const startTime = Date.now();

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'SwiftQueue-Scraper/2.0 (Learning Project)',
      'Accept': 'text/html',
    },
  });

  if (!response.ok) {
    throw new Error(`Scrape failed: HTTP ${response.status} ${response.statusText}`);
  }

  const html = await response.text();

  await onProgress(50);

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : 'No title found';

  const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*\/?>/i)
    || html.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["'][^>]*\/?>/i);
  const metaDescription = metaDescMatch ? metaDescMatch[1].trim() : 'No description found';

  await onProgress(70);

  const linkRegex = /<a[^>]+href=["'](.*?)["'][^>]*>/gi;
  const links: string[] = [];
  let linkMatch;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    links.push(linkMatch[1]);
  }

  const internalLinks = links.filter(l => l.startsWith('/') || l.startsWith('#'));
  const externalLinks = links.filter(l => l.startsWith('http'));

  await onProgress(85);

  const textContent = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const wordCount = textContent.split(' ').filter(w => w.length > 0).length;

  const keywordsMatch = html.match(/<meta[^>]*name=["']keywords["'][^>]*content=["']([\s\S]*?)["'][^>]*\/?>/i);
  const keywords = keywordsMatch ? keywordsMatch[1].trim() : undefined;

  await onProgress(100);

  const durationMs = Date.now() - startTime;

  const result = {
    url,
    title,
    metaDescription,
    keywords,
    totalLinks: links.length,
    internalLinks: internalLinks.length,
    externalLinks: externalLinks.length,
    topExternalLinks: externalLinks.slice(0, 10),
    wordCount,
    htmlSize: formatBytes(html.length),
    scrapeDurationMs: durationMs,
  };

  console.log(`[Worker ${workerId}] Scraped ${url} → "${title}" (${wordCount} words, ${links.length} links, ${durationMs}ms)`);

  return result;
}

// =============================================================================
// HANDLER 5: SEND EMAIL
// =============================================================================
// Sends a REAL email using Nodemailer + Ethereal SMTP.
//
// HOW THIS WORKS:
//   Ethereal (ethereal.email) is Nodemailer's free test email service.
//   It creates a temporary SMTP account, actually sends the email through
//   a real SMTP server, and gives you a URL to VIEW the email in a browser.
//
//   The email is REAL — it goes through a real SMTP handshake, real TLS,
//   real message formatting. The only difference from Gmail/SendGrid is
//   the email stays in Ethereal's test inbox instead of reaching a real
//   mailbox. This is exactly how developers test email in production apps.
//
// WHY NOT USE GMAIL/SENDGRID DIRECTLY?
//   Those require API keys or app passwords. Ethereal is free, no signup,
//   and gives you the same SMTP experience. When you deploy to production,
//   you just swap the SMTP config to your real provider — zero code changes.
//
// RESULT INCLUDES:
//   - messageId: The RFC-822 message ID (proof the email was sent)
//   - previewUrl: A clickable URL to view the email in your browser
// =============================================================================

async function handleSendEmail(
  job: JobPayload,
  workerId: string,
  onProgress: ProgressCallback
): Promise<any> {
  const {
    to = 'test@example.com',
    subject = 'Hello from SwiftQueue!',
    body = '<h1>SwiftQueue Email Test</h1><p>This email was sent by a background worker job.</p>',
    from,
  } = job.payload;

  await onProgress(10);

  const startTime = Date.now();

  // Step 1: Create a free Ethereal test account (auto-generated, no signup needed)
  // This gives us a real SMTP username/password that works immediately.
  const testAccount = await nodemailer.createTestAccount();

  await onProgress(30);

  // Step 2: Create SMTP transport using the test account credentials
  // This is identical to how you'd configure Nodemailer for Gmail or SendGrid —
  // just different host/port/auth values.
  const transporter = nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure, // true for 465, false for other ports
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });

  await onProgress(50);

  // Step 3: Send the email through real SMTP
  const info = await transporter.sendMail({
    from: from || `"SwiftQueue Worker" <${testAccount.user}>`,
    to,
    subject,
    html: body,
  });

  await onProgress(90);

  // Step 4: Get the preview URL — this is where you can VIEW the email
  const previewUrl = nodemailer.getTestMessageUrl(info);

  await onProgress(100);

  const durationMs = Date.now() - startTime;

  const result = {
    messageId: info.messageId,
    from: from || testAccount.user,
    to,
    subject,
    accepted: info.accepted,
    previewUrl, // ← Click this to view the actual email in your browser!
    smtpHost: testAccount.smtp.host,
    durationMs,
  };

  console.log(`[Worker ${workerId}] Email sent to ${to} → Preview: ${previewUrl} (${durationMs}ms)`);

  return result;
}

// =============================================================================
// HANDLER 6: DNS LOOKUP
// =============================================================================
// Resolves DNS records for a domain using Node's built-in dns/promises module.
//
// WHAT ARE DNS RECORDS?
//   When you type "google.com" in your browser, your computer asks a DNS
//   server "what IP address is google.com?" The DNS server responds with
//   records. Different record types serve different purposes:
//
//   - A records:   IPv4 addresses (e.g., 142.250.80.46)
//   - AAAA records: IPv6 addresses
//   - MX records:  Mail servers (which server handles email for this domain)
//   - NS records:  Name servers (which DNS servers are authoritative)
//   - TXT records: Text data (SPF for email auth, domain verification, etc.)
//
// USE CASES:
//   - Domain monitoring (detect DNS changes)
//   - Email deliverability checking (verify MX and SPF records)
//   - Security auditing (check DKIM/DMARC configuration)
//   - Migration verification (confirm DNS propagation after changes)
// =============================================================================

async function handleDnsLookup(
  job: JobPayload,
  workerId: string,
  onProgress: ProgressCallback
): Promise<any> {
  const { domain } = job.payload;

  if (!domain) throw new Error('dns_lookup requires a "domain" in payload');

  // Clean the domain — strip protocol/path if user pastes a full URL
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();

  await onProgress(10);

  const startTime = Date.now();
  const results: Record<string, any> = { domain: cleanDomain };

  // Resolve A records (IPv4)
  try {
    results.A = await dns.resolve4(cleanDomain);
  } catch {
    results.A = [];
  }
  await onProgress(25);

  // Resolve AAAA records (IPv6)
  try {
    results.AAAA = await dns.resolve6(cleanDomain);
  } catch {
    results.AAAA = [];
  }
  await onProgress(40);

  // Resolve MX records (mail servers)
  // MX records have a priority field — lower = higher priority
  try {
    results.MX = await dns.resolveMx(cleanDomain);
    // Sort by priority (ascending — lower number = preferred mail server)
    results.MX.sort((a: any, b: any) => a.priority - b.priority);
  } catch {
    results.MX = [];
  }
  await onProgress(60);

  // Resolve NS records (name servers)
  try {
    results.NS = await dns.resolveNs(cleanDomain);
  } catch {
    results.NS = [];
  }
  await onProgress(75);

  // Resolve TXT records (SPF, DKIM, domain verification tokens)
  try {
    const txtRecords = await dns.resolveTxt(cleanDomain);
    // TXT records come as arrays of strings that need to be joined
    results.TXT = txtRecords.map((chunks: string[]) => chunks.join(''));
  } catch {
    results.TXT = [];
  }
  await onProgress(90);

  const durationMs = Date.now() - startTime;

  results.totalRecords =
    results.A.length + results.AAAA.length + results.MX.length +
    results.NS.length + results.TXT.length;
  results.durationMs = durationMs;

  await onProgress(100);

  console.log(`[Worker ${workerId}] DNS lookup ${cleanDomain} → ${results.totalRecords} records (${durationMs}ms)`);

  return results;
}

// =============================================================================
// HANDLER 7: PING MONITOR
// =============================================================================
// Health-checks multiple URLs in parallel and reports their status.
//
// HOW IT WORKS:
//   Takes an array of URLs, sends a HEAD request to each one simultaneously
//   using Promise.allSettled, and records:
//     - HTTP status code
//     - Response latency (ms)
//     - Up/Down status
//     - Server header (if present)
//
// WHY HEAD INSTEAD OF GET?
//   HEAD is identical to GET but without the response body. It's faster and
//   uses less bandwidth — perfect for health checks where you only care
//   "is this service alive?" not "what data does it return?"
//
// WHY Promise.allSettled INSTEAD OF Promise.all?
//   Promise.all fails fast — if ONE URL times out, all results are lost.
//   Promise.allSettled waits for ALL to complete (or fail) and gives you
//   results for every single one. Essential for monitoring.
//
// USE CASES:
//   - Uptime monitoring (check if your services are alive)
//   - Dependency health checks (are all your third-party APIs responding?)
//   - Post-deployment verification (are all endpoints working after deploy?)
// =============================================================================

async function handlePingMonitor(
  job: JobPayload,
  workerId: string,
  onProgress: ProgressCallback
): Promise<any> {
  const { urls } = job.payload;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    throw new Error('ping_monitor requires "urls" (array of URL strings) in payload');
  }

  // Cap at 20 URLs to prevent abuse
  const targetUrls = urls.slice(0, 20);

  await onProgress(10);

  const startTime = Date.now();

  // Fire all HEAD requests in parallel
  const pingPromises = targetUrls.map(async (url: string) => {
    const pingStart = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout per URL

      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: { 'User-Agent': 'SwiftQueue-PingMonitor/2.0' },
      });

      clearTimeout(timeoutId);

      return {
        url,
        status: response.status,
        statusText: response.statusText,
        latencyMs: Date.now() - pingStart,
        alive: response.status < 500,
        server: response.headers.get('server') || 'unknown',
      };
    } catch (err: any) {
      return {
        url,
        status: 0,
        statusText: err.name === 'AbortError' ? 'Timeout (8s)' : err.message,
        latencyMs: Date.now() - pingStart,
        alive: false,
        server: 'unreachable',
      };
    }
  });

  await onProgress(30);

  // Wait for ALL pings to complete (allSettled never throws)
  const pingResults = await Promise.allSettled(pingPromises);
  const results = pingResults.map((r) => r.status === 'fulfilled' ? r.value : { url: 'unknown', alive: false, error: 'settled-rejection' });

  await onProgress(90);

  const totalDurationMs = Date.now() - startTime;
  const aliveCount = results.filter((r: any) => r.alive).length;
  const downCount = results.length - aliveCount;

  await onProgress(100);

  const result = {
    totalUrls: results.length,
    alive: aliveCount,
    down: downCount,
    healthPercent: Math.round((aliveCount / results.length) * 100),
    results,
    totalDurationMs,
  };

  console.log(`[Worker ${workerId}] Ping monitor: ${aliveCount}/${results.length} alive (${totalDurationMs}ms)`);

  return result;
}

// =============================================================================
// HANDLER 8: SYSTEM INFO
// =============================================================================
// Collects real system metrics from the worker's machine.
//
// HOW IT WORKS:
//   Uses Node's built-in `os` module to read actual hardware and OS info.
//   Everything here is real data from the machine running the worker.
//
// USE CASES:
//   - Worker health monitoring (are workers running low on memory?)
//   - Infrastructure auditing (what specs are your workers running on?)
//   - Capacity planning (how much headroom do workers have?)
//
// WHY IS THIS A QUEUE JOB?
//   In production, you might schedule this as a recurring job (every 5 min)
//   to track worker health over time. The results get stored in job history
//   giving you a time-series view of worker resource usage.
// =============================================================================

async function handleSystemInfo(
  job: JobPayload,
  workerId: string,
  onProgress: ProgressCallback
): Promise<any> {
  await onProgress(10);

  const startTime = Date.now();

  // CPU info
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model || 'unknown';
  const cpuCores = cpus.length;

  // Calculate CPU usage by sampling idle time
  const cpuUsage = cpus.map((cpu) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    const idle = cpu.times.idle;
    return Math.round(((total - idle) / total) * 100);
  });
  const avgCpuUsage = Math.round(cpuUsage.reduce((a, b) => a + b, 0) / cpuUsage.length);

  await onProgress(30);

  // Memory info
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsagePercent = Math.round((usedMemory / totalMemory) * 100);

  await onProgress(50);

  // Process-level info
  const processMemory = process.memoryUsage();

  await onProgress(70);

  // OS info
  const systemInfo = {
    os: {
      type: os.type(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptime: `${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`,
    },
    cpu: {
      model: cpuModel,
      cores: cpuCores,
      usagePerCore: cpuUsage.map((u, i) => `Core ${i}: ${u}%`),
      averageUsage: `${avgCpuUsage}%`,
    },
    memory: {
      total: formatBytes(totalMemory),
      free: formatBytes(freeMemory),
      used: formatBytes(usedMemory),
      usagePercent: `${memoryUsagePercent}%`,
    },
    workerProcess: {
      pid: process.pid,
      nodeVersion: process.version,
      workerId,
      heapUsed: formatBytes(processMemory.heapUsed),
      heapTotal: formatBytes(processMemory.heapTotal),
      rss: formatBytes(processMemory.rss),
    },
    network: {
      interfaces: Object.entries(os.networkInterfaces())
        .filter(([name]) => !name.startsWith('lo'))
        .map(([name, addrs]) => ({
          name,
          addresses: (addrs || [])
            .filter((a) => a.family === 'IPv4')
            .map((a) => a.address),
        }))
        .filter((iface) => iface.addresses.length > 0),
    },
  };

  await onProgress(100);

  const durationMs = Date.now() - startTime;

  console.log(`[Worker ${workerId}] System info collected: ${cpuCores} cores, ${formatBytes(totalMemory)} RAM, ${avgCpuUsage}% CPU (${durationMs}ms)`);

  return { ...systemInfo, collectedAt: Date.now(), durationMs };
}

// =============================================================================
// UTILITY: Format bytes to human-readable string
// =============================================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
