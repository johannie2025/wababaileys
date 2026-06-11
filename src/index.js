// src/index.js — Wise OS · Baileys Engine Enterprise v2.0
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const pino    = require('pino');

const routes           = require('./routes');
const { apiAuth }      = require('./middleware/auth');
const { initWorker }   = require('./workers/sendWorker');
const { initCronJobs } = require('./services/cronService');

const logger = pino({ level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty' } : undefined });

const app = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : '*',
  methods: ['GET','POST','PUT','PATCH','DELETE'],
  allowedHeaders: ['Content-Type','Authorization','X-API-Key']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Request logger ────────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  if (req.path !== '/health') logger.info({ method: req.method, path: req.path });
  next();
});

// ── Public ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({
  ok: true,
  service: 'Wise OS · Baileys Engine Enterprise v2.0',
  uptime: Math.floor(process.uptime()),
  time: new Date().toISOString()
}));

// ── Protected API ─────────────────────────────────────────────────────────────
app.use('/api', apiAuth);
app.use('/api', routes);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Route introuvable' }));

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  logger.error(err);
  res.status(500).json({ ok: false, error: err.message || 'Erreur interne serveur' });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`🚀 Wise OS Baileys Engine démarré → http://localhost:${PORT}`);
  initWorker();
  initCronJobs();
});

module.exports = app;
