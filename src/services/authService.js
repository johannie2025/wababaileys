// src/services/authService.js — 2FA TOTP + OTP + Magic Link
const speakeasy = require('speakeasy');
const QRCode    = require('qrcode');
const jwt       = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const supabase  = require('../utils/supabaseClient');
const email     = require('./emailService');

class AuthService {

  // ─── 2FA TOTP (Wise Authenticator / Google Auth) ──────────────────────────
  async setupTOTP(userId, label = 'Wise OS', issuer = 'Wise Smart Living') {
    const secret = speakeasy.generateSecret({ name: `${issuer}:${label}`, length: 32 });
    // Save secret in Supabase (pending activation)
    await supabase.from('user_totp').upsert({
      user_id: userId,
      secret: secret.base32,
      active: false,
      created_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

    const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);
    return { secret: secret.base32, otpauthUrl: secret.otpauth_url, qrBase64: qrDataUrl };
  }

  async verifyAndActivateTOTP(userId, token) {
    const { data } = await supabase
      .from('user_totp').select('secret').eq('user_id', userId).single();
    if (!data) throw new Error('TOTP non configuré');

    const valid = speakeasy.totp.verify({
      secret: data.secret, encoding: 'base32', token,
      window: 1 // ±30s tolerance
    });
    if (!valid) throw new Error('Code TOTP invalide');

    await supabase.from('user_totp')
      .update({ active: true }).eq('user_id', userId);
    return { ok: true };
  }

  async verifyTOTP(userId, token) {
    const { data } = await supabase
      .from('user_totp').select('secret, active').eq('user_id', userId).maybeSingle();
    if (!data?.active) throw new Error('TOTP non activé');

    const valid = speakeasy.totp.verify({
      secret: data.secret, encoding: 'base32', token, window: 1
    });
    return { ok: valid, error: valid ? null : 'Code invalide ou expiré' };
  }

  // ─── OTP 6 chiffres (WhatsApp + Email) ────────────────────────────────────
  async generateOTP(userId, channel = 'whatsapp') {
    const code    = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    await supabase.from('auth_otps').upsert({
      user_id: userId, code, channel,
      expires_at: expiresAt.toISOString(),
      used: false, created_at: new Date().toISOString()
    }, { onConflict: 'user_id,channel' });

    return { code, expiresAt };
  }

  async verifyOTP(userId, code, channel = 'whatsapp') {
    const { data } = await supabase
      .from('auth_otps')
      .select('*')
      .eq('user_id', userId).eq('channel', channel)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return { ok: false, error: 'OTP introuvable ou expiré' };
    if (data.code !== String(code)) return { ok: false, error: 'Code incorrect' };

    await supabase.from('auth_otps').update({ used: true }).eq('id', data.id);
    return { ok: true };
  }

  // ─── Magic Link JWT (session tablette 5 min, ou accès rapide) ─────────────
  async generateMagicLink(userId, role = 'agent', ttl = 300, baseUrl = '') {
    const jti   = uuid();
    const token = jwt.sign(
      { sub: userId, role, type: 'magic_link', jti },
      process.env.JWT_SECRET,
      { expiresIn: ttl }
    );
    const link = `${baseUrl || process.env.PHP_BASE_URL}/auth/magic?token=${token}`;

    // Blacklist entry (invalidé après usage)
    await supabase.from('magic_links').insert({
      jti, user_id: userId, expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
      used: false, created_at: new Date().toISOString()
    });

    return { token, link, expiresIn: ttl };
  }

  async verifyMagicLink(token) {
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return { ok: false, error: 'Token invalide ou expiré' };
    }

    if (decoded.type !== 'magic_link') return { ok: false, error: 'Type token invalide' };

    // Check blacklist
    const { data } = await supabase
      .from('magic_links').select('*').eq('jti', decoded.jti).maybeSingle();
    if (!data || data.used) return { ok: false, error: 'Lien déjà utilisé' };

    // Mark as used
    await supabase.from('magic_links').update({ used: true }).eq('jti', decoded.jti);

    // Generate session JWT (4h)
    const sessionToken = jwt.sign(
      { sub: decoded.sub, role: decoded.role, type: 'session' },
      process.env.JWT_SECRET, { expiresIn: '4h' }
    );

    return { ok: true, sessionToken, userId: decoded.sub, role: decoded.role };
  }

  // ─── Full auth flow: send OTP via WhatsApp + Email ─────────────────────────
  async sendOTPWhatsApp(userId, phone, sessionId) {
    const { code } = await this.generateOTP(userId, 'whatsapp');
    const wm = require('../core/baileysManager');
    const text = `🔐 *Wise OS — Code de vérification*\n\nVotre code : *${code}*\n\n_Valable 10 minutes. Ne le partagez jamais._`;
    await wm.sendText(sessionId, phone, text);
    return { ok: true, channel: 'whatsapp' };
  }

  async sendOTPEmail(userId, emailAddr) {
    const { code } = await this.generateOTP(userId, 'email');
    await email.sendOTP(emailAddr, code);
    return { ok: true, channel: 'email' };
  }

  async sendMagicLinkWhatsApp(userId, phone, role, sessionId, baseUrl) {
    const { link } = await this.generateMagicLink(userId, role, 300, baseUrl);
    const wm = require('../core/baileysManager');
    const text = `🔗 *Wise OS — Connexion rapide*\n\nCliquez ici pour vous connecter :\n${link}\n\n_Ce lien expire dans 5 minutes._`;
    await wm.sendText(sessionId, phone, text);
    return { ok: true };
  }

  // ─── Session JWT (long durée) ──────────────────────────────────────────────
  signSession(user, expiresIn = '8h') {
    return jwt.sign(
      { sub: user.id, role: user.role, name: user.name, entityId: user.entity_id },
      process.env.JWT_SECRET, { expiresIn }
    );
  }
}

module.exports = new AuthService();
