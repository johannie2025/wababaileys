const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Stockage des instances actives en mémoire
const sessions = new Map();

/**
 * Envoie les données au SaaS PHP
 */
async function pushToWebhook(url, data) {
    try {
        await axios.post(url, data, { 
            headers: { 'Authorization': `Bearer ${process.env.NODE_API_KEY}` } 
        });
    } catch (e) {
        console.error(`[Webhook Error] ${e.message}`);
    }
}

/**
 * Initialise ou récupère une connexion Baileys pour un canal spécifique
 */
async function getSession(channelId, webhookUrl = null) {
    if (sessions.has(channelId)) return sessions.get(channelId);

    const sessionDir = path.join(__dirname, 'sessions', channelId);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: state,
        logger: pino({ level: 'silent' }),
    });

    const instance = {
        sock,
        qr: null,
        status: 'connecting',
        lastError: null
    };

    sessions.set(channelId, instance);

// Gestion des événements de connexion
sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    // 1. Détection du QR Code
    if (qr) {
        console.log(`[QR] Nouveau code généré pour le canal : ${channelId}`);
        instance.qr = qr;
        // FIX : On passe au statut 'qr' pour que le frontend (connect.php)
        // puisse sortir du mode placeholder et afficher l'image.
        instance.status = 'qr'; 
    }

    // 2. Gestion des fermetures de connexion
    if (connection === 'close') {
        const statusCode = lastDisconnect.error?.output?.statusCode;
        const reason = lastDisconnect.error?.message || 'Inconnue';
        
        console.log(`[CLOSE] Canal ${channelId} fermé. Raison: ${reason} (Code: ${statusCode})`);

        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        instance.status = 'disconnected';
        instance.qr = null;

        if (shouldReconnect) {
            console.log(`[RETRY] Tentative de reconnexion pour : ${channelId}...`);
            sessions.delete(channelId);
            // Délai de 3s pour ménager les ressources sur Render[cite: 3].
            setTimeout(() => getSession(channelId, webhookUrl), 3000);
        } else {
            console.log(`[LOGOUT] Déconnexion définitive pour : ${channelId}.`);
            // Notifier le webhook PHP de la déconnexion.
            if (webhookUrl) {
                pushToWebhook(webhookUrl, { event: 'channel.disconnected', data: { channelId } });
            }
        }
    } 
    
    // 3. Connexion réussie
    else if (connection === 'open') {
        console.log(`[SUCCESS] Canal ${channelId} connecté avec succès !`);
        // FIX : 'CONNECTED' en majuscule pour correspondre à la logique de UserController.php[cite: 1].
        instance.status = 'CONNECTED'; 
        instance.qr = null;

        // Optionnel : Notifier le serveur PHP immédiatement
        if (webhookUrl) {
            pushToWebhook(webhookUrl, { 
                event: 'channel.connected', 
                data: { channelId, phone: sock.user.id.split(':')[0] } 
            });
        }
    }
});

sock.ev.on('creds.update', saveCreds);

// Gestion des messages entrants[cite: 3]
sock.ev.on('messages.upsert', async (m) => {
    if (m.type === 'notify' && webhookUrl) {
        pushToWebhook(webhookUrl, {
            channelId,
            event: 'messages.upsert',
            data: m
        });
    }
});

if (qr) {
    instance.qr = qr; // C'est cette variable que la route doit lire
    instance.status = 'qr'; // Indispensable pour le frontend JS[cite: 2]
}

/**
 * Envoi de message texte compatible avec ton client PHP
 */
async function sendText(channelId, to, message) {
    const instance = sessions.get(channelId);
    if (!instance || instance.status !== 'connected') throw new Error('Canal non connecté');
    
    const jid = to.includes('@') ? to : `${to.replace('+', '')}@s.whatsapp.net`;
    return await instance.sock.sendMessage(jid, { text: message });
}

/**
 * Envoie un média depuis un base64 (Image, Vidéo, Document)[cite: 2]
 */
async function sendMedia(channelId, { to, base64, mimetype, caption, filename }) {
    const instance = sessions.get(channelId);
    if (!instance || instance.status !== 'connected') throw new Error('Canal non connecté');

    const jid = to.includes('@') ? to : `${to.replace('+', '')}@s.whatsapp.net`;
    const buffer = Buffer.from(base64, 'base64');
    
    let content = {};
    if (mimetype.startsWith('image/')) {
        content = { image: buffer, caption };
    } else if (mimetype.startsWith('video/')) {
        content = { video: buffer, caption };
    } else if (mimetype.startsWith('audio/')) {
        content = { audio: buffer, mimetype };
    } else {
        content = { document: buffer, mimetype, fileName: filename, caption };
    }

    return await instance.sock.sendMessage(jid, content);
}

/**
 * Déconnexion et nettoyage des fichiers[cite: 2]
 */
async function logout(channelId) {
    const instance = sessions.get(channelId);
    if (instance) {
        try { await instance.sock.logout(); } catch (e) {}
        sessions.delete(channelId);
        const sessionDir = path.join(__dirname, 'sessions', channelId);
        if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });
        return { _ok: true };
    }
    return { _ok: false, error: 'Instance non trouvée' };
}

// Exportation de TOUTES les fonctions nécessaires pour index.js[cite: 2]
module.exports = { getSession, sendText, sendMedia, logout, sessions };
