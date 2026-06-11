// src/core/antiBan.js — Anti-Ban Industriel v2
const redis = require('../utils/redisClient');

class AntiBan {
  // Distribution gaussienne pour délais réalistes
  _gaussian(mean, std) {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  _delay(ms) {
    return new Promise(r => setTimeout(r, Math.max(300, Math.floor(ms))));
  }

  // Délai de frappe adaptatif selon longueur message
  _typingDelay(len = 0) {
    const base = len > 120 ? 2800 : len > 60 ? 2100 : len > 25 ? 1500 : 900;
    return Math.min(Math.max(this._gaussian(base, base * 0.4), 700), 7200);
  }

  // Simulation comportement humain complet
  async simulateHuman(sock, jid, message = '') {
    try {
      await sock.readMessages([{ remoteJid: jid, fromMe: false }]).catch(() => {});
      await sock.sendPresenceUpdate('available', jid);
      await this._delay(this._gaussian(450, 200));
      await sock.sendPresenceUpdate('composing', jid);
      await this._delay(this._typingDelay(String(message).length));
      await sock.sendPresenceUpdate('paused', jid);
      await this._delay(this._gaussian(300, 200));
    } catch { /* fail-safe silencieux */ }
  }

  // Rate limit par destinataire (10/min)
  async checkContactLimit(sessionId, jid, max = 10) {
    const key = `wise:rl:contact:${sessionId}:${jid}`;
    const now = Date.now();
    try {
      const pipe = redis.multi();
      pipe.zremrangebyscore(key, 0, now - 60000);
      pipe.zcard(key);
      const [[, cnt]] = (await pipe.exec()).slice(-1);
      if (cnt >= max) return false;
      await redis.multi().zadd(key, now, now.toString()).expire(key, 65).exec();
      return true;
    } catch { return true; }
  }

  // Rate limit global par session (25/min)
  async checkGlobalLimit(sessionId, max = 25) {
    const key = `wise:rl:global:${sessionId}`;
    const now = Date.now();
    try {
      const pipe = redis.multi();
      pipe.zremrangebyscore(key, 0, now - 60000);
      pipe.zcard(key);
      const [[, cnt]] = (await pipe.exec()).slice(-1);
      if (cnt >= max) return false;
      await redis.multi().zadd(key, now, now.toString()).expire(key, 65).exec();
      return true;
    } catch { return true; }
  }

  // Vérification combinée
  async canSend(sessionId, jid) {
    const contact = await this.checkContactLimit(sessionId, jid);
    const global  = await this.checkGlobalLimit(sessionId);
    return { ok: contact && global, contact, global };
  }
}

module.exports = new AntiBan();
