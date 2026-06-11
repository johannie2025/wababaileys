// src/middleware/auth.js
const jwt = require('jsonwebtoken');

const apiAuth = (req, res, next) => {
  // 1. API Key statique (PHP ↔ Node)
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey && apiKey === process.env.NODE_API_KEY) return next();

  // 2. JWT Bearer (Magic Link, dashboard web)
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
      req.user = decoded;
      return next();
    } catch {
      return res.status(401).json({ ok: false, error: 'Token JWT invalide ou expiré' });
    }
  }

  return res.status(401).json({ ok: false, error: 'Auth requise : X-API-Key ou Bearer JWT' });
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(403).json({ ok: false, error: 'Accès refusé' });
  if (!roles.includes(req.user.role))
    return res.status(403).json({ ok: false, error: `Rôle requis: ${roles.join(' | ')}` });
  next();
};

module.exports = { apiAuth, requireRole };
