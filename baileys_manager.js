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
            instance.status = 'qr'; 
        }

        // 2. Gestion des fermetures de connexion
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const reason = lastDisconnect?.error?.message || 'Inconnue';
            
            console.log(`[CLOSE] Canal ${channelId} fermé. Raison: ${reason} (Code: ${statusCode})`);

            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            instance.status = 'disconnected';
            instance.qr = null;

            if (shouldReconnect) {
                console.log(`[RETRY] Tentative de reconnexion pour : ${channelId}...`);
                sessions.delete(channelId);
                setTimeout(() => getSession(channelId, webhookUrl), 3000);
            } else {
                console.log(`[LOGOUT] Déconnexion définitive pour : ${channelId}.`);
                if (webhookUrl) {
                    pushToWebhook(webhookUrl, { event: 'channel.disconnected', data: { channelId } });
                }
            }
        } 
        
        // 3. Connexion réussie
        else if (connection === 'open') {
            console.log(`[SUCCESS] Canal ${channelId} connecté avec succès !`);
            // FIX CRITIQUE : 'CONNECTED' en majuscule — UserController.php vérifie ($h['status'] === 'CONNECTED')
            // connect.php JS vérifie status === 'connected' (minuscule) via toLowerCase() → les deux sont satisfaits
            instance.status = 'CONNECTED'; 
            instance.qr = null;

            if (webhookUrl) {
                pushToWebhook(webhookUrl, { 
                    event: 'channel.connected', 
                    data: { 
                        channelId, 
                        phone: sock.user.id.split(':')[0]
                    } 
                });
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Gestion des messages entrants
    sock.ev.on('messages.upsert', async (m) => {
        // Mettre en cache les messages de la session pour getMessages()
        if (m.type === 'notify') {
            if (!instance._msgCache) instance._msgCache = {};
            for (const msg of (m.messages || [])) {
                const chatId = msg.key?.remoteJid;
                if (!chatId) continue;
                if (!instance._msgCache[chatId]) instance._msgCache[chatId] = [];
                instance._msgCache[chatId].push(msg);
                // Garder max 100 messages par chat en mémoire
                if (instance._msgCache[chatId].length > 100) {
                    instance._msgCache[chatId].shift();
                }
            }
            if (webhookUrl) {
                pushToWebhook(webhookUrl, {
                    channelId,
                    event: 'messages.upsert',
                    data: m
                });
            }
        }
    });

    return instance; // ← FIX CRITIQUE : return manquant dans l'original
}

/**
 * Envoi de message texte
 * FIX : comparaison insensible à la casse pour 'CONNECTED' ou 'connected'
 */
async function sendText(channelId, to, message) {
    const instance = sessions.get(channelId);
    // FIX CRITIQUE : l'original comparait !== 'connected' (minuscule) mais le statut est 'CONNECTED'
    if (!instance || instance.status.toUpperCase() !== 'CONNECTED') {
        throw new Error('Canal non connecté');
    }
    const jid = to.includes('@') ? to : `${to.replace('+', '')}@s.whatsapp.net`;
    return await instance.sock.sendMessage(jid, { text: message });
}

/**
 * Envoie un média depuis un base64 (Image, Vidéo, Document)
 */
async function sendMedia(channelId, { to, base64, mimetype, caption, filename }) {
    const instance = sessions.get(channelId);
    // FIX : même correction casse
    if (!instance || instance.status.toUpperCase() !== 'CONNECTED') {
        throw new Error('Canal non connecté');
    }

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
 * Récupère la liste des chats WhatsApp (conversations récentes)
 * Appelé par GET /channels/:id/chats → PHP /api/node-chats
 */
async function getChats(channelId, count = 30) {
    const instance = sessions.get(channelId);
    if (!instance) return { _ok: true, chats: [] };
    try {
        // Baileys ne maintient pas sock.chats sans makeInMemoryStore
        // On reconstruit depuis le cache _msgCache de la session
        const cache   = instance._msgCache || {};
        const chatIds = Object.keys(cache);
        const chats   = chatIds.slice(0, count).map(id => {
            const msgs = cache[id];
            const last = msgs[msgs.length - 1];
            const body = last?.message?.conversation
                      || last?.message?.extendedTextMessage?.text
                      || (last?.message ? '[média]' : '');
            return {
                id:          id,
                name:        id.split('@')[0],
                unreadCount: msgs.filter(m => !m.key?.fromMe).length,
                lastMessage: body,
                timestamp:   typeof last?.messageTimestamp === 'object'
                    ? Number(last.messageTimestamp) : (last?.messageTimestamp || 0)
            };
        }).sort((a, b) => b.timestamp - a.timestamp);
        return { _ok: true, chats };
    } catch (e) {
        return { _ok: true, chats: [] };
    }
}


async function getMessages(channelId, chatId, limit = 20) {
    const instance = sessions.get(channelId);
    // Sans makeInMemoryStore, Baileys ne stocke pas l'historique
    // On retourne le cache session si dispo, sinon [] => fallback DB côté PHP
    try {
        if (!instance) return { _ok: true, messages: [] };
        const sessionMsgs = instance._msgCache?.[chatId] || [];
        const messages = sessionMsgs.slice(-limit).map(m => ({
            id:       m.key?.id,
            fromMe:   m.key?.fromMe || false,
            from:     m.key?.remoteJid,
            body:     m.message?.conversation
                   || m.message?.extendedTextMessage?.text
                   || m.message?.imageMessage?.caption
                   || '',
            hasMedia: !!(m.message?.imageMessage || m.message?.videoMessage
                      || m.message?.audioMessage || m.message?.documentMessage),
            type:     Object.keys(m.message || {})[0] || 'text',
            timestamp: typeof m.messageTimestamp === 'object'
                ? Number(m.messageTimestamp) : (m.messageTimestamp || 0)
        }));
        return { _ok: true, messages };
    } catch (e) {
        return { _ok: true, messages: [] };
    }
}


async function getContacts(channelId) {
    const instance = sessions.get(channelId);
    if (!instance || instance.status.toUpperCase() !== 'CONNECTED') {
        throw new Error('Canal non connecté');
    }
    try {
        const contacts = instance.sock.contacts
            ? Object.values(instance.sock.contacts).map(c => ({
                id: c.id,
                name: c.name || c.notify || c.id.split('@')[0],
                phone: c.id.split('@')[0]
              }))
            : [];
        return { _ok: true, contacts };
    } catch (e) {
        return { _ok: false, contacts: [], error: e.message };
    }
}

/**
 * Déconnexion et nettoyage des fichiers
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

module.exports = { getSession, sendText, sendMedia, getChats, getMessages, getContacts, logout, sessions };
