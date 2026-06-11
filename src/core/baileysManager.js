// src/core/baileysManager.js — Wise OS Baileys Engine Enterprise v2
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidGroup,
  isJidBroadcast,
  getContentType,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');
const pino    = require('pino');
const fs      = require('fs');
const path    = require('path');
const { useSupabaseAuthState } = require('./sessionManager');
const antiBan = require('./antiBan');

const logger = pino({ level: 'silent' });

class BaileysManager {
  constructor() {
    // Map: sessionId → { sock, status, qr, user, lastActivity }
    this.instances = new Map();
    this._webhookHandlers = new Map(); // sessionId → callback
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  jid(to) {
    if (!to) return null;
    const clean = String(to).replace(/[^0-9@.\-_]/g, '');
    if (clean.includes('@')) return clean;
    if (clean.includes('-') || clean.length > 15) return `${clean}@g.us`;
    return `${clean}@s.whatsapp.net`;
  }

  // ─── Session Management ───────────────────────────────────────────────────
  async getInstance(sessionId) {
    if (this.instances.has(sessionId)) return this.instances.get(sessionId);

    console.log(`[Baileys] 🚀 Init session: ${sessionId}`);
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useSupabaseAuthState(sessionId);

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      browser: ['Wise OS', 'Chrome', '120.0.0.0']
    });

    const instance = {
      sock, status: 'initializing', qr: null,
      user: null, lastActivity: Date.now()
    };
    this.instances.set(sessionId, instance);

    // ── Connection events ─────────────────────────────────────────────────
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      const inst = this.instances.get(sessionId);
      if (!inst) return;

      if (qr) { inst.qr = qr; inst.status = 'pending_qr'; }

