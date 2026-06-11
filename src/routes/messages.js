// src/routes/messages.js — v2.1 (buttons/lists REMOVED — deprecated)
const router = require('express').Router();
const wm     = require('../core/baileysManager');
const { pushSend } = require('../core/queue');

const err = (res, e) => res.status(500).json({ ok:false, error:e.message });
const bad = (res, m) => res.status(400).json({ ok:false, error:m });

// ✅ TEXT
router.post('/:s/text', async (req,res) => {
  const { to, text, quotedId, mentions, linkPreview, queue } = req.body;
  if (!to||!text) return bad(res,'to + text requis');
  try {
    if (queue) {
      const job = await pushSend({ type:'text', sessionId:req.params.s, to, text, quotedId });
      return res.json({ ok:true, queued:true, jobId:job.id });
    }
    res.json(await wm.sendText(req.params.s, to, text, { quotedId, mentions, linkPreview }));
  } catch(e) { err(res,e); }
});

// ✅ POLL (✅ supported)
router.post('/:s/poll', async (req,res) => {
  const { to, name, values, selectableCount } = req.body;
  if (!to||!name||!values?.length) return bad(res,'to, name, values[] requis');
  try { res.json(await wm.sendPoll(req.params.s, to, name, values, selectableCount)); }
  catch(e) { err(res,e); }
});

// ✅ REACTION
router.post('/:s/reaction', async (req,res) => {
  const { to, messageId, emoji } = req.body;
  if (!to||!messageId) return bad(res,'to + messageId requis');
  try { res.json(await wm.sendReaction(req.params.s, to, messageId, emoji||'')); }
  catch(e) { err(res,e); }
});

// ✅ LOCATION
router.post('/:s/location', async (req,res) => {
  const { to, lat, lng, name, address } = req.body;
  if (!to||lat==null||lng==null) return bad(res,'to, lat, lng requis');
  try { res.json(await wm.sendLocation(req.params.s, to, lat, lng, name, address)); }
  catch(e) { err(res,e); }
});

// ✅ CONTACT CARD
router.post('/:s/contact', async (req,res) => {
  const { to, contacts } = req.body;
  if (!to||!contacts?.length) return bad(res,'to + contacts[] requis');
  try { res.json(await wm.sendContact(req.params.s, to, contacts)); }
  catch(e) { err(res,e); }
});

// ✅ MENTION
router.post('/:s/mention', async (req,res) => {
  const { to, text, mentions } = req.body;
  if (!to||!text||!mentions?.length) return bad(res,'to, text, mentions[] requis');
  try { res.json(await wm.sendMention(req.params.s, to, text, mentions)); }
  catch(e) { err(res,e); }
});

// ✅ READ
router.post('/:s/read', async (req,res) => {
  const { jid, messageIds } = req.body;
  if (!jid||!messageIds?.length) return bad(res,'jid + messageIds[] requis');
  try { res.json(await wm.markAsRead(req.params.s, jid, messageIds)); }
  catch(e) { err(res,e); }
});

// ✅ DELETE
router.delete('/:s/delete', async (req,res) => {
  const { jid, messageId } = req.body;
  if (!jid||!messageId) return bad(res,'jid + messageId requis');
  try { res.json(await wm.deleteMessage(req.params.s, jid, messageId)); }
  catch(e) { err(res,e); }
});

// ✅ FORWARD
router.post('/:s/forward', async (req,res) => {
  const { to, fromJid, messageId } = req.body;
  if (!to||!fromJid||!messageId) return bad(res,'to, fromJid, messageId requis');
  try { res.json(await wm.forwardMessage(req.params.s, to, fromJid, messageId)); }
  catch(e) { err(res,e); }
});

// ✅ BULK
router.post('/:s/bulk', async (req,res) => {
  const { messages } = req.body;
  if (!messages?.length) return bad(res,'messages[] requis');
  try {
    const jobs = [];
    for (let i=0;i<messages.length;i++) {
      const m = messages[i];
      const job = await pushSend({ type:'text', sessionId:req.params.s, to:m.to, text:m.text },
        { delay:(m.delay||0)+i*3000 });
      jobs.push(job.id);
    }
    res.json({ ok:true, queued:jobs.length, jobIds:jobs });
  } catch(e) { err(res,e); }
});

// ❌ DEPRECATED — boutons/listes supprimés (Baileys ne supporte plus)
router.post('/:s/buttons', (_req,res) => res.status(410).json({ ok:false, error:'DEPRECATED: Les boutons WhatsApp ne sont plus supportés par Baileys. Utilisez /poll ou /text.' }));
router.post('/:s/list',    (_req,res) => res.status(410).json({ ok:false, error:'DEPRECATED: Les listes WhatsApp ne sont plus supportées par Baileys. Utilisez /poll.' }));

module.exports = router;
