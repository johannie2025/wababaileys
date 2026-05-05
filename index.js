require('dotenv').config();
const express = require('express');
const QRCode  = require('qrcode');
const { getSession, sendText, sendMedia, getChats, getMessages, getContacts, logout, sessions } = require('./baileys_manager');
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

// ─── ROUTES ──────────────────────────────────────────────────────────────────

/** GET /health - Ping global */
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

/** GET /channels/:id/status - État de connexion */
app.get('/channels/:id/status', authMiddleware, async (req, res) => {
    let instance = sessions.get(req.params.id);
    
    // Si l'instance n'est pas en mémoire (après un reboot Render), on la réveille
    if (!instance) {
        console.log(`[REBOOT] Réveil automatique du canal : ${req.params.id}`);
        try {
            instance = await getSession(req.params.id);
        } catch(e) {
            return res.status(500).json({ _ok: false, error: e.message });
        }
    }
    
    res.json({ 
        _ok: true, 
        status: instance.status, 
        phone: instance.sock?.user?.id ? instance.sock.user.id.split(':')[0] : null,
        lastError: instance.lastError || null
    });
});

/** GET /channels/:id/qr - Récupérer le code QR brut (string) */
app.get('/channels/:id/qr', authMiddleware, (req, res) => {
    const instance = sessions.get(req.params.id);
    
    if (!instance || !instance.qr) {
        return res.json({ _ok: true, qr: null, status: instance?.status || 'not_found' });
    }
    
    res.json({ _ok: true, qr: instance.qr });
});

/**
 * GET /channels/:id/qr/image - Génère l'image PNG du QR code
 * FIX CRITIQUE : l'original utilisait manager.getInstance() qui n'existe pas.
 * On utilise sessions.get() comme partout ailleurs.
 */
app.get('/channels/:id/qr/image', authMiddleware, async (req, res) => {
    const instance = sessions.get(req.params.id);

    if (!instance || !instance.qr) {
        console.log(`[QR_ROUTE] QR non prêt pour : ${req.params.id}`);
        return res.status(404).json({ _ok: false, error: 'QR not ready', status: instance?.status || 'not_found' });
    }

    try {
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        await QRCode.toFileStream(res, instance.qr);
        console.log(`[QR_ROUTE] Image générée avec succès pour : ${req.params.id}`);
    } catch (err) {
        console.error(`[QR_ERROR] ${err.message}`);
        res.status(500).send('Error generating QR');
    }
});

/** POST /channels/:id/send - Envoyer un message texte */
app.post('/channels/:id/send', authMiddleware, async (req, res) => {
    const { to, message } = req.body;
    try {
        await sendText(req.params.id, to, message);
        res.json({ _ok: true });
    } catch (e) {
        res.status(500).json({ _ok: false, error: e.message });
    }
});

/** POST /channels/:id/send-media - Envoyer un média (Image, Vidéo, Doc) */
app.post('/channels/:id/send-media', authMiddleware, async (req, res) => {
    try {
        await sendMedia(req.params.id, req.body);
        res.json({ _ok: true });
    } catch (e) {
        res.status(500).json({ _ok: false, error: e.message });
    }
});

/** POST /channels/:id/logout - Déconnexion propre sans supprimer le canal */
app.post('/channels/:id/logout', authMiddleware, async (req, res) => {
    const result = await logout(req.params.id);
    res.json(result);
});

/** DELETE /channels/:id - Suppression complète d'un canal */
app.delete('/channels/:id', authMiddleware, async (req, res) => {
    await logout(req.params.id);
    res.json({ _ok: true });
});

/** PATCH /channels/:id/webhook - Mise à jour de l'URL de retour */
app.patch('/channels/:id/webhook', authMiddleware, async (req, res) => {
    const { url } = req.body;
    try {
        await getSession(req.params.id, url);
        res.json({ _ok: true });
    } catch (e) {
        res.status(500).json({ _ok: false, error: e.message });
    }
});

/**
 * POST /channels/:id/restart - Redémarrer un canal
 * FIX : route manquante appelée par PHP restartChannel()
 */
app.post('/channels/:id/restart', authMiddleware, async (req, res) => {
    const channelId = req.params.id;
    const instance  = sessions.get(channelId);
    const webhookUrl = instance?._webhookUrl || null;

    // Fermer proprement l'instance existante
    if (instance) {
        try { await instance.sock.end(); } catch (e) {}
        sessions.delete(channelId);
    }

    try {
        await getSession(channelId, webhookUrl);
        res.json({ _ok: true });
    } catch (e) {
        res.status(500).json({ _ok: false, error: e.message });
    }
});

/**
 * GET /channels/:id/chats - Liste des chats WhatsApp
 * FIX : route manquante appelée par PHP getNodeChats()
 */
app.get('/channels/:id/chats', authMiddleware, async (req, res) => {
    try {
        const result = await getChats(req.params.id);
        res.json(result);
    } catch (e) {
        res.status(500).json({ _ok: false, chats: [], error: e.message });
    }
});

/**
 * GET /channels/:id/chats/:chatId/messages - Historique d'un chat
 * FIX : route manquante appelée par PHP getMessages()
 */
app.get('/channels/:id/chats/:chatId/messages', authMiddleware, async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    try {
        const result = await getMessages(req.params.id, decodeURIComponent(req.params.chatId), limit);
        res.json(result);
    } catch (e) {
        res.status(500).json({ _ok: false, messages: [], error: e.message });
    }
});

/**
 * GET /channels/:id/contacts - Liste des contacts
 * FIX : route manquante appelée par PHP getContacts() / syncContactsFromNode()
 */
app.get('/channels/:id/contacts', authMiddleware, async (req, res) => {
    try {
        const result = await getContacts(req.params.id);
        res.json(result);
    } catch (e) {
        res.status(500).json({ _ok: false, contacts: [], error: e.message });
    }
});

/** POST /cleanup - Nettoyage des instances déconnectées */
app.post('/cleanup', authMiddleware, async (req, res) => {
    const mode = req.body.mode || 'disconnected';
    let count = 0;
    for (const [id, inst] of sessions.entries()) {
        if (mode === 'all' || inst.status === 'disconnected') {
            try { await inst.sock.end(); } catch (e) {}
            sessions.delete(id);
            count++;
        }
    }
    res.json({ _ok: true, cleaned: count });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Engine Baileys running on port ${PORT}`));
