// =============================================================================
// JOB PROCESSOR (V2) — The Real Work Happens Here
// =============================================================================
// This file contains the handler functions that actually EXECUTE jobs.
// The worker calls processJob() with a job payload, and this file decides
// what to do based on job.type.
//
// V1 had fake setTimeout delays. V2 does real operations:
//   - http_request:   Makes actual HTTP calls to real URLs
//   - hash_file:      Downloads a file and computes its SHA-256 hash
//   - data_pipeline:  Fetches JSON from an API, transforms/aggregates it
//   - web_scrape:     Fetches HTML and extracts metadata (title, links, etc.)
//
// KEY DESIGN DECISIONS:
//   1. Each handler returns a result object (stored in Redis for querying)
//   2. Each handler receives an onProgress callback for live progress updates
//   3. We use Node's built-in fetch() (available since Node 18) — no extra deps
//   4. We use Node's built-in crypto module for hashing — no extra deps
// =============================================================================

import crypto from 'crypto';

export interface JobPayload {
  id: string;
  type: 'http_request' | 'hash_file' | 'data_pipeline' | 'web_scrape';
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
// The worker calls this function. It dispatches to the correct handler
// based on job.type and returns the result.
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
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

// =============================================================================
// HANDLER 1: HTTP REQUEST
// =============================================================================
// Makes a real HTTP request to a user-specified URL.
//
// USE CASES IN THE REAL WORLD:
//   - Webhook delivery (Stripe sends payment events to your app)
//   - API-to-API communication (your app calls a third-party service)
//   - Health checks (ping a list of URLs and record status)
//
// HOW IT WORKS:
//   1. Reads URL, method, headers, body from the job payload
//   2. Makes the actual HTTP call using Node's built-in fetch()
//   3. Records response status, headers, body size, and total latency
//   4. Returns all of this as the job result
//
// WHY THIS IS A QUEUE JOB AND NOT DONE INLINE:
//   If the target URL is slow (3s) or temporarily down, you don't want
//   your API to hang. Push it to the queue → worker retries with backoff
//   → user gets immediate response.
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

  // AbortController lets us enforce a timeout on the fetch call.
  // Without this, a hanging server could block our worker forever.
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

    // Only attach body for methods that support it
    if (['POST', 'PUT', 'PATCH'].includes(method.toUpperCase()) && body) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      if (!headers['Content-Type']) {
        (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(url, fetchOptions);

    await onProgress(70);

    // Read the response body as text
    const responseBody = await response.text();
    const latencyMs = Date.now() - startTime;

    await onProgress(100);

    const result = {
      statusCode: response.status,
      statusText: response.statusText,
      responseHeaders: Object.fromEntries(response.headers.entries()),
      bodyLength: responseBody.length,
      bodyPreview: responseBody.substring(0, 500), // First 500 chars to avoid huge results
      latencyMs,
      url,
      method: method.toUpperCase(),
    };

    console.log(`[Worker ${workerId}] HTTP ${method.toUpperCase()} ${url} → ${response.status} (${latencyMs}ms)`);

    // If the server returned an error status, we might want to retry
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
//   - Content-addressed storage systems
//
// HOW IT WORKS:
//   1. Fetches the file URL using fetch()
//   2. Reads the response as an ArrayBuffer (loads into memory)
//   3. Feeds the bytes through Node's crypto.createHash('sha256')
//   4. Reports progress based on chunks processed
//   5. Returns the hex-encoded hash, file size, and download duration
//
// WHY SHA-256?
//   It's the industry standard for file integrity checks. Fast enough
//   for our purposes, and collision-resistant enough that two different
//   files will (practically) never produce the same hash.
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

  // Get the content length for progress tracking (may not always be available)
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);

  // Read the response body as an ArrayBuffer
  const buffer = await response.arrayBuffer();
  const data = Buffer.from(buffer);

  await onProgress(60);

  // Compute SHA-256 hash
  // crypto.createHash creates a streaming hash object.
  // We feed it the entire buffer at once (for simplicity).
  // For very large files, you'd want to stream chunks — but for a learning
  // project, this is clear and correct.
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
//   - Scheduled data synchronization between services
//
// HOW IT WORKS:
//   1. Fetches JSON from the provided API URL
//   2. Optionally filters records by a field/value pair
//   3. Computes summary statistics (record count, field analysis)
//   4. Returns the transformed summary
//
// This demonstrates that queue workers can do DATA PROCESSING, not just
// simple API calls. In production, this could be a complex multi-step
// ETL pipeline that takes minutes to run.
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

  // Step 1: EXTRACT — fetch raw data from API
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Data pipeline fetch failed: HTTP ${response.status}`);
  }

  const rawData = await response.json();

  await onProgress(40);

  // Validate that we got an array
  if (!Array.isArray(rawData)) {
    throw new Error('Data pipeline expects the API to return a JSON array');
  }

  // Step 2: TRANSFORM — filter if criteria provided
  let filteredData = rawData;
  if (filterField && filterValue !== undefined) {
    filteredData = rawData.filter((item: any) => {
      const fieldVal = String(item[filterField]);
      return fieldVal === String(filterValue);
    });
  }

  await onProgress(70);

  // Step 3: LOAD (summarize) — compute statistics on the data
  // Analyze all fields: detect types, count unique values
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
    sampleRecords: filteredData.slice(0, 3), // First 3 records as preview
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
//   - SEO auditing (check title, meta descriptions across pages)
//   - Link validation (find broken links on a site)
//   - Content monitoring (detect when a page changes)
//
// HOW IT WORKS:
//   1. Fetches the raw HTML using fetch()
//   2. Uses regex/string parsing to extract:
//      - Page title (<title> tag)
//      - Meta description (<meta name="description">)
//      - All links (<a href="...">)
//      - Word count (visible text approximation)
//   3. Returns the extracted metadata
//
// WHY NOT USE PUPPETEER/CHEERIO?
//   We want zero extra dependencies for the worker. Basic regex parsing
//   handles 90% of static pages. For a learning project, this teaches
//   you how scraping works under the hood before reaching for libraries.
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

  // Extract page title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : 'No title found';

  // Extract meta description
  const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*\/?>/i)
    || html.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["'][^>]*\/?>/i);
  const metaDescription = metaDescMatch ? metaDescMatch[1].trim() : 'No description found';

  await onProgress(70);

  // Extract all links
  const linkRegex = /<a[^>]+href=["'](.*?)["'][^>]*>/gi;
  const links: string[] = [];
  let linkMatch;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    links.push(linkMatch[1]);
  }

  // Categorize links
  const internalLinks = links.filter(l => l.startsWith('/') || l.startsWith('#'));
  const externalLinks = links.filter(l => l.startsWith('http'));

  await onProgress(85);

  // Approximate word count by stripping HTML tags and counting words
  const textContent = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')  // Remove script blocks
    .replace(/<style[\s\S]*?<\/style>/gi, '')     // Remove style blocks
    .replace(/<[^>]+>/g, ' ')                      // Remove all HTML tags
    .replace(/\s+/g, ' ')                          // Normalize whitespace
    .trim();
  const wordCount = textContent.split(' ').filter(w => w.length > 0).length;

  // Extract meta keywords if present
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
// UTILITY: Format bytes to human-readable string
// =============================================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
