// =============================================================================
// REST API ROUTES (V2)
// =============================================================================
// These are the HTTP endpoints that external apps call to interact with
// SwiftQueue. Any application (in any language) can enqueue jobs, check
// results, and manage the queue through these endpoints.
//
// V2 CHANGES FROM V1:
//   - Jobs accept user-provided payloads (not hardcoded)
//   - Payload validation per job type
//   - New: GET /api/jobs/:id/result — fetch stored result for a completed job
//   - New: GET /api/jobs/history — fetch last N job summaries
//   - Bulk endpoint updated for V2 job types
// =============================================================================

import { Router, Request, Response } from 'express';
import { enqueue, KEYS, JobType } from '../queue/producer';
import { redis } from '../config/redis';

const router = Router();

// =============================================================================
// PAYLOAD VALIDATION
// =============================================================================
// Each job type requires specific fields in the payload. This function
// validates the payload BEFORE enqueueing to catch errors early.
//
// WHY VALIDATE ON THE SERVER (not the worker)?
//   If we let invalid payloads through, the worker will fail immediately,
//   waste a retry cycle, and eventually DLQ the job. Validating upfront
//   gives the API caller an immediate 400 error with a clear message.
// =============================================================================

const VALID_JOB_TYPES: JobType[] = ['http_request', 'hash_file', 'data_pipeline', 'web_scrape', 'send_email', 'dns_lookup', 'ping_monitor', 'system_info'];

function validatePayload(type: JobType, payload: Record<string, any>): string | null {
  switch (type) {
    case 'http_request':
      if (!payload.url) return 'http_request requires "url" in payload';
      try {
        new URL(payload.url);
      } catch {
        return `Invalid URL: "${payload.url}"`;
      }
      if (payload.method && !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(payload.method.toUpperCase())) {
        return `Invalid HTTP method: "${payload.method}"`;
      }
      return null;

    case 'hash_file':
      if (!payload.url) return 'hash_file requires "url" in payload';
      try {
        new URL(payload.url);
      } catch {
        return `Invalid URL: "${payload.url}"`;
      }
      return null;

    case 'data_pipeline':
      // URL is optional (defaults to JSONPlaceholder API)
      if (payload.url) {
        try {
          new URL(payload.url);
        } catch {
          return `Invalid URL: "${payload.url}"`;
        }
      }
      return null;

    case 'web_scrape':
      if (!payload.url) return 'web_scrape requires "url" in payload';
      try {
        new URL(payload.url);
      } catch {
        return `Invalid URL: "${payload.url}"`;
      }
      return null;

    case 'send_email':
      // email validation is optional — defaults exist in the processor
      if (payload.to && !payload.to.includes('@')) {
        return `Invalid email address: "${payload.to}"`;
      }
      return null;

    case 'dns_lookup':
      if (!payload.domain) return 'dns_lookup requires "domain" in payload';
      return null;

    case 'ping_monitor':
      if (!payload.urls || !Array.isArray(payload.urls) || payload.urls.length === 0) {
        return 'ping_monitor requires "urls" (array of URL strings) in payload';
      }
      return null;

    case 'system_info':
      // No payload validation needed — reads from the worker's own OS
      return null;

    default:
      return `Unknown job type: "${type}"`;
  }
}

// =============================================================================
// POST /api/jobs — Enqueue a single job
// =============================================================================
// This is the primary endpoint that external applications call.
//
// Request body:
// {
//   "type": "http_request",              // Required: job type
//   "payload": { "url": "..." },         // Required: type-specific data
//   "priority": "high",                  // Optional: high/medium/low (default: medium)
//   "delayMs": 5000,                     // Optional: delay before execution
//   "maxRetries": 3,                     // Optional: retry limit (default: 3)
//   "retryStrategy": "exponential",      // Optional: fixed or exponential (default: exponential)
//   "retryDelayMs": 2000,                // Optional: base retry delay in ms (default: 2000)
//   "forceFail": false                   // Optional: testing flag
// }
// =============================================================================

