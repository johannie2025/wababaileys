// src/routes/communities.js — 🔜 Communities (Baileys in progress)
const router = require('express').Router();
const wm     = require('../core/baileysManager');

router.get('/:s', async (req,res) => {
  res.json(await wm.getCommunities(req.params.s));
});

module.exports = router;
