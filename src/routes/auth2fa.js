// src/routes/auth2fa.js
const router = require('express').Router();
const auth   = require('../services/authService');

// ── TOTP Setup ──────────────────────────────────────────────────────────────
router.post('/totp/setup',    async (req, res) => {
  const { userId, label } = req.body;
  if (!userId) return res.status(400).json({ ok: false, error: 'userId requis' });
  try { res.json({ ok: true, ...(await auth.setupTOTP(userId, label)) }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/totp/activate', async (req, res) => {
  const { userId, token } = req.body;
  if (!userId || !token) return res.status(400).json({ ok: false, error: 'userId + token requis' });
  try { res.json(await auth.verifyAndActivateTOTP(userId, token)); }
  catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

router.post('/totp/verify',   async (req, res) => {
  const { userId, token } = req.body;
  if (!userId || !token) return res.status(400).json({ ok: false, error: 'userId + token requis' });
  try { res.json(await auth.verifyTOTP(userId, token)); }
  catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// ── OTP WhatsApp ─────────────────────────────────────────────────────────────
router.post('/otp/send-whatsapp', async (req, res) => {
  const { userId, phone, sessionId } = req.body;
  if (!userId || !phone || !sessionId)
    return res.status(400).json({ ok: false, error: 'userId, phone, sessionId requis' });
  try { res.json(await auth.sendOTPWhatsApp(userId, phone, sessionId)); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── OTP Email ────────────────────────────────────────────────────────────────
router.post('/otp/send-email', async (req, res) => {
  const { userId, email } = req.body;
  if (!userId || !email) return res.status(400).json({ ok: false, error: 'userId + email requis' });
  try { res.json(await auth.sendOTPEmail(userId, email)); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── OTP Verify ───────────────────────────────────────────────────────────────
router.post('/otp/verify', async (req, res) => {
  const { userId, code, channel } = req.body;
  if (!userId || !code) return res.status(400).json({ ok: false, error: 'userId + code requis' });
  try { res.json(await auth.verifyOTP(userId, code, channel)); }
  catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// ── Magic Link ────────────────────────────────────────────────────────────────
router.post('/magic-link/generate', async (req, res) => {
  const { userId, role, ttl, baseUrl } = req.body;
  if (!userId) return res.status(400).json({ ok: false, error: 'userId requis' });
  try { res.json({ ok: true, ...(await auth.generateMagicLink(userId, role, ttl, baseUrl)) }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/magic-link/send-whatsapp', async (req, res) => {
  const { userId, phone, role, sessionId, baseUrl } = req.body;
  if (!userId || !phone || !sessionId)
    return res.status(400).json({ ok: false, error: 'userId, phone, sessionId requis' });
  try { res.json(await auth.sendMagicLinkWhatsApp(userId, phone, role, sessionId, baseUrl)); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/magic-link/verify', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ ok: false, error: 'token requis' });
  try { res.json(await auth.verifyMagicLink(token)); }
  catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

module.exports = router;
