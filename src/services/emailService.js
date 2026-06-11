// src/services/emailService.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: +process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

const brand = (content) => `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body{font-family:Arial,sans-serif;background:#0a0a1a;margin:0;padding:0}
  .wrap{max-width:520px;margin:40px auto;background:#13132a;border-radius:16px;overflow:hidden;border:1px solid #1e1e3f}
  .header{background:linear-gradient(135deg,#1a1a3e,#c0392b);padding:28px;text-align:center}
  .header h1{color:#fff;margin:0;font-size:22px;letter-spacing:2px}
  .body{padding:32px;color:#e0e0e0}
  .code{background:#0a0a1a;border:2px solid #c0392b;border-radius:12px;padding:20px;
        text-align:center;font-size:36px;font-weight:bold;color:#fff;letter-spacing:12px;margin:24px 0}
  .btn{display:block;background:linear-gradient(135deg,#1e40af,#c0392b);color:#fff;
       padding:14px 28px;border-radius:8px;text-decoration:none;text-align:center;
       font-weight:bold;margin:20px 0}
  .footer{text-align:center;color:#555;font-size:12px;padding:16px}
</style></head><body><div class="wrap">
<div class="header"><h1>🔐 Wise Smart Living & Security</h1></div>
<div class="body">${content}</div>
<div class="footer">© 2026 Wise OS · Ne répondez pas à cet email</div>
</div></body></html>`;

async function sendOTP(to, code) {
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: '🔐 Wise OS — Votre code de vérification',
    html: brand(`
      <p>Votre code de vérification est :</p>
      <div class="code">${code}</div>
      <p><strong>Ce code expire dans 10 minutes.</strong></p>
      <p style="color:#c0392b">⚠️ Ne partagez jamais ce code avec qui que ce soit.</p>
    `)
  });
}

async function sendMagicLink(to, link, name = '') {
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: '🔗 Wise OS — Votre lien de connexion',
    html: brand(`
      <p>Bonjour ${name || ''},</p>
      <p>Cliquez sur le bouton ci-dessous pour vous connecter :</p>
      <a href="${link}" class="btn">🚀 Se connecter maintenant</a>
      <p style="color:#888;font-size:13px">Lien valable 5 minutes · usage unique.</p>
    `)
  });
}

async function sendNotification(to, subject, message) {
  await transporter.sendMail({
    from: process.env.SMTP_FROM, to, subject,
    html: brand(`<p>${message}</p>`)
  });
}

module.exports = { sendOTP, sendMagicLink, sendNotification };