      if (connection === 'open') {
        inst.status = 'connected'; inst.qr = null;
        inst.user = sock.user; inst.lastActivity = Date.now();
        console.log(`✅ [${sessionId}] Connecté: ${sock.user?.id}`);
        this._notifyWebhook(sessionId, 'connection', { status: 'connected', user: sock.user });
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        inst.status = 'disconnected';
        this.instances.delete(sessionId);
        if (code !== DisconnectReason.loggedOut) {
          console.log(`🔄 [${sessionId}] Reconnexion dans 5s...`);
          setTimeout(() => this.getInstance(sessionId), 5000);
        } else {
          console.log(`🚪 [${sessionId}] Logout définitif`);
          this._notifyWebhook(sessionId, 'connection', { status: 'logged_out' });
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // ── Incoming messages ─────────────────────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        const processed = await this._processMessage(sessionId, msg, sock);
        this._notifyWebhook(sessionId, 'message', processed);
      }
    });

    // ── Message status updates (delivered/read) ───────────────────────────
    sock.ev.on('messages.update', updates => {
      for (const upd of updates) {
        this._notifyWebhook(sessionId, 'message_status', {
          id: upd.key.id, jid: upd.key.remoteJid, status: upd.update?.status
        });
      }
    });

    // ── Contacts sync ─────────────────────────────────────────────────────
    sock.ev.on('contacts.update', updates => {
      this._notifyWebhook(sessionId, 'contacts_update', updates);
    });

    // ── Group updates ─────────────────────────────────────────────────────
    sock.ev.on('groups.update', updates => {
      this._notifyWebhook(sessionId, 'groups_update', updates);
    });

    return instance;
  }

  // ─── Message processor (extrait type + media info) ────────────────────────
  async _processMessage(sessionId, msg, sock) {
    const jid  = msg.key.remoteJid;
    const type = getContentType(msg.message);
    const base = {
      sessionId,
      id:        msg.key.id,
      jid,
      from:      jid,
      isGroup:   isJidGroup(jid),
      pushName:  msg.pushName || '',
      timestamp: msg.messageTimestamp,
      type
    };

    // Text
    if (type === 'conversation' || type === 'extendedTextMessage') {
      base.text = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text || '';
    }

    // Image / Video / Audio / Document / Sticker
    const mediaTypes = ['imageMessage','videoMessage','audioMessage','documentMessage','stickerMessage'];
    if (mediaTypes.includes(type)) {
      const mediaMsg = msg.message?.[type];
      base.caption  = mediaMsg?.caption || '';
      base.mimetype = mediaMsg?.mimetype || '';
      base.fileName = mediaMsg?.fileName || '';
      base.mediaUrl = null; // sera rempli si download demandé
    }

    // Location
    if (type === 'locationMessage') {
      base.location = {
        lat: msg.message.locationMessage.degreesLatitude,
        lng: msg.message.locationMessage.degreesLongitude,
        name: msg.message.locationMessage.name || ''
      };
    }

    // Contact
    if (type === 'contactMessage') {
      base.contact = msg.message.contactMessage;
    }

    // Reaction
    if (type === 'reactionMessage') {
      base.reaction = {
        targetId: msg.message.reactionMessage.key?.id,
        emoji: msg.message.reactionMessage.text
      };
    }

    return base;
  }

  // ─── Safe send (anti-ban wrapper) ────────────────────────────────────────
  async _safeSend(sessionId, to, payload, text = '') {
    const jidTo = this.jid(to);
    const inst  = await this.getInstance(sessionId);
    if (inst.status !== 'connected')
      throw new Error(`Session ${sessionId} non connectée (status: ${inst.status})`);

    const { ok } = await antiBan.canSend(sessionId, jidTo);
    if (!ok) return { ok: false, error: 'Rate limit atteint', willRetry: true };

    await antiBan.simulateHuman(inst.sock, jidTo, text);
    const result = await inst.sock.sendMessage(jidTo, payload);
    inst.lastActivity = Date.now();
    return { ok: true, messageId: result.key.id, jid: jidTo };
  }

  // ─── Download media from incoming message ─────────────────────────────────
  async downloadMedia(sessionId, msg) {
    const inst = await this.getInstance(sessionId);
    const type = getContentType(msg.message);
    const buf  = await downloadMediaMessage(msg, 'buffer', {}, {
      logger, reuploadRequest: inst.sock.updateMediaMessage
    });
    return { buffer: buf, mimetype: msg.message?.[type]?.mimetype || 'application/octet-stream' };
  }

  // ─── SEND METHODS ─────────────────────────────────────────────────────────

  async sendText(sessionId, to, text, options = {}) {
    const payload = { text };
    // Quote / reply
    if (options.quotedId) {
      payload.quoted = { key: { id: options.quotedId, remoteJid: this.jid(to) } };
    }
    // Link preview
    if (options.linkPreview) payload.linkPreview = options.linkPreview;
    return this._safeSend(sessionId, to, payload, text);
  }

  async sendMedia(sessionId, to, buffer, type = 'image', caption = '', opts = {}) {
    const jidTo = this.jid(to);
    const typeMap = {
      image:    { image: buffer, caption, ...opts },
      video:    { video: buffer, caption, ...opts },
      audio:    { audio: buffer, ptt: opts.ptt ?? false, mimetype: opts.mimetype || 'audio/mpeg', ...opts },
      sticker:  { sticker: buffer, ...opts },
      document: { document: buffer, caption, mimetype: opts.mimetype || 'application/octet-stream', fileName: opts.fileName || 'file', ...opts }
    };
    return this._safeSend(sessionId, to, typeMap[type] || typeMap.document, caption);
  }

  async sendPoll(sessionId, to, name, values, selectableCount = 1) {
    return this._safeSend(sessionId, to,
      { poll: { name, values, selectableOptionsCount: selectableCount } }, name);
  }

  async sendReaction(sessionId, to, messageId, emoji) {
    const jidTo = this.jid(to);
    return this._safeSend(sessionId, to, {
      react: { text: emoji, key: { id: messageId, remoteJid: jidTo, fromMe: false } }
    });
  }

  async sendLocation(sessionId, to, lat, lng, name = '', address = '') {
    return this._safeSend(sessionId, to, {
      location: { degreesLatitude: +lat, degreesLongitude: +lng, name, address }
    });
  }

  async sendContact(sessionId, to, contacts) {
    // contacts: [{ fullName, phone }]
    const vCards = contacts.map(c =>
      `BEGIN:VCARD\nVERSION:3.0\nFN:${c.fullName}\nTEL;type=CELL:${c.phone}\nEND:VCARD`
    );
    const payload = contacts.length === 1
      ? { contacts: { displayName: contacts[0].fullName, contacts: [{ vcard: vCards[0] }] } }
      : { contacts: { displayName: `${contacts.length} contacts`, contacts: vCards.map(v => ({ vcard: v })) } };
    return this._safeSend(sessionId, to, payload);
  }

  async sendButtons(sessionId, to, text, buttons, footer = '') {
    // Buttons: [{ id, text }]
    return this._safeSend(sessionId, to, {
      buttons: buttons.map(b => ({ buttonId: b.id, buttonText: { displayText: b.text }, type: 1 })),
      text, footer, headerType: 1
    }, text);
  }

  async sendList(sessionId, to, title, text, buttonText, sections) {
    return this._safeSend(sessionId, to, {
      listMessage: { title, text, footerText: '', buttonText, listType: 1, sections }
    }, text);
  }

  // ─── GROUPS ───────────────────────────────────────────────────────────────

  async getGroups(sessionId) {
    const inst = await this.getInstance(sessionId);
    if (inst.status !== 'connected') throw new Error('Non connecté');
    const groups = await inst.sock.groupFetchAllParticipating();
    return Object.values(groups).map(g => ({
      id: g.id, subject: g.subject, desc: g.desc || '',
      owner: g.owner, size: g.participants?.length || 0,
      creation: g.creation,
      participants: g.participants?.map(p => ({ id: p.id, admin: p.admin || null })) || []
    }));
  }

  async getGroupMeta(sessionId, groupJid) {
    const inst = await this.getInstance(sessionId);
    const meta = await inst.sock.groupMetadata(groupJid);
    return {
      id: meta.id, subject: meta.subject, desc: meta.desc || '',
      owner: meta.owner, creation: meta.creation,
      participants: meta.participants.map(p => ({
        id: p.id, admin: p.admin, superAdmin: p.superAdmin
      })),
      inviteCode: await inst.sock.groupInviteCode(groupJid).catch(() => null)
    };
  }

  async createGroup(sessionId, subject, participants) {
    const inst = await this.getInstance(sessionId);
    const result = await inst.sock.groupCreate(subject, participants.map(p => this.jid(p)));
    return { ok: true, groupJid: result.gid, subject };
  }

  async addGroupParticipant(sessionId, groupJid, participants) {
    const inst = await this.getInstance(sessionId);
    const res = await inst.sock.groupParticipantsUpdate(
      groupJid, participants.map(p => this.jid(p)), 'add'
    );
    return { ok: true, results: res };
  }

  async removeGroupParticipant(sessionId, groupJid, participants) {
    const inst = await this.getInstance(sessionId);
    const res = await inst.sock.groupParticipantsUpdate(
      groupJid, participants.map(p => this.jid(p)), 'remove'
    );
    return { ok: true, results: res };
  }

  async promoteGroupParticipant(sessionId, groupJid, participants) {
    const inst = await this.getInstance(sessionId);
    await inst.sock.groupParticipantsUpdate(
      groupJid, participants.map(p => this.jid(p)), 'promote'
    );
    return { ok: true };
  }

  async leaveGroup(sessionId, groupJid) {
    const inst = await this.getInstance(sessionId);
    await inst.sock.groupLeave(groupJid);
    return { ok: true };
  }

  async updateGroupSubject(sessionId, groupJid, subject) {
    const inst = await this.getInstance(sessionId);
    await inst.sock.groupUpdateSubject(groupJid, subject);
    return { ok: true };
  }

  async updateGroupDescription(sessionId, groupJid, desc) {
    const inst = await this.getInstance(sessionId);
    await inst.sock.groupUpdateDescription(groupJid, desc);
    return { ok: true };
  }

  async getGroupInviteLink(sessionId, groupJid) {
    const inst = await this.getInstance(sessionId);
    const code = await inst.sock.groupInviteCode(groupJid);
    return { ok: true, link: `https://chat.whatsapp.com/${code}`, code };
  }

  // ─── CONTACTS & CHATS ─────────────────────────────────────────────────────

  async getContacts(sessionId) {
    const inst = await this.getInstance(sessionId);
    const store = inst.sock.store;
    if (store?.contacts) {
      return Object.values(store.contacts).map(c => ({
        id: c.id, name: c.name || c.notify || '', phone: c.id.split('@')[0]
      }));
    }
    return [];
  }

  async checkPhone(sessionId, phones) {
    const inst = await this.getInstance(sessionId);
    const results = await inst.sock.onWhatsApp(...phones.map(p => this.jid(p)));
    return results.map(r => ({ jid: r.jid, exists: r.exists }));
  }

  async getProfilePicture(sessionId, jidTo) {
    const inst = await this.getInstance(sessionId);
    try {
      const url = await inst.sock.profilePictureUrl(this.jid(jidTo), 'image');
      return { ok: true, url };
    } catch {
      return { ok: true, url: null };
    }
  }

  async updateProfileStatus(sessionId, status) {
    const inst = await this.getInstance(sessionId);
    await inst.sock.updateProfileStatus(status);
    return { ok: true };
  }

  // ─── STATUS (Stories) ─────────────────────────────────────────────────────

  async sendStatus(sessionId, type, content, caption = '') {
    const inst = await this.getInstance(sessionId);
    let payload;
    if (type === 'text') {
      payload = {
        text: content,
        font: 3,
        backgroundColor: '#075E54',
        statusJidList: ['status@broadcast']
      };
    } else {
      // image/video buffer
      payload = type === 'image'
        ? { image: content, caption }
        : { video: content, caption };
    }
    const result = await inst.sock.sendMessage('status@broadcast', payload);
    return { ok: true, messageId: result.key.id };
  }

  // ─── SESSION CONTROL ─────────────────────────────────────────────────────

  async getQR(sessionId) {
    const inst = await this.getInstance(sessionId);
    if (inst.qr) {
      const QRCode = require('qrcode');
      const qrBase64 = await QRCode.toDataURL(inst.qr);
      return { ok: true, qr: inst.qr, qrBase64, status: inst.status };
    }
    return { ok: true, qr: null, status: inst.status };
  }

  getStatus(sessionId) {
    const inst = this.instances.get(sessionId);
    return {
      ok: true,
      status: inst?.status || 'not_initialized',
      connected: inst?.status === 'connected',
      user: inst?.user ? { id: inst.user.id, name: inst.user.name } : null,
      lastActivity: inst?.lastActivity || null
    };
  }

  getAllSessions() {
    const sessions = [];
    for (const [id, inst] of this.instances) {
      sessions.push({
        sessionId: id, status: inst.status,
        user: inst.user ? { id: inst.user.id, name: inst.user.name } : null,
        lastActivity: inst.lastActivity
      });
    }
    return sessions;
  }

  async logout(sessionId) {
    const inst = this.instances.get(sessionId);
    if (inst?.sock) {
      try { await inst.sock.logout(); } catch {}
    }
    this.instances.delete(sessionId);
    // Supprimer session Supabase
    const supabase = require('../utils/supabaseClient');
    await supabase.from('whatsapp_sessions').delete().eq('session_id', sessionId);
    return { ok: true };
  }

  async restartSession(sessionId) {
    await this.logout(sessionId);
    await new Promise(r => setTimeout(r, 2000));
    await this.getInstance(sessionId);
    return { ok: true };
  }

  // ─── WEBHOOK INTERNAL BUS ────────────────────────────────────────────────
  onWebhook(sessionId, cb) { this._webhookHandlers.set(sessionId, cb); }
  _notifyWebhook(sessionId, event, data) {
    const cb = this._webhookHandlers.get(sessionId)
      || this._webhookHandlers.get('*');
    if (cb) cb({ sessionId, event, data, timestamp: Date.now() });
  }

  // ─── READ MESSAGES ────────────────────────────────────────────────────────
  async markAsRead(sessionId, jidTo, messageIds = []) {
    const inst = await this.getInstance(sessionId);
    await inst.sock.readMessages(messageIds.map(id => ({
      remoteJid: this.jid(jidTo), id, fromMe: false
    })));
    return { ok: true };
  }
}

module.exports = new BaileysManager();
