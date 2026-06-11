// src/routes/media.js
const router  = require('express').Router();
const multer  = require('multer');
const axios   = require('axios');
const wm      = require('../core/baileysManager');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024 * 1024 } });

const TYPES = ['image','video','audio','document','sticker'];

// POST /api/media/:session/send-file — envoi fichier uploadé
router.post('/:session/send-file', upload.single('file'), async (req, res) => {
  const { to, type = 'image', caption = '', fileName, mimetype, ptt } = req.body;
  if (!to || !req.file) return res.status(400).json({ ok: false, error: 'to + file requis' });
  if (!TYPES.includes(type)) return res.status(400).json({ ok: false, error: `type doit être: ${TYPES.join(', ')}` });
  try {
    const result = await wm.sendMedia(req.params.session, to, req.file.buffer, type, caption, {
      fileName: fileName || req.file.originalname,
      mimetype: mimetype || req.file.mimetype,
      ptt: ptt === 'true'
    });
    res.json(result);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/media/:session/send-url — envoi depuis URL distante
router.post('/:session/send-url', async (req, res) => {
  const { to, url, type = 'image', caption = '', fileName, mimetype } = req.body;
  if (!to || !url) return res.status(400).json({ ok: false, error: 'to + url requis' });
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    const buf = Buffer.from(response.data);
    const mime = mimetype || response.headers['content-type'] || 'application/octet-stream';
    const result = await wm.sendMedia(req.params.session, to, buf, type, caption, { fileName, mimetype: mime });
    res.json(result);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

module.exports = router;
