// src/routes/groups.js
const router = require('express').Router();
const wm     = require('../core/baileysManager');

router.get('/:session',                async (req, res) => {
  try { res.json({ ok: true, groups: await wm.getGroups(req.params.session) }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/:session/:groupJid',      async (req, res) => {
  try { res.json({ ok: true, group: await wm.getGroupMeta(req.params.session, req.params.groupJid) }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/:session/create',        async (req, res) => {
  const { subject, participants } = req.body;
  if (!subject || !participants?.length)
    return res.status(400).json({ ok: false, error: 'subject + participants[] requis' });
  try { res.json(await wm.createGroup(req.params.session, subject, participants)); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/:session/:groupJid/add', async (req, res) => {
  try { res.json(await wm.addGroupParticipant(req.params.session, req.params.groupJid, req.body.participants)); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/:session/:groupJid/remove', async (req, res) => {
  try { res.json(await wm.removeGroupParticipant(req.params.session, req.params.groupJid, req.body.participants)); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/:session/:groupJid/promote', async (req, res) => {
  try { res.json(await wm.promoteGroupParticipant(req.params.session, req.params.groupJid, req.body.participants)); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/:session/:groupJid/leave', async (req, res) => {
  try { res.json(await wm.leaveGroup(req.params.session, req.params.groupJid)); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.patch('/:session/:groupJid/subject', async (req, res) => {
  try { res.json(await wm.updateGroupSubject(req.params.session, req.params.groupJid, req.body.subject)); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.patch('/:session/:groupJid/description', async (req, res) => {
  try { res.json(await wm.updateGroupDescription(req.params.session, req.params.groupJid, req.body.description)); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/:session/:groupJid/invite', async (req, res) => {
  try { res.json(await wm.getGroupInviteLink(req.params.session, req.params.groupJid)); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

module.exports = router;
