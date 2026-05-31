import { redis } from '../config/redis';
import { v4 as uuidv4 } from 'uuid';

// =============================================================================
// JOB INTERFACE (V2)
// =============================================================================
// This is the core data structure that flows through the entire system.
// Every field here exists for a reason — no filler.
//
// WHY each field exists:
//   id            → Unique identifier so we can track/query individual jobs
//   type          → Tells the worker WHICH handler function to call
//   payload       → The actual data the handler needs (URL, file path, etc.)
//   priority      → Determines which Redis list the job goes into
//   retryCount    → How many times this job has been retried (incremented on failure)
//   maxRetries    → The ceiling — after this many retries, job goes to DLQ
//   retryStrategy → 'fixed' = same delay each retry, 'exponential' = doubles each time
//   retryDelayMs  → Base delay between retries (e.g., 2000ms)
//   createdAt     → Unix timestamp when the job was first enqueued
//   progress      → 0-100, updated by the worker during execution
//   status        → Current lifecycle state of the job
//   result        → Populated by the worker on successful completion
//   error         → Populated by the worker on failure
//   completedAt   → Unix timestamp when the job finished (success or final failure)
//   forceFail     → Testing flag — makes the processor throw immediately
// =============================================================================

export type JobType = 'http_request' | 'hash_file' | 'data_pipeline' | 'web_scrape';
export type JobPriority = 'high' | 'medium' | 'low';
export type JobStatus = 'waiting' | 'processing' | 'completed' | 'failed' | 'dlq';
export type RetryStrategy = 'fixed' | 'exponential';

export interface Job {
  id: string;
  type: JobType;
  payload: Record<string, any>;
  priority: JobPriority;
  retryCount: number;
  maxRetries: number;
  retryStrategy: RetryStrategy;
  retryDelayMs: number;
  createdAt: number;
  progress: number;
  status: JobStatus;
  result?: any;
  error?: string;
  completedAt?: number;
  forceFail?: boolean;
}

// =============================================================================
// REDIS KEY NAMESPACE (V2)
// =============================================================================
// WHY 3 separate waiting lists instead of 1?
//
// Redis doesn't have a native priority queue. We have two options:
//
// Option A: Use a Sorted Set (ZADD with priority as score)
//   Problem: BRPOPLPUSH (our atomic pop command) doesn't work on sorted sets.
//   We'd lose our crash-safety guarantee.
//
// Option B: Use 3 separate lists — workers check high first, then medium, then low
//   This preserves BRPOPLPUSH atomicity AND gives us priority ordering.
//   This is exactly what production systems like Sidekiq (Ruby) use.
//
// We use Option B.
// =============================================================================

export const KEYS = {
  // Priority queues — 3 separate Redis Lists
  waitingHigh: 'queue:waiting:high',
  waitingMedium: 'queue:waiting:medium',
  waitingLow: 'queue:waiting:low',

  // Shared queues (same as V1)
  processing: 'queue:processing',
  delayed: 'queue:delayed',
  dlq: 'queue:dlq',
  stats: 'queue:stats',
  processingStart: 'queue:processing_start',

  // NEW in V2 — Job results and history
  // job:result:<id> — a Redis Hash storing the output of a completed job (TTL: 1 hour)
  jobResultPrefix: 'job:result:',
  // queue:history — a Redis List of the last N job summaries (capped at 200)
  jobHistory: 'queue:history',
};

// =============================================================================
// HELPER: Get the correct Redis list key for a priority level
// =============================================================================
function getWaitingKey(priority: JobPriority): string {
  switch (priority) {
    case 'high': return KEYS.waitingHigh;
    case 'medium': return KEYS.waitingMedium;
    case 'low': return KEYS.waitingLow;
    default: return KEYS.waitingLow;
  }
}

// =============================================================================
// ENQUEUE (V2)
// =============================================================================
// This is the "producer" — the function that external apps call to push work
// into the queue. It:
//   1. Creates a Job object with a unique ID and metadata
//   2. Serializes it to JSON (Redis stores strings)
//   3. Pushes it to the correct Redis list based on priority/delay
//   4. Publishes a log event so the dashboard can show it in real-time
// =============================================================================

