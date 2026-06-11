// src/routes/status.js — Stories WhatsApp v2.1
const router = require('express').Router();
const multer = require('multer');
const axios  = require('axios');
const wm     = require('../core/baileysManager');
const upload = multer({ storage:multer.memoryStorage(), limits:{ fileSize:64*1024*1024 }});
const err = (res,e) => res.status(500).json({ ok:false, error:e.message });

// ✅ Status texte
router.post('/:s/text', async (req,res) => {
  const { text, bgColor, font } = req.body;
  if (!text) return res.status(400).json({ ok:false, error:'text requis' });
  try { res.json(await wm.sendTextStatus(req.params.s, text, bgColor, font)); } catch(e){err(res,e);}
});

// ✅ Status image/vidéo (upload)
router.post('/:s/media', upload.single('file'), async (req,res) => {
  const { type='image', caption } = req.body;
  if (!req.file) return res.status(400).json({ ok:false, error:'file requis' });
  try { res.json(await wm.sendMediaStatus(req.params.s, req.file.buffer, type, caption||'')); } catch(e){err(res,e);}
});

// ✅ Status image depuis URL
router.post('/:s/media-url', async (req,res) => {
  const { url, type='image', caption } = req.body;
  if (!url) return res.status(400).json({ ok:false, error:'url requis' });
  try {
    const r = await axios.get(url,{ responseType:'arraybuffer', timeout:15000 });
    res.json(await wm.sendMediaStatus(req.params.s, Buffer.from(r.data), type, caption||''));
  } catch(e){err(res,e);}
});

module.exports = router;
