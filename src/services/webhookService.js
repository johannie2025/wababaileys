// src/services/webhookService.js — Wise OS Webhook Dispatcher
const supabase  = require('../utils/supabaseClient');
const axios     = require('axios');
const crm       = require('./crmService');
const chatbot   = require('./chatbotService');
const wm        = require('../core/baileysManager');

class WebhookService {
  constructor() {
    // Register global listener on BaileysManager
    wm.onWebhook('*', this.dispatch.bind(this));
  }

  // ─── Main dispatcher ───────────────────────────────────────────────────────
  async dispatch(payload) {
    const { sessionId, event, data } = payload;
    try {
      // 1. Get session entity config
      const entity = await this._getEntity(sessionId);
      if (!entity) return;

      if (event === 'message') {
        await this._handleIncoming(sessionId, entity, data);
      }

      // 2. Forward to PHP webhook URL if configured
      if (entity.webhook_url) {
        this._forwardToPhp(entity.webhook_url, payload).catch(() => {});
      }
    } catch (err) {
      console.error('[Webhook] dispatch error:', err.message);
    }
  }

  // ─── Handle incoming message ───────────────────────────────────────────────
  async _handleIncoming(sessionId, entity, msg) {
    if (!msg.text && !msg.caption && msg.type === 'protocol') return;

    const entityId = entity.id;
    const phone    = msg.from?.split('@')[0];

    // Log to CRM
    await crm.logMessage(entityId, phone, 'in',
      msg.text || msg.caption || `[${msg.type}]`, msg.type).catch(() => {});

    // Upsert contact
    await crm.upsertContact(entityId, {
      phone, jid: msg.from, name: msg.pushName || ''
    }).catch(() => {});

    // Chatbot processing
    const response = await chatbot.process(sessionId, entityId, msg);
    if (!response) return;

    // Send chatbot response
    await this._sendResponse(sessionId, entity, msg, response);

    // Log outgoing
    const outText = response.text || response.name || '[media]';
    await crm.logMessage(entityId, phone, 'out', outText, response.type).catch(() => {});
  }

  // ─── Send response based on type ──────────────────────────────────────────
  async _sendResponse(sessionId, entity, msg, response) {
    const to = msg.from;
    try {
      switch (response.type) {
        case 'text':
          await wm.sendText(sessionId, to, response.text);
          break;
        case 'buttons':
          await wm.sendButtons(sessionId, to, response.text, response.buttons, response.footer);
          break;
        case 'list':
          await wm.sendList(sessionId, to, response.title, response.text, response.buttonText, response.sections);
          break;
        case 'poll':
          await wm.sendPoll(sessionId, to, response.name, response.values, response.selectableCount);
          break;
        case 'media':
          if (response.mediaUrl) {
            const axios = require('axios');
            const r = await axios.get(response.mediaUrl, { responseType: 'arraybuffer' });
            await wm.sendMedia(sessionId, to, Buffer.from(r.data), response.mediaType, response.caption);
          }
          break;
        case 'payment_link':
          await wm.sendText(sessionId, to, response.text);
          break;
      }
    } catch (err) {
      console.error('[Webhook] sendResponse error:', err.message);
    }
  }

  // ─── Get entity by sessionId ───────────────────────────────────────────────
  async _getEntity(sessionId) {
    const { data } = await supabase
      .from('entities')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle();
    return data;
  }

  // ─── Forward to PHP callback URL ───────────────────────────────────────────
  async _forwardToPhp(url, payload) {
    await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.NODE_API_KEY
      },
      timeout: 5000
    });
  }
}

module.exports = new WebhookService();
