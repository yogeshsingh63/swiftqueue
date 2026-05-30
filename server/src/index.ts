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

// Set up a dedicated subscriber client for Redis Pub/Sub
const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

const redisSubscriber = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  maxRetriesPerRequest: null,
});

redisSubscriber.on('ready', () => {
  console.log('Redis subscriber client ready.');
  redisSubscriber.subscribe('queue:events', (err) => {
    if (err) {
      console.error('Failed to subscribe to queue:events:', err);
    } else {
      console.log('Subscribed to queue:events channel.');
    }
  });
});

// Broadcast helper for WS
const broadcast = (data: any) => {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
};

// Listen to Redis Pub/Sub events and stream them to WS clients
redisSubscriber.on('message', (channel, message) => {
  if (channel === 'queue:events') {
    try {
      const parsedEvent = JSON.parse(message);
      broadcast({ type: 'log', data: parsedEvent });
    } catch (e) {
      console.error('Error parsing Redis Pub/Sub event:', e);
    }
  }
});

// Real-time Metrics Engine: Poll Redis stats every 1000ms
const startMetricsEngine = () => {
  setInterval(async () => {
    if (wss.clients.size === 0) return; // Only poll if there are active dashboard sessions

    try {
      const pipeline = redis.pipeline();
      pipeline.llen(KEYS.waiting);
      pipeline.llen(KEYS.processing);
      pipeline.zcard(KEYS.delayed);
      pipeline.llen(KEYS.dlq);
      pipeline.hgetall(KEYS.stats);

      const results = await pipeline.exec();
      if (!results) return;

      const [
        [errWaiting, waitingLen],
        [errProcessing, processingLen],
        [errDelayed, delayedLen],
        [errDlq, dlqLen],
        [errStats, rawStats]
      ] = results;

      if (errWaiting || errProcessing || errDelayed || errDlq || errStats) {
        throw new Error('Pipeline error');
      }

      const stats = rawStats as Record<string, string>;

      broadcast({
        type: 'stats',
        data: {
          waiting: waitingLen || 0,
          processing: processingLen || 0,
          delayed: delayedLen || 0,
          dlq: dlqLen || 0,
          stats: {
            success: parseInt(stats.success || '0', 10),
            failure: parseInt(stats.failure || '0', 10),
            enqueued: parseInt(stats.enqueued || '0', 10),
          }
        }
      });
    } catch (error) {
      console.error('Error in WS metrics engine polling:', error);
    }
  }, 1000);
};

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log(`[WebSocket] Dashboard client connected. Total clients: ${wss.clients.size}`);
  
  // Immediately send initial stats upon connection
  const sendInitialStats = async () => {
    try {
      const pipeline = redis.pipeline();
      pipeline.llen(KEYS.waiting);
      pipeline.llen(KEYS.processing);
      pipeline.zcard(KEYS.delayed);
      pipeline.llen(KEYS.dlq);
      pipeline.hgetall(KEYS.stats);

      const results = await pipeline.exec();
      if (!results) return;

      const [
        [, waitingLen],
        [, processingLen],
        [, delayedLen],
        [, dlqLen],
        [, rawStats]
      ] = results;

      const stats = rawStats as Record<string, string>;

      ws.send(JSON.stringify({
        type: 'stats',
        data: {
          waiting: waitingLen || 0,
          processing: processingLen || 0,
          delayed: delayedLen || 0,
          dlq: dlqLen || 0,
          stats: {
            success: parseInt(stats.success || '0', 10),
            failure: parseInt(stats.failure || '0', 10),
            enqueued: parseInt(stats.enqueued || '0', 10),
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

// Start server
server.listen(port, () => {
  console.log(`========================================`);
  console.log(`🚀 SwiftQueue server running on port ${port}`);
  console.log(`========================================`);
  
  // Start scanner routines
  startDelayedJobsScanner();
  startJobReclaimer();
  startMetricsEngine();
});
