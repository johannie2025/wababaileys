// src/routes/session.js
const router  = require('express').Router();
const wm      = require('../core/baileysManager');

// GET /api/session — liste toutes les sessions
router.get('/', (_req, res) => {
  res.json({ ok: true, sessions: wm.getAllSessions() });
});

// POST /api/session/:id/connect — démarre/reconnecter une session
router.post('/:id/connect', async (req, res) => {
  try {
    const inst = await wm.getInstance(req.params.id);
    res.json({ ok: true, status: inst.status });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// GET /api/session/:id/qr — obtenir QR code
router.get('/:id/qr', async (req, res) => {
  try {
    const result = await wm.getQR(req.params.id);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// GET /api/session/:id/status — statut connexion
router.get('/:id/status', (req, res) => {
  res.json(wm.getStatus(req.params.id));
});

// POST /api/session/:id/logout
router.post('/:id/logout', async (req, res) => {
  try {
    const result = await wm.logout(req.params.id);
    res.json(result);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/session/:id/restart
router.post('/:id/restart', async (req, res) => {
  try {
    const result = await wm.restartSession(req.params.id);
    res.json(result);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

module.exports = router;
