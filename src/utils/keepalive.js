// src/utils/keepalive.js — Anti-sleep Render Free Tier
const https = require('https');
const url   = process.env.SELF_URL || 'https://wise-engine.onrender.com';

const ping = () => {
  https.get(`${url}/health`, res => {
    console.log(`[KeepAlive] ping → ${res.statusCode} @ ${new Date().toISOString()}`);
  }).on('error', err => {
    console.warn(`[KeepAlive] erreur : ${err.message}`);
  });
};

// Ping toutes les 14 minutes (Render dort après 15 min)
ping();
setInterval(ping, 14 * 60 * 1000);
