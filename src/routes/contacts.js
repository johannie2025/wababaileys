// src/routes/contacts.js — v2.1 full checklist
const router = require('express').Router();
const wm     = require('../core/baileysManager');
const err = (res,e) => res.status(500).json({ ok:false, error:e.message });
const bad = (res,m) => res.status(400).json({ ok:false, error:m });

// ✅ Liste contacts
router.get('/:s',                async (req,res) => {
  try { res.json({ ok:true, contacts:await wm.getContacts(req.params.s) }); } catch(e){err(res,e);}
});

// ✅ Vérifier numéros WhatsApp
router.post('/:s/check',         async (req,res) => {
  const { phones } = req.body;
  if (!phones?.length) return bad(res,'phones[] requis');
  try { res.json({ ok:true, results:await wm.checkPhones(req.params.s, phones) }); } catch(e){err(res,e);}
});

// ✅ Info complète contact (photo + status)
router.get('/:s/:jid/info',      async (req,res) => {
  try { res.json(await wm.getContactInfo(req.params.s, req.params.jid)); } catch(e){err(res,e);}
});

// ✅ Photo de profil
router.get('/:s/:jid/photo',     async (req,res) => {
  try { res.json(await wm.getProfilePicture(req.params.s, req.params.jid, req.query.hd==='true')); } catch(e){err(res,e);}
});

// ✅ Subscribe presence (online/offline)
router.post('/:s/:jid/presence', async (req,res) => {
  try { res.json(await wm.subscribePresence(req.params.s, req.params.jid)); } catch(e){err(res,e);}
});

// ✅ Mettre à jour bio/status
router.patch('/:s/me/status',    async (req,res) => {
  const { status } = req.body;
  if (!status) return bad(res,'status requis');
  try { res.json(await wm.updateMyStatus(req.params.s, status)); } catch(e){err(res,e);}
});

// ✅ Mettre à jour nom affiché
router.patch('/:s/me/name',      async (req,res) => {
  const { name } = req.body;
  if (!name) return bad(res,'name requis');
  try { res.json(await wm.updateMyName(req.params.s, name)); } catch(e){err(res,e);}
});

// ✅ Mute chat
router.post('/:s/mute',          async (req,res) => {
  const { jid, durationHours } = req.body;
  if (!jid) return bad(res,'jid requis');
  try { res.json(await wm.muteChat(req.params.s, jid, durationHours?durationHours*3600000:null)); } catch(e){err(res,e);}
});

// ✅ Unmute chat
router.post('/:s/unmute',        async (req,res) => {
  const { jid } = req.body;
  if (!jid) return bad(res,'jid requis');
  try { res.json(await wm.unmuteChat(req.params.s, jid)); } catch(e){err(res,e);}
});

// ✅ Bloquer contact
router.post('/:s/block',         async (req,res) => {
  const { jid } = req.body;
  if (!jid) return bad(res,'jid requis');
  try { res.json(await wm.blockContact(req.params.s, jid)); } catch(e){err(res,e);}
});

// ✅ Débloquer contact
router.post('/:s/unblock',       async (req,res) => {
  const { jid } = req.body;
  if (!jid) return bad(res,'jid requis');
  try { res.json(await wm.unblockContact(req.params.s, jid)); } catch(e){err(res,e);}
});

module.exports = router;