export async function enqueue(
  type: JobType,
  payload: Record<string, any>,
  options: {
    priority?: JobPriority;
    delayMs?: number;
    maxRetries?: number;
    retryStrategy?: RetryStrategy;
    retryDelayMs?: number;
    forceFail?: boolean;
  } = {}
): Promise<Job> {
  const {
    priority = 'medium',
    delayMs = 0,
    maxRetries = 3,
    retryStrategy = 'exponential',
    retryDelayMs = 2000,
    forceFail = false,
  } = options;

  const job: Job = {
    id: uuidv4(),
    type,
    payload,
    priority,
    retryCount: 0,
    maxRetries,
    retryStrategy,
    retryDelayMs,
    createdAt: Date.now(),
    progress: 0,
    status: 'waiting',
    forceFail,
  };

  const jobJson = JSON.stringify(job);

  // Increment total enqueued count in stats hash
  // HINCRBY is atomic — safe even with multiple producers running concurrently
  await redis.hincrby(KEYS.stats, 'enqueued', 1);

  if (delayMs > 0) {
    // DELAYED JOB:
    // We use a Redis Sorted Set where the SCORE is the Unix timestamp
    // when this job should become active. The delayed scanner loop
    // (below) checks this set every 500ms and migrates expired jobs.
    const executeAt = Date.now() + delayMs;
    await redis.zadd(KEYS.delayed, executeAt, jobJson);
    console.log(`[Producer] Enqueued DELAYED job ${job.id.substring(0, 8)} (${type}, ${priority}) → execute in ${delayMs}ms`);
  } else {
    // INSTANT JOB:
    // LPUSH adds to the LEFT (head) of the list.
    // Workers use RPOPLPUSH which pops from the RIGHT (tail).
    // This gives us FIFO ordering within each priority level:
    //   LPUSH adds newest → [newest, ..., oldest] ← RPOPLPUSH pops oldest first
    const waitingKey = getWaitingKey(priority);
    await redis.lpush(waitingKey, jobJson);
    console.log(`[Producer] Enqueued INSTANT job ${job.id.substring(0, 8)} (${type}, ${priority}) → ${waitingKey}`);
  }

  // Publish a log event to Redis Pub/Sub so the dashboard can stream it
  const event = {
    timestamp: Date.now(),
    level: 'info',
    message: `Job #${job.id.substring(0, 8)} (${type}, ${priority}) enqueued${delayMs > 0 ? ` (delayed ${delayMs / 1000}s)` : ''}.`,
  };
  await redis.publish('queue:events', JSON.stringify(event));

  return job;
}

// =============================================================================
// DELAYED JOBS SCANNER
// =============================================================================
// Runs every 500ms on the server process.
//
// HOW IT WORKS:
//   1. WATCH the delayed sorted set (optimistic locking)
//   2. ZRANGEBYSCORE to find all jobs where score <= now (i.e., time has come)
//   3. In a MULTI/EXEC transaction:
//      - Remove them from the sorted set
//      - LPUSH each one to its priority waiting list
//   4. If another process modified the set between WATCH and EXEC,
//      the transaction aborts (returns null). We just retry next tick.
//
// WHY WATCH + MULTI instead of just MULTI?
//   MULTI alone is NOT atomic in the way you might think. Between the
//   ZRANGEBYSCORE read and the ZREMRANGEBYSCORE delete, another process
//   could modify the set. WATCH makes Redis abort the transaction if
//   the watched key changed, preventing double-processing.
// =============================================================================

export function startDelayedJobsScanner() {
  setInterval(async () => {
    try {
      await redis.watch(KEYS.delayed);

      const now = Date.now();
      const expiredJobs = await redis.zrangebyscore(KEYS.delayed, 0, now);

      if (expiredJobs.length === 0) {
        await redis.unwatch();
        return;
      }

      const multi = redis.multi();
      multi.zremrangebyscore(KEYS.delayed, 0, now);

      for (const jobJson of expiredJobs) {
        // Parse the job to determine its priority so we push to the right queue
        const job: Job = JSON.parse(jobJson);
        const waitingKey = getWaitingKey(job.priority);
        multi.lpush(waitingKey, jobJson);
      }

      const execResult = await multi.exec();
      if (execResult === null) {
        console.log('[Producer] Delayed jobs migration aborted (concurrent modification). Retrying soon...');
      } else {
        console.log(`[Producer] Migrated ${expiredJobs.length} delayed jobs to waiting queues.`);
        for (const jobJson of expiredJobs) {
          const job: Job = JSON.parse(jobJson);
          const event = {
            timestamp: Date.now(),
            level: 'info',
            message: `Delayed job #${job.id.substring(0, 8)} (${job.type}) is now active → ${job.priority} queue.`,
          };
          await redis.publish('queue:events', JSON.stringify(event));
        }
      }
    } catch (error) {
      console.error('[Producer] Error in delayed jobs scanner:', error);
      try {
        await redis.unwatch();
      } catch (e) {}
    }
  }, 500);
}

