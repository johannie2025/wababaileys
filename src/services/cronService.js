// src/services/cronService.js — Scheduled jobs
const cron    = require('node-cron');
const chatbot = require('./chatbotService');
const wm      = require('../core/baileysManager');
const https   = require('https');

function initCronJobs() {

  // ── Follow-up relances (toutes les 2 min) ─────────────────────────────────
  cron.schedule('*/2 * * * *', async () => {
    const supabase = require('../utils/supabaseClient');
    const { data: entities } = await supabase.from('entities').select('id, session_id');
    if (!entities) return;

    const pending = await chatbot.getPendingFollowUps();
    for (const fu of pending) {
      try {
        const entity = entities.find(e => e.id === fu.entity_id);
        if (!entity?.session_id) continue;
        await wm.sendText(entity.session_id, `${fu.phone}@s.whatsapp.net`, fu.message);
        await chatbot.markFollowUpSent(fu.id);
        console.log(`📤 Follow-up envoyé → ${fu.phone}`);
      } catch (err) {
        console.error('[Cron] follow-up error:', err.message);
      }
    }
  });

  // ── Anti-sleep Render (toutes les 14 min) ─────────────────────────────────
  if (process.env.SELF_URL) {
    cron.schedule('*/14 * * * *', () => {
      https.get(`${process.env.SELF_URL}/health`, res => {
        if (res.statusCode !== 200)
          console.warn('[KeepAlive] ping non-200:', res.statusCode);
      }).on('error', err => console.warn('[KeepAlive]', err.message));
    });
  }

  // ── Session health check (toutes les 30 min) ──────────────────────────────
  cron.schedule('*/30 * * * *', async () => {
    const supabase = require('../utils/supabaseClient');
    const { data: entities } = await supabase
      .from('entities').select('id, session_id').eq('active', true);
    if (!entities) return;
    for (const e of entities) {
      const status = wm.getStatus(e.session_id);
      if (!status.connected) {
        console.log(`🔄 Auto-reconnect session: ${e.session_id}`);
        wm.getInstance(e.session_id).catch(() => {});
      }
    }
  });

  console.log('⏰ Cron jobs initialisés');
}

module.exports = { initCronJobs };
