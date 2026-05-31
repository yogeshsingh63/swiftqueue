// =============================================================================
// WORKER PROCESS (V2) — The Polling Engine
// =============================================================================
// This is an independent Node.js process that:
//   1. Connects to Redis
//   2. Polls for jobs across 3 priority queues (high → medium → low)
//   3. Executes jobs using the processor handlers
//   4. Handles success (store result, increment stats)
//   5. Handles failure (exponential backoff retry OR move to DLQ)
//   6. Publishes progress and log events for the dashboard
//
// You can run MULTIPLE instances of this process simultaneously.
// Each gets a unique workerId, and Redis ensures no two workers
// ever pick up the same job (thanks to RPOPLPUSH atomicity).
// =============================================================================

import { redis } from './config/redis';
import { processJob, JobPayload } from './processor';
import crypto from 'crypto';

// Generate a unique ID for this worker instance
// In production, you might use hostname + PID. For simplicity, we use random bytes.
const workerId = crypto.randomBytes(4).toString('hex');

// =============================================================================
// REDIS KEY NAMESPACE (must match server/src/queue/producer.ts)
// =============================================================================
// These keys are shared between the server and worker. They MUST be identical.
// In a larger project, you'd put this in a shared package. For our monorepo,
// we keep them in sync manually.
// =============================================================================

const KEYS = {
  waitingHigh: 'queue:waiting:high',
  waitingMedium: 'queue:waiting:medium',
  waitingLow: 'queue:waiting:low',
  processing: 'queue:processing',
  delayed: 'queue:delayed',
  stats: 'queue:stats',
  dlq: 'queue:dlq',
  processingStart: 'queue:processing_start',
  jobResultPrefix: 'job:result:',
  jobHistory: 'queue:history',
};

let isRunning = true;

// =============================================================================
// LOG PUBLISHER
// =============================================================================
// Sends log events to Redis Pub/Sub channel 'queue:events'.
// The server subscribes to this channel and forwards events to WebSocket
// clients (the dashboard).
// =============================================================================

async function publishLog(level: 'info' | 'warning' | 'error' | 'success', message: string) {
  const event = {
    timestamp: Date.now(),
    level,
    message: `[Worker #${workerId}] ${message}`,
  };
  try {
    await redis.publish('queue:events', JSON.stringify(event));
  } catch (e) {
    console.error('Failed to publish log event:', e);
  }
}

// =============================================================================
// PROGRESS PUBLISHER
// =============================================================================
// Publishes job progress (0-100%) to a dedicated Redis Pub/Sub channel.
// The server forwards these to WebSocket clients so the dashboard can
// show live progress bars.
// =============================================================================

async function publishProgress(jobId: string, percent: number) {
  const event = {
    jobId,
    percent,
    timestamp: Date.now(),
  };
  try {
    await redis.publish('queue:progress', JSON.stringify(event));
  } catch (e) {
    console.error('Failed to publish progress:', e);
  }
}

// =============================================================================
// PRIORITY-AWARE POLLING LOOP
// =============================================================================
// This is the heart of the worker. Here's how priority polling works:
//
// 1. First, try to pop from queue:waiting:high (non-blocking RPOPLPUSH)
//    - If a high-priority job exists, process it immediately
//
// 2. If high queue is empty, try queue:waiting:medium (non-blocking)
//    - Medium jobs only get picked up when no high-priority work is pending
//
// 3. If medium queue is also empty, try queue:waiting:low (non-blocking)
//    - Low priority = "do this when you have nothing better to do"
//
// 4. If ALL queues are empty, sleep for 500ms to avoid busy-looping
//    - This is a tradeoff: 500ms max latency vs CPU usage
//    - Production systems use Redis SUBSCRIBE for instant wakeup,
//      but that adds complexity beyond our learning scope
//
// WHY RPOPLPUSH (not just RPOP)?
//   RPOPLPUSH atomically pops from queue:waiting AND pushes to queue:processing
//   in a SINGLE Redis command. This means:
//     - If the worker crashes AFTER the pop but BEFORE finishing the job,
//       the job is STILL in queue:processing (not lost!)
//     - The server's Job Reclaimer will find it and re-queue it
//   With plain RPOP, the job would vanish if the worker crashes. Gone forever.
// =============================================================================

