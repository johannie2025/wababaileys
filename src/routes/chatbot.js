// src/routes/chatbot.js
const router  = require('express').Router();
const supabase = require('../utils/supabaseClient');
const chatbot  = require('../services/chatbotService');

// GET config d'une entité
router.get('/:entityId/config', async (req, res) => {
  try {
    const { data } = await supabase.from('chatbot_configs').select('*')
      .eq('entity_id', req.params.entityId).maybeSingle();
    res.json({ ok: true, config: data });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// PUT config complète (keywords, prompt IA, default_reply)
router.put('/:entityId/config', async (req, res) => {
  const { keywords, ai_enabled, ai_system_prompt, default_reply, active } = req.body;
  try {
    const { data } = await supabase.from('chatbot_configs').upsert({
      entity_id: req.params.entityId,
      keywords: keywords || [],
      ai_enabled: !!ai_enabled,
      ai_system_prompt: ai_system_prompt || '',
      default_reply: default_reply || '',
      active: active !== false,
      updated_at: new Date().toISOString()
    }, { onConflict: 'entity_id' }).select().single();
    res.json({ ok: true, config: data });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST test manuel d'un message
router.post('/:entityId/test', async (req, res) => {
  const { sessionId, from, text } = req.body;
  if (!from || !text) return res.status(400).json({ ok: false, error: 'from + text requis' });
  try {
    const resp = await chatbot.process(sessionId || 'test', req.params.entityId, { from, text, pushName: 'Test' });
    res.json({ ok: true, response: resp });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST programmer une relance
router.post('/:entityId/followup', async (req, res) => {
  const { phone, message, sendAt } = req.body;
  if (!phone || !message || !sendAt)
    return res.status(400).json({ ok: false, error: 'phone, message, sendAt requis' });
  try {
    const fu = await chatbot.scheduleFollowUp(req.params.entityId, phone, message, sendAt);
    res.json({ ok: true, followup: fu });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// GET interactions / stats
router.get('/:entityId/interactions', async (req, res) => {
  try {
    const { data } = await supabase.from('chatbot_interactions')
      .select('*').eq('entity_id', req.params.entityId)
      .order('timestamp', { ascending: false })
      .limit(+req.query.limit || 100);
    res.json({ ok: true, interactions: data });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

module.exports = router;
