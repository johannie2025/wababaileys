// src/workers/sendWorker.js — BullMQ Worker anti-ban
const { Worker } = require('bullmq');
const redis      = require('../utils/redisClient');
const wm         = require('../core/baileysManager');

const QUEUE = 'wise:send';

function initWorker() {
  const worker = new Worker(QUEUE, async job => {
    const { type, sessionId, to, ...opts } = job.data;
    switch (type) {
      case 'text':     return wm.sendText(sessionId, to, opts.text, opts);
      case 'media':    return wm.sendMedia(sessionId, to, Buffer.from(opts.buffer,'base64'), opts.mediaType, opts.caption, opts);
      case 'poll':     return wm.sendPoll(sessionId, to, opts.name, opts.values, opts.selectableCount);
      case 'location': return wm.sendLocation(sessionId, to, opts.lat, opts.lng, opts.name, opts.address);
      case 'reaction': return wm.sendReaction(sessionId, to, opts.messageId, opts.emoji);
      case 'contact':  return wm.sendContact(sessionId, to, opts.contacts);
      case 'buttons':  return wm.sendButtons(sessionId, to, opts.text, opts.buttons, opts.footer);
      default: throw new Error(`Type inconnu: ${type}`);
    }
  }, {
    connection: redis,
    concurrency: 4,
    limiter: { max: 20, duration: 60000 }
  });

  worker.on('completed', job => console.log(`✅ Job ${job.id} OK`));
  worker.on('failed', (job, err) => console.error(`❌ Job ${job?.id} FAIL:`, err.message));
  console.log('🔧 BullMQ Worker démarré');
  return worker;
}

module.exports = { initWorker, QUEUE };
