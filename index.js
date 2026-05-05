require('dotenv').config();
const express = require('express');
const { getSession, sendText, sendMedia, logout, sessions } = require('./baileys_manager');
const app = express();

// Augmentation de la limite pour les fichiers base64 envoyés par le PHP
app.use(express.json({ limit: '50mb' }));

/**
 * Middleware d'authentification
 * Vérifie le Bearer Token envoyé par WabaNodeClient.php
 */
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const apiKey = process.env.NODE_API_KEY;
    if (apiKey && authHeader !== `Bearer ${apiKey}`) {
        return res.status(401).json({ _ok: false, error: 'Unauthorized' });
    }
    next();
};

// --- ROUTES ---

/** GET /health - Ping global pour vérifier si le moteur tourne */
app.get('/health', (req, res) => {
    res.json({ _ok: true, status: 'running', engine: 'Baileys' });
});

/** POST /channels - Créer ou initialiser un canal */
app.post('/channels', authMiddleware, async (req, res) => {
    const { name, user_id, webhook_url } = req.body;
    const channelId = req.body.id || `ch_${Date.now()}`; 
    try {
        await getSession(channelId, webhook_url); 
        res.json({ _ok: true, id: channelId, name: name });
    } catch (e) {
        res.status(500).json({ _ok: false, error: e.message });
    }
});

/** GET /channels/:id/status - État de connexion (utilisé par health() en PHP)[cite: 2] */
/** GET /channels/:id/status */
app.get('/channels/:id/status', authMiddleware, async (req, res) => {
    let instance = sessions.get(req.params.id);
    
    // Si l'instance n'est pas en mémoire (après un reboot Render), on la réveille
    if (!instance) {
        console.log(`[REBOOT] Réveil automatique du canal : ${req.params.id}`);
        // On récupère le webhook_url si ton PHP l'envoie, sinon null
        instance = await getSession(req.params.id); 
    }
    
    res.json({ 
        _ok: true, 
        status: instance.status, 
        phone: instance.sock?.user?.id || null 
    });
});

/** GET /channels/:id/qr - Récupérer le code QR brut[cite: 2] */
app.get('/channels/:id/qr', authMiddleware, (req, res) => {
    const instance = sessions.get(req.params.id);
    if (!instance || !instance.qr) {
        return res.json({ _ok: false, qr: null, message: 'QR not ready or already connected' });
    }
    res.json({ _ok: true, qr: instance.qr }); 
});

/** POST /channels/:id/send - Envoyer un message texte[cite: 2] */
app.post('/channels/:id/send', authMiddleware, async (req, res) => {
    const { to, message } = req.body;
    try {
        await sendText(req.params.id, to, message);
        res.json({ _ok: true });
    } catch (e) {
        res.status(500).json({ _ok: false, error: e.message });
    }
});

/** POST /channels/:id/send-media - Envoyer un média (Image, Vidéo, Doc)[cite: 2] */
app.post('/channels/:id/send-media', authMiddleware, async (req, res) => {
    try {
        await sendMedia(req.params.id, req.body);
        res.json({ _ok: true });
    } catch (e) {
        res.status(500).json({ _ok: false, error: e.message });
    }
});

/** POST /channels/:id/logout - Déconnexion propre sans supprimer le canal[cite: 2] */
app.post('/channels/:id/logout', authMiddleware, async (req, res) => {
    const result = await logout(req.params.id);
    res.json(result);
});

/** DELETE /channels/:id - Suppression complète d'un canal[cite: 2] */
app.delete('/channels/:id', authMiddleware, async (req, res) => {
    await logout(req.params.id);
    res.json({ _ok: true });
});

/** PATCH /channels/:id/webhook - Mise à jour de l'URL de retour[cite: 2] */
app.patch('/channels/:id/webhook', authMiddleware, async (req, res) => {
    const { url } = req.body;
    // On relance la session avec le nouveau webhook
    await getSession(req.params.id, url);
    res.json({ _ok: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Engine Baileys running on port ${PORT}`));
