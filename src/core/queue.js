// src/core/queue.js
const { Queue } = require('bullmq');
const redis = require('../utils/redisClient');
const { QUEUE } = require('../workers/sendWorker');

const sendQueue = new Queue(QUEUE, {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 100,
    removeOnFail: 200
  }
});

async function pushSend(data, opts = {}) {
  return sendQueue.add('send', data, {
    delay: opts.delay || 0,
    priority: opts.priority || 10
  });
}

module.exports = { sendQueue, pushSend };
