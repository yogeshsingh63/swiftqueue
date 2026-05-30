import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

console.log(`Worker connecting to Redis at ${REDIS_HOST}:${REDIS_PORT}...`);

export const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  maxRetriesPerRequest: null,
});

redis.on('connect', () => {
  console.log('Worker Redis client connected successfully.');
});

redis.on('error', (err) => {
  console.error('Worker Redis client error:', err);
});