// =============================================================================
// JOB RECLAIMER (Crash Recovery)
// =============================================================================
// Runs every 5 seconds on the server process.
//
// WHAT PROBLEM DOES THIS SOLVE?
//   When a worker does BRPOPLPUSH, the job moves from queue:waiting to
//   queue:processing. If the worker crashes AFTER popping but BEFORE
//   finishing, the job is stuck in queue:processing forever. Nobody
//   will ever process it again.
//
// HOW THE RECLAIMER FIXES THIS:
//   1. Scans all jobs in queue:processing
//   2. For each job, checks how long it's been there (via queue:processing_start hash)
//   3. If it's been there > 15 seconds, the worker is probably dead
//   4. If retryCount < maxRetries → put it back in queue:waiting (with incremented retry count)
//   5. If retryCount >= maxRetries → move it to queue:dlq (Dead Letter Queue)
//
// This is the "self-healing" property of the queue — no manual intervention needed.
// =============================================================================

export function startJobReclaimer() {
  setInterval(async () => {
    try {
      const processingJobs = await redis.lrange(KEYS.processing, 0, -1);
      if (processingJobs.length === 0) return;

      const now = Date.now();
      const reclaimThresholdMs = 15000;

      for (const jobJson of processingJobs) {
        const job: Job = JSON.parse(jobJson);

        const startTimeStr = await redis.hget(KEYS.processingStart, job.id);
        let shouldReclaim = false;
        let reason = '';

        if (startTimeStr) {
          const startTime = parseInt(startTimeStr, 10);
          if (now - startTime > reclaimThresholdMs) {
            shouldReclaim = true;
            reason = `execution timed out (${Math.round((now - startTime) / 1000)}s)`;
          }
        } else {
          if (now - job.createdAt > reclaimThresholdMs + 5000) {
            shouldReclaim = true;
            reason = 'worker stalled before starting execution';
          }
        }

        if (shouldReclaim) {
          console.warn(`[Reclaimer] Job ${job.id.substring(0, 8)} detected as stalled (${reason}). Reclaiming...`);

          const multi = redis.multi();
          multi.lrem(KEYS.processing, 1, jobJson);
          multi.hdel(KEYS.processingStart, job.id);

          if (job.retryCount < job.maxRetries) {
            job.retryCount += 1;
            job.status = 'waiting';
            const updatedJobJson = JSON.stringify(job);
            const waitingKey = getWaitingKey(job.priority);
            multi.lpush(waitingKey, updatedJobJson);

            await multi.exec();

            const event = {
              timestamp: Date.now(),
              level: 'warning',
              message: `Job #${job.id.substring(0, 8)} (${job.type}) stalled. Reclaiming & retrying (${job.retryCount}/${job.maxRetries}).`,
            };
            await redis.publish('queue:events', JSON.stringify(event));
          } else {
            multi.lpush(KEYS.dlq, jobJson);
            multi.hincrby(KEYS.stats, 'failure', 1);

            await multi.exec();

            // Store failure in job history
            const historySummary = {
              id: job.id,
              type: job.type,
              priority: job.priority,
              status: 'dlq' as JobStatus,
              duration: startTimeStr ? Math.round((now - parseInt(startTimeStr, 10)) / 1000) : 0,
              createdAt: job.createdAt,
              completedAt: now,
              error: reason,
            };
            await redis.lpush(KEYS.jobHistory, JSON.stringify(historySummary));
            await redis.ltrim(KEYS.jobHistory, 0, 199);

            const event = {
              timestamp: Date.now(),
              level: 'error',
              message: `Job #${job.id.substring(0, 8)} (${job.type}) failed after max retries. Moved to DLQ.`,
            };
            await redis.publish('queue:events', JSON.stringify(event));
          }
        }
      }
    } catch (error) {
      console.error('[Reclaimer] Error in job reclaimer:', error);
    }
  }, 5000);
}