async function poll() {
  console.log(`[*] Worker ${workerId} active and polling for jobs (priority: high → medium → low)...`);
  await publishLog('info', 'Worker activated. Priority polling enabled.');

  while (isRunning) {
    let jobJson: string | null = null;

    try {
      // Priority polling: high → medium → low (non-blocking checks)
      // rpoplpush: atomically pop from source list, push to destination list
      jobJson = await redis.rpoplpush(KEYS.waitingHigh, KEYS.processing);

      if (!jobJson) {
        jobJson = await redis.rpoplpush(KEYS.waitingMedium, KEYS.processing);
      }

      if (!jobJson) {
        jobJson = await redis.rpoplpush(KEYS.waitingLow, KEYS.processing);
      }

      if (!jobJson) {
        // All queues empty — sleep briefly to avoid burning CPU
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }

      // =================================================================
      // JOB EXECUTION
      // =================================================================

      const job: JobPayload = JSON.parse(jobJson);
      const startTime = Date.now();

      // Record the processing start timestamp in Redis Hash
      // The Job Reclaimer uses this to detect stalled jobs
      await redis.hset(KEYS.processingStart, job.id, startTime.toString());

      console.log(`[Worker ${workerId}] Pulled Job ${job.id.substring(0, 8)} (Type: ${job.type}, Priority: ${job.priority})`);
      await publishLog('info', `Started Job #${job.id.substring(0, 8)} (${job.type}, ${job.priority}).`);

      try {
        // Create a progress callback that the processor can call
        const onProgress = async (percent: number) => {
          await publishProgress(job.id, percent);
        };

        // Execute the job — this calls the real handler (HTTP request, hash, etc.)
        const result = await processJob(job, workerId, onProgress);

        // =============================================================
        // SUCCESS HANDLER
        // =============================================================
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);

        // Atomic cleanup: remove from processing, clear start time, increment success
        const multi = redis.multi();
        multi.lrem(KEYS.processing, 1, jobJson);
        multi.hdel(KEYS.processingStart, job.id);
        multi.hincrby(KEYS.stats, 'success', 1);
        await multi.exec();

        // Store the job result in a dedicated Redis key with 1-hour TTL
        // WHY TTL?
        //   Without TTL, results accumulate in Redis forever, eating memory.
        //   1 hour is enough time for the dashboard user to check results.
        //   In production, you might store results in a database instead.
        const resultKey = `${KEYS.jobResultPrefix}${job.id}`;
        await redis.set(resultKey, JSON.stringify({
          jobId: job.id,
          type: job.type,
          priority: job.priority,
          status: 'completed',
          result,
          duration: parseFloat(duration),
          completedAt: Date.now(),
        }), 'EX', 3600); // 1 hour TTL

        // Push a summary to job history (capped at 200 entries)
        // LPUSH adds to the front, so newest entries are first
        // LTRIM keeps only the first 200 entries, discarding the oldest
        const historySummary = {
          id: job.id,
          type: job.type,
          priority: job.priority,
          status: 'completed',
          duration: parseFloat(duration),
          createdAt: job.createdAt,
          completedAt: Date.now(),
        };
        await redis.lpush(KEYS.jobHistory, JSON.stringify(historySummary));
        await redis.ltrim(KEYS.jobHistory, 0, 199);

        console.log(`[Worker ${workerId}] ✓ Completed Job ${job.id.substring(0, 8)} in ${duration}s`);
        await publishLog('success', `Job #${job.id.substring(0, 8)} (${job.type}) finished successfully in ${duration}s.`);

      } catch (jobError: any) {
        // =============================================================
        // FAILURE & RETRY HANDLER
        // =============================================================
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.error(`[Worker ${workerId}] ✗ Job ${job.id.substring(0, 8)} failed (${duration}s):`, jobError.message);

        if (job.retryCount < job.maxRetries) {
          // =========================================================
          // RETRY WITH EXPONENTIAL BACKOFF
          // =========================================================
          // Instead of immediately re-queuing (V1 behavior), we compute
          // a delay that DOUBLES with each retry attempt:
          //
          //   Retry 1: retryDelayMs * 2^0 = 2000ms (2 seconds)
          //   Retry 2: retryDelayMs * 2^1 = 4000ms (4 seconds)
          //   Retry 3: retryDelayMs * 2^2 = 8000ms (8 seconds)
          //
          // WHY? If a downstream service is overloaded, hammering it
          // with instant retries makes the problem WORSE. Backing off
          // gives it time to recover.
          //
          // HOW? We push the job to queue:delayed (our sorted set)
          // with a future timestamp as the score. The delayed scanner
          // loop on the server will migrate it back to the waiting
          // queue when the time comes. ZERO new infrastructure needed.
          // =========================================================

          job.retryCount += 1;

          let retryDelay: number;
          if (job.retryStrategy === 'exponential') {
            retryDelay = job.retryDelayMs * Math.pow(2, job.retryCount - 1);
          } else {
            retryDelay = job.retryDelayMs; // Fixed delay
          }

          const updatedJob = { ...job, status: 'waiting' };
          const updatedJobJson = JSON.stringify(updatedJob);

          // Remove from processing, clear start time
          const multi = redis.multi();
          multi.lrem(KEYS.processing, 1, jobJson);
          multi.hdel(KEYS.processingStart, job.id);

          // Push to delayed queue with computed retry timestamp
          const executeAt = Date.now() + retryDelay;
          multi.zadd(KEYS.delayed, executeAt, updatedJobJson);

          await multi.exec();

          await publishLog(
            'warning',
            `Job #${job.id.substring(0, 8)} failed — retrying in ${(retryDelay / 1000).toFixed(1)}s (${job.retryCount}/${job.maxRetries}). Error: ${jobError.message}`
          );

        } else {
          // =========================================================
          // MAX RETRIES EXCEEDED → DEAD LETTER QUEUE
          // =========================================================
          // The job has failed too many times. We move it to the DLQ
          // where an admin can inspect it, fix the issue, and replay it.
          // =========================================================

          const multi = redis.multi();
          multi.lrem(KEYS.processing, 1, jobJson);
          multi.hdel(KEYS.processingStart, job.id);
          multi.lpush(KEYS.dlq, jobJson);
          multi.hincrby(KEYS.stats, 'failure', 1);
          await multi.exec();

          // Store the failure in job history
          const historySummary = {
            id: job.id,
            type: job.type,
            priority: job.priority,
            status: 'dlq',
            duration: parseFloat(duration),
            createdAt: job.createdAt,
            completedAt: Date.now(),
            error: jobError.message,
          };
          await redis.lpush(KEYS.jobHistory, JSON.stringify(historySummary));
          await redis.ltrim(KEYS.jobHistory, 0, 199);

          console.error(`[Worker ${workerId}] ☠ Job ${job.id.substring(0, 8)} failed after ${job.maxRetries} retries. Moved to DLQ.`);
          await publishLog(
            'error',
            `Job #${job.id.substring(0, 8)} (${job.type}) failed after ${job.maxRetries} retries. Moved to DLQ. Error: ${jobError.message}`
          );
        }
      }

    } catch (err: any) {
      console.error(`[Worker ${workerId}] Polling loop error:`, err);
      // Wait before retrying to prevent busy-looping if Redis is down
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // Cleanup on exit
  await publishLog('info', 'Worker shutting down.');
  redis.disconnect();
  console.log(`[-] Worker ${workerId} shut down completed.`);
}

// =============================================================================
// GRACEFUL SHUTDOWN
// =============================================================================
// When the process receives SIGINT (Ctrl+C) or SIGTERM (Docker stop),
// we set isRunning = false. The polling loop checks this flag every iteration
// and exits cleanly, allowing the current job to finish before shutting down.
//
// WITHOUT THIS: Killing the process mid-job would leave the job stuck in
// queue:processing. The reclaimer would eventually recover it, but graceful
// shutdown is much cleaner.
// =============================================================================

const shutdown = async () => {
  console.log(`\n[-] Initiating graceful shutdown for worker ${workerId}...`);
  isRunning = false;
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Launch worker
poll();
