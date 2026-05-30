import { redis } from '../config/redis';
import { v4 as uuidv4 } from 'uuid';

export interface Job {
  id: string;
  type: 'email' | 'report' | 'image';
  payload: any;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  forceFail?: boolean;
}

// Queue Keys
export const KEYS = {
  waiting: 'queue:waiting',
  processing: 'queue:processing',
  delayed: 'queue:delayed',
  dlq: 'queue:dlq',
  stats: 'queue:stats',
  processingStart: 'queue:processing_start',
};

/**
 * Enqueue a job into the queue
 */
export async function enqueue(
  type: 'email' | 'report' | 'image',
  payload: any,
  delayMs: number = 0,
  forceFail: boolean = false
): Promise<Job> {
  const job: Job = {
    id: uuidv4(),
    type,
    payload,
    retryCount: 0,
    maxRetries: 3,
    createdAt: Date.now(),
    forceFail,
  };

  const jobJson = JSON.stringify(job);

  // Increment total enqueued count in stats
  await redis.hincrby(KEYS.stats, 'enqueued', 1);

  if (delayMs > 0) {
    const executeAt = Date.now() + delayMs;
    // ZADD queue:delayed <timestamp> <job_json>
    await redis.zadd(KEYS.delayed, executeAt, jobJson);
    console.log(`[Producer] Enqueued DELAYED job ${job.id} (type: ${type}) to execute in ${delayMs}ms`);
  } else {
    // LPUSH queue:waiting <job_json>
    await redis.lpush(KEYS.waiting, jobJson);
    console.log(`[Producer] Enqueued INSTANT job ${job.id} (type: ${type})`);
  }

  // Publish log event for dashboard stream
  const event = {
    timestamp: Date.now(),
    level: 'info',
    message: `Job #${job.id.substring(0, 8)} (${type}) enqueued${delayMs > 0 ? ` (delayed ${delayMs / 1000}s)` : ''}.`,
  };
  await redis.publish('queue:events', JSON.stringify(event));

  return job;
}

/**
 * Periodically scans queue:delayed, and atomic-migrates expired jobs to queue:waiting
 */
export function startDelayedJobsScanner() {
  setInterval(async () => {
    try {
      // Use WATCH to achieve atomicity
      await redis.watch(KEYS.delayed);
      
      const now = Date.now();
      // Get all jobs where score (timestamp) <= now
      const expiredJobs = await redis.zrangebyscore(KEYS.delayed, 0, now);

      if (expiredJobs.length === 0) {
        await redis.unwatch();
        return;
      }

      const multi = redis.multi();
      // Remove the jobs from delayed ZSET
      multi.zremrangebyscore(KEYS.delayed, 0, now);
      // Push each to the waiting list
      for (const jobJson of expiredJobs) {
        multi.lpush(KEYS.waiting, jobJson);
      }

      const execResult = await multi.exec();
      if (execResult === null) {
        // WATCH failed, transaction aborted due to concurrent modification. It'll retry in next tick.
        console.log('[Producer] Delayed jobs migration aborted (concurrent modification). Retrying soon...');
      } else {
        console.log(`[Producer] Migrated ${expiredJobs.length} delayed jobs to waiting queue.`);
        for (const jobJson of expiredJobs) {
          const job: Job = JSON.parse(jobJson);
          const event = {
            timestamp: Date.now(),
            level: 'info',
            message: `Delayed job #${job.id.substring(0, 8)} (${job.type}) is now active.`,
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

/**
 * Periodically monitors queue:processing to reclaim jobs from crashed workers
 */
export function startJobReclaimer() {
  setInterval(async () => {
    try {
      // Fetch all jobs in queue:processing
      const processingJobs = await redis.lrange(KEYS.processing, 0, -1);
      if (processingJobs.length === 0) return;

      const now = Date.now();
      const reclaimThresholdMs = 15000; // 15 seconds max execution time

      for (const jobJson of processingJobs) {
        const job: Job = JSON.parse(jobJson);
        
        // Fetch start time from hash
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
          // If no start time exists, checking if it was popped long ago
          // Use createdAt as fallback with a longer grace period
          if (now - job.createdAt > reclaimThresholdMs + 5000) {
            shouldReclaim = true;
            reason = 'worker stalled before starting execution';
          }
        }

        if (shouldReclaim) {
          console.warn(`[Reclaimer] Job ${job.id} detected as stalled (${reason}). Reclaiming...`);

          // Start multi transaction to remove from processing and handle retry
          const multi = redis.multi();
          multi.lrem(KEYS.processing, 1, jobJson);
          multi.hdel(KEYS.processingStart, job.id);

          if (job.retryCount < job.maxRetries) {
            job.retryCount += 1;
            const updatedJobJson = JSON.stringify(job);
            multi.lpush(KEYS.waiting, updatedJobJson);
            
            await multi.exec();

            const event = {
              timestamp: Date.now(),
              level: 'warning',
              message: `Job #${job.id.substring(0, 8)} (${job.type}) stalled. Reclaiming & retrying (${job.retryCount}/${job.maxRetries}).`,
            };
            await redis.publish('queue:events', JSON.stringify(event));
            console.log(`[Reclaimer] Job ${job.id} put back in waiting queue. Retry count: ${job.retryCount}`);
          } else {
            multi.lpush(KEYS.dlq, jobJson);
            multi.hincrby(KEYS.stats, 'failure', 1);
            
            await multi.exec();

            const event = {
              timestamp: Date.now(),
              level: 'error',
              message: `Job #${job.id.substring(0, 8)} (${job.type}) failed after max retries. Moved to DLQ.`,
            };
            await redis.publish('queue:events', JSON.stringify(event));
            console.error(`[Reclaimer] Job ${job.id} exceeded max retries. Moved to DLQ.`);
          }
        }
      }
    } catch (error) {
      console.error('[Reclaimer] Error in job reclaimer:', error);
    }
  }, 5000);
}
