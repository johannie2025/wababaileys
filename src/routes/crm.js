// src/routes/crm.js
const router = require('express').Router();
const crm    = require('../services/crmService');

router.post('/:entityId/contacts',            async (req, res) => {
  try { res.json({ ok: true, contact: await crm.upsertContact(req.params.entityId, req.body) }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/:entityId/contacts',             async (req, res) => {
  try { res.json({ ok: true, contacts: await crm.listContacts(req.params.entityId, req.query) }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/:entityId/contacts/:phone',      async (req, res) => {
  try { res.json({ ok: true, contact: await crm.getContact(req.params.entityId, req.params.phone) }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/:entityId/contacts/:phone/tags', async (req, res) => {
  const { add = [], remove = [] } = req.body;
  try {
    if (add.length) await crm.addTags(req.params.entityId, req.params.phone, add);
    if (remove.length) await crm.removeTags(req.params.entityId, req.params.phone, remove);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/:entityId/contacts/:phone/stage', async (req, res) => {
  const { stage, note } = req.body;
  if (!stage) return res.status(400).json({ ok: false, error: 'stage requis' });
  try { res.json({ ok: true, contact: await crm.updatePipelineStage(req.params.entityId, req.params.phone, stage, note) }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/:entityId/contacts/:phone/messages', async (req, res) => {
  try { res.json({ ok: true, messages: await crm.getMessages(req.params.entityId, req.params.phone, +req.query.limit || 50) }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/:entityId/contacts/:contactId/notes', async (req, res) => {
  const { userId, text } = req.body;
  if (!text) return res.status(400).json({ ok: false, error: 'text requis' });
  try { res.json({ ok: true, note: await crm.addNote(req.params.contactId, userId, text) }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/:entityId/pipeline/stats',       async (req, res) => {
  try { res.json({ ok: true, stats: await crm.getPipelineStats(req.params.entityId) }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

module.exports = router;
