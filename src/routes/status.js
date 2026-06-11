// src/routes/status.js
const router = require('express').Router();
const wm     = require('../core/baileysManager');

router.post('/:session/text', async (req, res) => {
  const { text, backgroundColor } = req.body;
  if (!text) return res.status(400).json({ ok: false, error: 'text requis' });
  try { res.json(await wm.sendStatus(req.params.session, 'text', text)); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/:session/media', async (req, res) => {
  const multer = require('multer');
  const upload = multer({ storage: multer.memoryStorage() }).single('file');
  upload(req, res, async () => {
    const { type = 'image', caption } = req.body;
    if (!req.file) return res.status(400).json({ ok: false, error: 'file requis' });
    try { res.json(await wm.sendStatus(req.params.session, type, req.file.buffer, caption)); }
    catch (err) { res.status(500).json({ ok: false, error: err.message }); }
  });
});

module.exports = router;
