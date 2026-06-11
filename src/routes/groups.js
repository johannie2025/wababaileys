// src/routes/groups.js — v2.1 full checklist
const router = require('express').Router();
const wm     = require('../core/baileysManager');
const err = (res,e) => res.status(500).json({ ok:false, error:e.message });
const bad = (res,m) => res.status(400).json({ ok:false, error:m });

// ✅ Liste groupes
router.get('/:s',                        async (req,res) => {
  try { res.json({ ok:true, groups:await wm.getGroups(req.params.s) }); } catch(e){err(res,e);}
});

// ✅ Métadonnées groupe
router.get('/:s/:gid',                   async (req,res) => {
  try { res.json({ ok:true, group:await wm.getGroupMeta(req.params.s, req.params.gid) }); } catch(e){err(res,e);}
});

// ✅ Créer groupe
router.post('/:s/create',                async (req,res) => {
  const { subject, participants } = req.body;
  if (!subject||!participants?.length) return bad(res,'subject + participants[] requis');
  try { res.json(await wm.createGroup(req.params.s, subject, participants)); } catch(e){err(res,e);}
});

// ✅ Rejoindre par lien
router.post('/:s/join',                  async (req,res) => {
  const { inviteCode } = req.body;
  if (!inviteCode) return bad(res,'inviteCode requis');
  try { res.json(await wm.joinGroupByLink(req.params.s, inviteCode)); } catch(e){err(res,e);}
});

// ✅ Info lien d'invitation (avant de rejoindre)
router.get('/:s/invite-info/:code',      async (req,res) => {
  try { res.json(await wm.getGroupInviteInfo(req.params.s, req.params.code)); } catch(e){err(res,e);}
});

// ✅ Ajouter participants
router.post('/:s/:gid/add',              async (req,res) => {
  if (!req.body.participants?.length) return bad(res,'participants[] requis');
  try { res.json(await wm.groupParticipants(req.params.s, req.params.gid, req.body.participants,'add')); } catch(e){err(res,e);}
});

// ✅ Retirer participants
router.post('/:s/:gid/remove',           async (req,res) => {
  if (!req.body.participants?.length) return bad(res,'participants[] requis');
  try { res.json(await wm.groupParticipants(req.params.s, req.params.gid, req.body.participants,'remove')); } catch(e){err(res,e);}
});

// ✅ Promouvoir en admin
router.post('/:s/:gid/promote',          async (req,res) => {
  if (!req.body.participants?.length) return bad(res,'participants[] requis');
  try { res.json(await wm.groupParticipants(req.params.s, req.params.gid, req.body.participants,'promote')); } catch(e){err(res,e);}
});

// ✅ Rétrograder admin
router.post('/:s/:gid/demote',           async (req,res) => {
  if (!req.body.participants?.length) return bad(res,'participants[] requis');
  try { res.json(await wm.groupParticipants(req.params.s, req.params.gid, req.body.participants,'demote')); } catch(e){err(res,e);}
});

// ✅ Quitter groupe
router.post('/:s/:gid/leave',            async (req,res) => {
  try { res.json(await wm.leaveGroup(req.params.s, req.params.gid)); } catch(e){err(res,e);}
});

// ✅ Renommer groupe
router.patch('/:s/:gid/subject',         async (req,res) => {
  if (!req.body.subject) return bad(res,'subject requis');
  try { res.json(await wm.updateGroupSubject(req.params.s, req.params.gid, req.body.subject)); } catch(e){err(res,e);}
});

// ✅ Modifier description
router.patch('/:s/:gid/description',     async (req,res) => {
  try { res.json(await wm.updateGroupDescription(req.params.s, req.params.gid, req.body.description||'')); } catch(e){err(res,e);}
});

// ✅ Paramètres (qui peut écrire / modifier infos)
router.patch('/:s/:gid/settings',        async (req,res) => {
  try { res.json(await wm.updateGroupSettings(req.params.s, req.params.gid, req.body)); } catch(e){err(res,e);}
});

// ✅ Obtenir lien d'invitation
router.get('/:s/:gid/invite',            async (req,res) => {
  try { res.json(await wm.getGroupInviteLink(req.params.s, req.params.gid)); } catch(e){err(res,e);}
});

// ✅ Révoquer lien invitation
router.post('/:s/:gid/invite/revoke',    async (req,res) => {
  try { res.json(await wm.revokeGroupInvite(req.params.s, req.params.gid)); } catch(e){err(res,e);}
});

module.exports = router;
