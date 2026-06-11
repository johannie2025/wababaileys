// src/routes/channels.js — ✅ Channels (Newsletters) v2.1
const router = require('express').Router();
const multer = require('multer');
const wm     = require('../core/baileysManager');
const upload = multer({ storage:multer.memoryStorage() });
const err = (res,e) => res.status(500).json({ ok:false, error:e.message });
const bad = (res,m) => res.status(400).json({ ok:false, error:m });

// ✅ Canaux suivis
router.get('/:s',                          async (req,res) => {
  try { res.json(await wm.getFollowedChannels(req.params.s)); } catch(e){err(res,e);}
});

// ✅ Info canal
router.get('/:s/:channelJid/info',         async (req,res) => {
  try { res.json(await wm.getChannelInfo(req.params.s, req.params.channelJid)); } catch(e){err(res,e);}
});

// ✅ Follow
router.post('/:s/:channelJid/follow',      async (req,res) => {
  try { res.json(await wm.followChannel(req.params.s, req.params.channelJid)); } catch(e){err(res,e);}
});

// ✅ Unfollow
router.post('/:s/:channelJid/unfollow',    async (req,res) => {
  try { res.json(await wm.unfollowChannel(req.params.s, req.params.channelJid)); } catch(e){err(res,e);}
});

// ✅ Mute canal
router.post('/:s/:channelJid/mute',        async (req,res) => {
  try { res.json(await wm.muteChannel(req.params.s, req.params.channelJid)); } catch(e){err(res,e);}
});

// ✅ Publier texte dans canal
router.post('/:s/:channelJid/send-text',   async (req,res) => {
  const { text } = req.body;
  if (!text) return bad(res,'text requis');
  try { res.json(await wm.sendToChannel(req.params.s, req.params.channelJid, { text })); } catch(e){err(res,e);}
});

// ✅ Publier image dans canal
router.post('/:s/:channelJid/send-image', upload.single('file'), async (req,res) => {
  if (!req.file) return bad(res,'file requis');
  try { res.json(await wm.sendToChannel(req.params.s, req.params.channelJid, { image:req.file.buffer, caption:req.body.caption||'' })); } catch(e){err(res,e);}
});

// ✅ Réagir à un message de canal
router.post('/:s/:channelJid/react',       async (req,res) => {
  const { messageId, emoji } = req.body;
  if (!messageId||!emoji) return bad(res,'messageId + emoji requis');
  try { res.json(await wm.reactToChannelMsg(req.params.s, req.params.channelJid, messageId, emoji)); } catch(e){err(res,e);}
});

module.exports = router;
