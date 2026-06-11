// src/routes/messages.js
const router = require('express').Router();
const wm     = require('../core/baileysManager');
const { pushSend } = require('../core/queue');

// POST /api/messages/:session/text
router.post('/:session/text', async (req, res) => {
  const { to, text, quotedId, linkPreview, queue } = req.body;
  if (!to || !text) return res.status(400).json({ ok: false, error: 'to + text requis' });
  try {
    if (queue) {
      const job = await pushSend({ type: 'text', sessionId: req.params.session, to, text, quotedId });
      return res.json({ ok: true, queued: true, jobId: job.id });
    }
    const result = await wm.sendText(req.params.session, to, text, { quotedId, linkPreview });
    res.json(result);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/messages/:session/poll
router.post('/:session/poll', async (req, res) => {
  const { to, name, values, selectableCount } = req.body;
  if (!to || !name || !values?.length)
    return res.status(400).json({ ok: false, error: 'to, name, values requis' });
  try {
    const result = await wm.sendPoll(req.params.session, to, name, values, selectableCount);
    res.json(result);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/messages/:session/reaction
router.post('/:session/reaction', async (req, res) => {
  const { to, messageId, emoji } = req.body;
  if (!to || !messageId || !emoji)
    return res.status(400).json({ ok: false, error: 'to, messageId, emoji requis' });
  try {
    const result = await wm.sendReaction(req.params.session, to, messageId, emoji);
    res.json(result);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/messages/:session/location
router.post('/:session/location', async (req, res) => {
  const { to, lat, lng, name, address } = req.body;
  if (!to || !lat || !lng)
    return res.status(400).json({ ok: false, error: 'to, lat, lng requis' });
  try {
    const result = await wm.sendLocation(req.params.session, to, lat, lng, name, address);
    res.json(result);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/messages/:session/contact
router.post('/:session/contact', async (req, res) => {
  const { to, contacts } = req.body;
  if (!to || !contacts?.length)
    return res.status(400).json({ ok: false, error: 'to + contacts[] requis' });
  try {
    const result = await wm.sendContact(req.params.session, to, contacts);
    res.json(result);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/messages/:session/buttons
router.post('/:session/buttons', async (req, res) => {
  const { to, text, buttons, footer } = req.body;
  if (!to || !text || !buttons?.length)
    return res.status(400).json({ ok: false, error: 'to, text, buttons[] requis' });
  try {
    const result = await wm.sendButtons(req.params.session, to, text, buttons, footer);
    res.json(result);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/messages/:session/list
router.post('/:session/list', async (req, res) => {
  const { to, title, text, buttonText, sections } = req.body;
  if (!to || !text || !sections?.length)
    return res.status(400).json({ ok: false, error: 'to, text, sections[] requis' });
  try {
    const result = await wm.sendList(req.params.session, to, title, text, buttonText, sections);
    res.json(result);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/messages/:session/read
router.post('/:session/read', async (req, res) => {
  const { jid, messageIds } = req.body;
  if (!jid || !messageIds?.length)
    return res.status(400).json({ ok: false, error: 'jid + messageIds[] requis' });
  try {
    const result = await wm.markAsRead(req.params.session, jid, messageIds);
    res.json(result);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/messages/:session/bulk — envoi groupé en queue
router.post('/:session/bulk', async (req, res) => {
  const { messages } = req.body; // [{ to, text, delay }]
  if (!messages?.length)
    return res.status(400).json({ ok: false, error: 'messages[] requis' });
  try {
    const jobs = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const job = await pushSend(
        { type: 'text', sessionId: req.params.session, to: m.to, text: m.text },
        { delay: (m.delay || 0) + i * 3000 }
      );
      jobs.push(job.id);
    }
    res.json({ ok: true, queued: jobs.length, jobIds: jobs });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

module.exports = router;
