// src/utils/redisClient.js
const Redis = require('ioredis');

const redis = new Redis(process.env.UPSTASH_REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  tls: process.env.UPSTASH_REDIS_URL?.startsWith('rediss://') ? {} : undefined,
  reconnectOnError: err => err.message.includes('ECONNRESET')
});

redis.on('connect', () => console.log('✅ Redis connecté'));
redis.on('error', err => console.error('❌ Redis error:', err.message));

module.exports = redis;
