import { Router, Request, Response } from 'express';
import { enqueue, KEYS } from '../queue/producer';
import { redis } from '../config/redis';

const router = Router();

// Helper to construct payloads based on job type
const getJobPayload = (type: string) => {
  switch (type) {
    case 'email':
      return { to: 'user@example.com', subject: 'Welcome to SwiftQueue!', template: 'welcome_email' };
    case 'report':
      return { reportId: Math.floor(Math.random() * 10000), format: 'PDF', includeCharts: true };
    case 'image':
      return { imageUrl: 'https://example.com/assets/avatar.png', resizeWidth: 800, format: 'webp' };
    default:
      return { randomData: Math.random().toString(36).substring(7) };
  }
};

/**
 * POST /api/jobs - Enqueue a single job
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { type, delayMs, forceFail } = req.body;

    if (!type || !['email', 'report', 'image'].includes(type)) {
      return res.status(400).json({ error: 'Invalid job type. Must be: email, report, or image.' });
    }

    const payload = getJobPayload(type);
    const job = await enqueue(type, payload, delayMs || 0, !!forceFail);

    return res.status(201).json({ message: 'Job enqueued successfully', job });
  } catch (error: any) {
    console.error('Error enqueuing job:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

/**
 * POST /api/jobs/bulk - Enqueue multiple jobs in bulk (e.g. for testing)
 */
router.post('/bulk', async (req: Request, res: Response) => {
  try {
    const { count, type, delayMs, forceFail } = req.body;
    const jobCount = parseInt(count, 10) || 1;

    if (jobCount <= 0 || jobCount > 100) {
      return res.status(400).json({ error: 'Count must be between 1 and 100.' });
    }

    const jobs = [];
    const types: ('email' | 'report' | 'image')[] = ['email', 'report', 'image'];

    for (let i = 0; i < jobCount; i++) {
      const selectedType = type && types.includes(type) ? type : types[Math.floor(Math.random() * types.length)];
      const payload = getJobPayload(selectedType);
      const job = await enqueue(selectedType, payload, delayMs || 0, !!forceFail);
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

/**
 * GET /api/stats - Retrieve current queue sizes and processed statistics
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const pipeline = redis.pipeline();
    pipeline.llen(KEYS.waiting);
    pipeline.llen(KEYS.processing);
    pipeline.zcard(KEYS.delayed);
    pipeline.llen(KEYS.dlq);
    pipeline.hgetall(KEYS.stats);

    const results = await pipeline.exec();

    if (!results) {
      return res.status(500).json({ error: 'Failed to fetch statistics.' });
    }

    const [
      [errWaiting, waitingLen],
      [errProcessing, processingLen],
      [errDelayed, delayedLen],
      [errDlq, dlqLen],
      [errStats, rawStats]
    ] = results;

    if (errWaiting || errProcessing || errDelayed || errDlq || errStats) {
      throw new Error('Pipeline error fetching stats');
    }

    const stats = rawStats as Record<string, string>;

    return res.json({
      waiting: waitingLen || 0,
      processing: processingLen || 0,
      delayed: delayedLen || 0,
      dlq: dlqLen || 0,
      stats: {
        success: parseInt(stats.success || '0', 10),
        failure: parseInt(stats.failure || '0', 10),
        enqueued: parseInt(stats.enqueued || '0', 10),
      }
    });
  } catch (error: any) {
    console.error('Error getting stats:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

/**
 * POST /api/jobs/dlq/replay - Replay all jobs currently in the DLQ
 */
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
      multi.lpush(KEYS.waiting, JSON.stringify(job));
    }
    // Delete the DLQ list
    multi.del(KEYS.dlq);

    await multi.exec();

    // Publish event
    const event = {
      timestamp: Date.now(),
      level: 'info',
      message: `Replayed ${dlqJobs.length} jobs from DLQ back to Waiting queue.`,
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

/**
 * DELETE /api/jobs/dlq/clear - Clear all jobs in the DLQ
 */
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
