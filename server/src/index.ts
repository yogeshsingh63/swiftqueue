// =============================================================================
// EXPRESS SERVER + WEBSOCKET BROKER (V2)
// =============================================================================
// This is the main entry point for the SwiftQueue server. It does 3 things:
//
// 1. REST API: Accepts job enqueue requests from external applications
// 2. WebSocket Server: Streams real-time stats, logs, and progress to dashboards
// 3. Background Loops: Runs the delayed scanner and job reclaimer
//
// The server does NOT execute jobs — that's the worker's responsibility.
// The server is the "control plane"; workers are the "data plane".
// =============================================================================

import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import Redis from 'ioredis';
import dotenv from 'dotenv';
import jobRouter from './routes/jobs';
import { redis } from './config/redis';
import { startDelayedJobsScanner, startJobReclaimer, KEYS } from './queue/producer';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/jobs', jobRouter);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server });

// =============================================================================
// REDIS PUB/SUB SUBSCRIBERS
// =============================================================================
// We need SEPARATE Redis connections for subscribing. Why?
//
// When you call redis.subscribe(), that connection enters "subscriber mode".
// In subscriber mode, the connection can ONLY run subscribe/unsubscribe commands.
// Any other command (GET, SET, LLEN, etc.) will throw an error.
//
// So we create dedicated subscriber clients — one for logs, one for progress.
// The main `redis` client (from config/redis.ts) stays free for normal commands.
// =============================================================================

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

// Subscriber for job log events (queue:events channel)
const redisLogSubscriber = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

// Subscriber for job progress events (queue:progress channel)
const redisProgressSubscriber = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

// Connect and subscribe
async function setupSubscribers() {
  // Log events subscriber
  await redisLogSubscriber.connect();
  await redisLogSubscriber.subscribe('queue:events');
  console.log('Subscribed to queue:events channel.');

  // Progress events subscriber
  await redisProgressSubscriber.connect();
  await redisProgressSubscriber.subscribe('queue:progress');
  console.log('Subscribed to queue:progress channel.');
}

// =============================================================================
// WEBSOCKET BROADCAST
// =============================================================================
// Helper that sends a JSON payload to ALL connected WebSocket clients.
// The dashboard opens a WebSocket connection and receives these messages.
// =============================================================================

const broadcast = (data: any) => {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
};

// Forward log events from Redis Pub/Sub to WebSocket clients
redisLogSubscriber.on('message', (channel, message) => {
  if (channel === 'queue:events') {
    try {
      const parsedEvent = JSON.parse(message);
      broadcast({ type: 'log', data: parsedEvent });
    } catch (e) {
      console.error('Error parsing log event:', e);
    }
  }
});

// Forward progress events from Redis Pub/Sub to WebSocket clients
redisProgressSubscriber.on('message', (channel, message) => {
  if (channel === 'queue:progress') {
    try {
      const parsedEvent = JSON.parse(message);
      broadcast({ type: 'progress', data: parsedEvent });
    } catch (e) {
      console.error('Error parsing progress event:', e);
    }
  }
});

// =============================================================================
// REAL-TIME METRICS ENGINE
// =============================================================================
// Polls Redis every 1000ms and broadcasts a snapshot of queue sizes to
// all connected dashboard clients.
//
// WHY POLL INSTEAD OF SUBSCRIBE?
//   Queue sizes (LLEN, ZCARD) are derived values — there's no Pub/Sub event
//   when a list length changes. We have to ask Redis "how long is this list?"
//   periodically. 1 second is a good balance between freshness and load.
//
// OPTIMIZATION: We only poll if there are active WebSocket clients.
//   If nobody's watching the dashboard, we skip the poll entirely.
// =============================================================================

const startMetricsEngine = () => {
  setInterval(async () => {
    if (wss.clients.size === 0) return;

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
      if (!results) return;

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

      broadcast({
        type: 'stats',
        data: {
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
        }
      });
    } catch (error) {
      console.error('Error in WS metrics engine polling:', error);
    }
  }, 1000);
};

// =============================================================================
// WEBSOCKET CONNECTION HANDLER
// =============================================================================

wss.on('connection', (ws) => {
  console.log(`[WebSocket] Dashboard client connected. Total clients: ${wss.clients.size}`);

  // Send initial stats snapshot immediately on connection
  const sendInitialStats = async () => {
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
      if (!results) return;

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

      ws.send(JSON.stringify({
        type: 'stats',
        data: {
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
        }
      }));
    } catch (e) {
      console.error('Error sending initial stats to client:', e);
    }
  };

  sendInitialStats();

  ws.on('close', () => {
    console.log(`[WebSocket] Dashboard client disconnected. Total clients: ${wss.clients.size}`);
  });
});

// =============================================================================
// START SERVER
// =============================================================================

server.listen(port, async () => {
  console.log(`========================================`);
  console.log(`🚀 SwiftQueue V2 server running on port ${port}`);
  console.log(`========================================`);

  // Set up Redis Pub/Sub subscribers
  await setupSubscribers();

  // Start background loops
  startDelayedJobsScanner();
  startJobReclaimer();
  startMetricsEngine();
});
