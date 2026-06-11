// src/routes/contacts.js
const router = require('express').Router();
const wm     = require('../core/baileysManager');

router.get('/:session',              async (req, res) => {
  try { res.json({ ok: true, contacts: await wm.getContacts(req.params.session) }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/:session/check',       async (req, res) => {
  const { phones } = req.body;
  if (!phones?.length) return res.status(400).json({ ok: false, error: 'phones[] requis' });
  try { res.json({ ok: true, results: await wm.checkPhone(req.params.session, phones) }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/:session/:jid/photo',   async (req, res) => {
  try { res.json(await wm.getProfilePicture(req.params.session, req.params.jid)); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.patch('/:session/status',     async (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ ok: false, error: 'status requis' });
  try { res.json(await wm.updateProfileStatus(req.params.session, status)); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

module.exports = router;