router.post('/', async (req: Request, res: Response) => {
  try {
    const { type, payload, priority, delayMs, maxRetries, retryStrategy, retryDelayMs, forceFail } = req.body;

    // Validate job type
    if (!type || !VALID_JOB_TYPES.includes(type)) {
      return res.status(400).json({
        error: `Invalid job type. Must be one of: ${VALID_JOB_TYPES.join(', ')}`,
      });
    }

    // Validate payload exists
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Payload must be a JSON object.' });
    }

    // Validate payload fields for the specific job type
    const validationError = validatePayload(type, payload);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    // Enqueue the job
    const job = await enqueue(type, payload, {
      priority,
      delayMs: delayMs || 0,
      maxRetries: maxRetries !== undefined ? maxRetries : 3,
      retryStrategy: retryStrategy || 'exponential',
      retryDelayMs: retryDelayMs || 2000,
      forceFail: !!forceFail,
    });

    return res.status(201).json({ message: 'Job enqueued successfully', job });
  } catch (error: any) {
    console.error('Error enqueuing job:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

// =============================================================================
// POST /api/jobs/bulk — Enqueue multiple jobs
// =============================================================================
// Used by the dashboard's quick-action buttons and for load testing.
// Accepts a count and creates multiple jobs with randomized real payloads.
// =============================================================================

// Helper: generate realistic random payloads for each job type
const getRandomPayload = (type: JobType): Record<string, any> => {
  switch (type) {
    case 'http_request': {
      const urls = [
        'https://httpbin.org/get',
        'https://httpbin.org/status/200',
        'https://jsonplaceholder.typicode.com/posts/1',
        'https://jsonplaceholder.typicode.com/users/1',
        'https://api.github.com/zen',
      ];
      return { url: urls[Math.floor(Math.random() * urls.length)], method: 'GET' };
    }
    case 'hash_file': {
      const files = [
        'https://raw.githubusercontent.com/torvalds/linux/master/COPYING',
        'https://raw.githubusercontent.com/nodejs/node/main/LICENSE',
        'https://httpbin.org/bytes/1024',
      ];
      return { url: files[Math.floor(Math.random() * files.length)] };
    }
    case 'data_pipeline': {
      const userIds = [1, 2, 3, 4, 5];
      return {
        url: 'https://jsonplaceholder.typicode.com/posts',
        filterField: 'userId',
        filterValue: userIds[Math.floor(Math.random() * userIds.length)],
      };
    }
    case 'web_scrape': {
      const sites = [
        'https://example.com',
        'https://httpbin.org',
        'https://jsonplaceholder.typicode.com',
      ];
      return { url: sites[Math.floor(Math.random() * sites.length)] };
    }
    case 'send_email': {
      const subjects = [
        'SwiftQueue Test Email',
        'Order Confirmation #' + Math.floor(Math.random() * 10000),
        'Weekly Report Ready',
        'Password Reset Request',
      ];
      return {
        to: 'test@example.com',
        subject: subjects[Math.floor(Math.random() * subjects.length)],
        body: '<h1>Hello from SwiftQueue!</h1><p>This is a test email sent by a background worker.</p>',
      };
    }
    case 'dns_lookup': {
      const domains = ['google.com', 'github.com', 'nodejs.org', 'reddit.com', 'cloudflare.com'];
      return { domain: domains[Math.floor(Math.random() * domains.length)] };
    }
    case 'ping_monitor': {
      return {
        urls: [
          'https://google.com',
          'https://github.com',
          'https://httpbin.org',
          'https://jsonplaceholder.typicode.com',
          'https://example.com',
        ],
      };
    }
    case 'system_info': {
      return {};
    }
    default:
      return {};
  }
};

router.post('/bulk', async (req: Request, res: Response) => {
  try {
    const { count, type, delayMs, forceFail, priority } = req.body;
    const jobCount = parseInt(count, 10) || 1;

    if (jobCount <= 0 || jobCount > 100) {
      return res.status(400).json({ error: 'Count must be between 1 and 100.' });
    }

    const types: JobType[] = ['http_request', 'hash_file', 'data_pipeline', 'web_scrape', 'send_email', 'dns_lookup', 'ping_monitor', 'system_info'];
    const jobs = [];

    for (let i = 0; i < jobCount; i++) {
      const selectedType: JobType = type && types.includes(type) ? type : types[Math.floor(Math.random() * types.length)];
      const payload = getRandomPayload(selectedType);
      const job = await enqueue(selectedType, payload, {
        priority: priority || 'medium',
        delayMs: delayMs || 0,
        forceFail: !!forceFail,
      });
      jobs.push(job);
    }

    return res.status(201).json({
      message: `Enqueued ${jobCount} jobs successfully.`,
      jobsCount: jobCount,
    });
  } catch (error: any) {
    console.error('Error in bulk enqueue:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

// =============================================================================
// GET /api/jobs/stats — Current queue sizes and counters
// =============================================================================
// Uses a Redis pipeline to fetch all stats in a single round-trip.
//
// WHY PIPELINE?
//   Without a pipeline, each LLEN/HGETALL is a separate network round-trip
//   to Redis. With 5 commands, that's 5 round-trips (~5ms on localhost).
//   A pipeline batches all 5 into a SINGLE round-trip (~1ms total).
//   At 1 request per second (our metrics engine), this adds up.
// =============================================================================

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const pipeline = redis.pipeline();
    pipeline.llen(KEYS.waitingHigh);
    pipeline.llen(KEYS.waitingMedium);
    pipeline.llen(KEYS.waitingLow);
    pipeline.llen(KEYS.processing);
    pipeline.zcard(KEYS.delayed);
    pipeline.llen(KEYS.dlq);
    pipeline.hgetall(KEYS.stats);

    const results = await pipeline.exec();

    if (!results) {
      return res.status(500).json({ error: 'Failed to fetch statistics.' });
    }

    const [
      [, highLen],
      [, mediumLen],
      [, lowLen],
      [, processingLen],
      [, delayedLen],
      [, dlqLen],
      [, rawStats]
    ] = results;

    const stats = rawStats as Record<string, string>;

    return res.json({
      waiting: (highLen as number || 0) + (mediumLen as number || 0) + (lowLen as number || 0),
      waitingByPriority: {
        high: highLen || 0,
        medium: mediumLen || 0,
        low: lowLen || 0,
      },
      processing: processingLen || 0,
      delayed: delayedLen || 0,
      dlq: dlqLen || 0,
      stats: {
        success: parseInt(stats?.success || '0', 10),
        failure: parseInt(stats?.failure || '0', 10),
        enqueued: parseInt(stats?.enqueued || '0', 10),
      }
    });
  } catch (error: any) {
    console.error('Error getting stats:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

// =============================================================================
// GET /api/jobs/:id/result — Fetch the stored result of a completed job
// =============================================================================
// After a worker finishes a job, it stores the result in Redis at
// job:result:<id> with a 1-hour TTL. This endpoint retrieves it.
// =============================================================================

router.get('/:id/result', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const resultKey = `${KEYS.jobResultPrefix}${id}`;
    const resultJson = await redis.get(resultKey);

    if (!resultJson) {
      return res.status(404).json({
        error: 'Result not found. Job may still be processing, or result has expired (TTL: 1 hour).',
      });
    }

    return res.json(JSON.parse(resultJson));
  } catch (error: any) {
    console.error('Error fetching job result:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

// =============================================================================
// GET /api/jobs/history — Fetch the last N job summaries
// =============================================================================
// Returns the most recent completed/failed job summaries from queue:history.
// The list is capped at 200 entries by the worker.
// =============================================================================

router.get('/history', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const historyJson = await redis.lrange(KEYS.jobHistory, 0, limit - 1);

    const history = historyJson.map((json: string) => {
      try {
        return JSON.parse(json);
      } catch {
        return null;
      }
    }).filter(Boolean);

    return res.json({ history, count: history.length });
  } catch (error: any) {
    console.error('Error fetching job history:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

// =============================================================================
// DLQ MANAGEMENT ENDPOINTS
// =============================================================================

router.post('/dlq/replay', async (_req: Request, res: Response) => {
  try {
    const dlqJobs = await redis.lrange(KEYS.dlq, 0, -1);
    if (dlqJobs.length === 0) {
      return res.json({ message: 'DLQ is empty. Nothing to replay.', count: 0 });
    }

    const multi = redis.multi();
    for (const jobJson of dlqJobs) {
      const job = JSON.parse(jobJson);
      // Reset retry count so workers try executing it fresh
      job.retryCount = 0;
      job.status = 'waiting';
      // Push to the correct priority queue
      const waitingKey =
        job.priority === 'high' ? KEYS.waitingHigh :
        job.priority === 'medium' ? KEYS.waitingMedium :
        KEYS.waitingLow;
      multi.lpush(waitingKey, JSON.stringify(job));
    }
    multi.del(KEYS.dlq);

    await multi.exec();

    const event = {
      timestamp: Date.now(),
      level: 'info',
      message: `Replayed ${dlqJobs.length} jobs from DLQ back to their priority queues.`,
    };
    await redis.publish('queue:events', JSON.stringify(event));

    return res.json({
      message: `Successfully replayed ${dlqJobs.length} jobs from DLQ.`,
      count: dlqJobs.length,
    });
  } catch (error: any) {
    console.error('Error replaying DLQ:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

router.delete('/dlq/clear', async (_req: Request, res: Response) => {
  try {
    const count = await redis.llen(KEYS.dlq);
    await redis.del(KEYS.dlq);

    const event = {
      timestamp: Date.now(),
      level: 'info',
      message: `Cleared ${count} jobs from DLQ.`,
    };
    await redis.publish('queue:events', JSON.stringify(event));

    return res.json({
      message: `Successfully cleared ${count} jobs from DLQ.`,
      count,
    });
  } catch (error: any) {
    console.error('Error clearing DLQ:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

export default router;
