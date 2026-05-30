import { redis } from './config/redis';
import { processJob, JobPayload } from './processor';
import crypto from 'crypto';

// Unique ID for this worker process
const workerId = crypto.randomBytes(4).toString('hex');

// Queue Keys
const KEYS = {
  waiting: 'queue:waiting',
  processing: 'queue:processing',
  stats: 'queue:stats',
  dlq: 'queue:dlq',
  processingStart: 'queue:processing_start',
};

let isRunning = true;

/**
 * Publish log event to Redis Pub/Sub
 */
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

/**
 * Main polling and execution loop
 */
async function poll() {
  console.log(`[*] Worker ${workerId} active and polling for jobs...`);
  await publishLog('info', 'Worker activated.');

  while (isRunning) {
    let jobJson: string | null = null;

    try {
      // BRPOPLPUSH queue:waiting queue:processing 1
      // Blocks for up to 1 second waiting for a job
      jobJson = await redis.brpoplpush(KEYS.waiting, KEYS.processing, 1);

      if (!jobJson) {
        // Timeout expired, no jobs, continue polling
        continue;
      }

      // Parse the job
      const job: JobPayload = JSON.parse(jobJson);
      const startTime = Date.now();

      // Record the processing start timestamp in Redis Hash
      await redis.hset(KEYS.processingStart, job.id, startTime.toString());

      // Log start
      console.log(`[Worker ${workerId}] Pulled Job ${job.id} (Type: ${job.type})`);
      await publishLog('info', `Started Job #${job.id.substring(0, 8)} (${job.type}).`);

      try {
        // Execute the job
        await processJob(job, workerId);

        // --- SUCCESS HANDLER ---
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        
        // Remove from queue:processing, clear processing start timestamp, increment success counter
        const multi = redis.multi();
        multi.lrem(KEYS.processing, 1, jobJson);
        multi.hdel(KEYS.processingStart, job.id);
        multi.hincrby(KEYS.stats, 'success', 1);
        await multi.exec();

        console.log(`[Worker ${workerId}] Completed Job ${job.id} in ${duration}s`);
        await publishLog('success', `Job #${job.id.substring(0, 8)} finished successfully in ${duration}s.`);

      } catch (jobError: any) {
        // --- FAILURE & RETRY HANDLER ---
        console.error(`[Worker ${workerId}] Job ${job.id} failed:`, jobError.message);
        
        if (job.retryCount < job.maxRetries) {
          // Increment retry count
          job.retryCount += 1;
          const updatedJobJson = JSON.stringify(job);

          // Atomic move back to queue:waiting
          const multi = redis.multi();
          multi.lrem(KEYS.processing, 1, jobJson);
          multi.hdel(KEYS.processingStart, job.id);
          multi.lpush(KEYS.waiting, updatedJobJson);
          await multi.exec();

          await publishLog(
            'warning',
            `Job #${job.id.substring(0, 8)} failed - retrying (${job.retryCount}/${job.maxRetries}). Error: ${jobError.message}`
          );
        } else {
          // Max retries reached, move to DLQ
          const multi = redis.multi();
          multi.lrem(KEYS.processing, 1, jobJson);
          multi.hdel(KEYS.processingStart, job.id);
          multi.lpush(KEYS.dlq, jobJson);
          multi.hincrby(KEYS.stats, 'failure', 1);
          await multi.exec();

          console.error(`[Worker ${workerId}] Job ${job.id} failed after max retries. Moved to DLQ.`);
          await publishLog(
            'error',
            `Job #${job.id.substring(0, 8)} failed after ${job.maxRetries} retries. Moved to DLQ.`
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

// Graceful shutdown registration
const shutdown = async () => {
  console.log(`\n[-] Initiating graceful shutdown for worker ${workerId}...`);
  isRunning = false;
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Launch worker
poll();
