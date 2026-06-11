// src/core/baileysManager.js — Wise OS Baileys Engine Enterprise v2.1
// Aligned with @whiskeysockets/baileys feature checklist
// ✅ Multi-device, messages, media, groups, contacts, polls, reactions,
//    mentions, mute/block, channels, status, profile, communities-ready
// ❌ Buttons/Lists DEPRECATED — removed
'use strict';
require('dotenv').config();
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidGroup,
  isJidStatusBroadcast,
  getContentType,
  downloadMediaMessage,
  makeInMemoryStore,
} = require('@whiskeysockets/baileys');
const pino   = require('pino');
const QRCode = require('qrcode');
const { useSupabaseAuthState } = require('./sessionManager');
const antiBan = require('./antiBan');

const logger = pino({ level: 'silent' });

class BaileysManager {
  constructor() {
    this.instances = new Map(); // sessionId → {sock,store,status,qr,user,lastActivity}
    this._webhookHandlers = new Map();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  jid(to) {
    if (!to) throw new Error('JID requis');
    const s = String(to).trim();
    if (s.includes('@')) return s;
    const clean = s.replace(/[^0-9]/g, '');
    if (s.includes('-') || clean.length > 15) return `${clean}@g.us`;
    return `${clean}@s.whatsapp.net`;
  }
  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Session lifecycle ─────────────────────────────────────────────────────
  async getInstance(sessionId) {
    if (this.instances.has(sessionId)) return this.instances.get(sessionId);
    console.log(`[Baileys] Init: ${sessionId}`);
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useSupabaseAuthState(sessionId);
    const store = makeInMemoryStore({ logger });
    const sock  = makeWASocket({
      version, auth: state, logger,
      printQRInTerminal: false, markOnlineOnConnect: false,
      syncFullHistory: false, generateHighQualityLinkPreview: true,
      browser: ['Wise OS Enterprise','Chrome','124.0.0'],
      getMessage: async key => store.messages[key.remoteJid]?.get(key.id)?.message || { conversation:'' }
    });
    store.bind(sock.ev);
    const instance = { sock, store, status:'initializing', qr:null, user:null, lastActivity:Date.now() };
    this.instances.set(sessionId, instance);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      const inst = this.instances.get(sessionId);
      if (!inst) return;
      if (qr) { inst.qr = qr; inst.status = 'pending_qr'; this._notify(sessionId,'qr',{qr}); }
      if (connection === 'open') {
        inst.status = 'connected'; inst.qr = null; inst.user = sock.user; inst.lastActivity = Date.now();
        console.log(`✅ [${sessionId}] ${sock.user?.id}`);
        this._notify(sessionId, 'connection', { status:'connected', user:sock.user });
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        inst.status = 'disconnected'; this.instances.delete(sessionId);
        this._notify(sessionId, 'connection', { status: code===DisconnectReason.loggedOut?'logged_out':'disconnected' });
        if (code !== DisconnectReason.loggedOut) { await this._delay(5000); this.getInstance(sessionId).catch(()=>{}); }
      }
    });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        this._notify(sessionId, 'message', this._parse(sessionId, msg));
        instance.lastActivity = Date.now();
      }
    });
    sock.ev.on('messages.update', updates => {
      for (const u of updates) {
        if (u.update?.pollUpdates) this._notify(sessionId,'poll_vote',{ messageId:u.key.id, jid:u.key.remoteJid, votes:u.update.pollUpdates });
        else this._notify(sessionId,'message_status',{ id:u.key.id, jid:u.key.remoteJid, status:u.update?.status });
      }
    });
    sock.ev.on('messages.reaction', r => this._notify(sessionId,'reaction',r));
    sock.ev.on('contacts.update',  u => this._notify(sessionId,'contacts_update',u));
    sock.ev.on('contacts.upsert',  u => this._notify(sessionId,'contacts_upsert',u));
    sock.ev.on('groups.update',    u => this._notify(sessionId,'groups_update',u));
    sock.ev.on('group-participants.update', u => this._notify(sessionId,'group_participants',u));
    sock.ev.on('presence.update',  u => this._notify(sessionId,'presence',u));
    return instance;
  }

  // ── Message parser ────────────────────────────────────────────────────────
  _parse(sessionId, msg) {
    const jid  = msg.key.remoteJid;
    const type = getContentType(msg.message) || 'unknown';
    const m    = msg.message;
    const base = { sessionId, id:msg.key.id, jid, from:jid, fromMe:msg.key.fromMe,
      isGroup:isJidGroup(jid), isStatus:isJidStatusBroadcast(jid),
      pushName:msg.pushName||'', timestamp:msg.messageTimestamp, type };
    switch(type) {
      case 'conversation': base.text = m.conversation; break;
      case 'extendedTextMessage':
        base.text = m.extendedTextMessage?.text;
        base.mentions = m.extendedTextMessage?.contextInfo?.mentionedJid||[];
        break;
      case 'imageMessage':    base.caption=m.imageMessage?.caption||''; base.mimetype=m.imageMessage?.mimetype; base.hasMedia=true; break;
      case 'videoMessage':    base.caption=m.videoMessage?.caption||''; base.mimetype=m.videoMessage?.mimetype; base.duration=m.videoMessage?.seconds; base.hasMedia=true; break;
      case 'audioMessage':    base.ptt=m.audioMessage?.ptt; base.duration=m.audioMessage?.seconds; base.mimetype=m.audioMessage?.mimetype; base.hasMedia=true; break;
      case 'documentMessage': base.fileName=m.documentMessage?.fileName; base.mimetype=m.documentMessage?.mimetype; base.hasMedia=true; break;
      case 'stickerMessage':  base.isAnimated=m.stickerMessage?.isAnimated; base.hasMedia=true; break;
      case 'locationMessage': base.location={lat:m.locationMessage?.degreesLatitude,lng:m.locationMessage?.degreesLongitude,name:m.locationMessage?.name||'',address:m.locationMessage?.address||''}; break;
      case 'liveLocationMessage': base.location={lat:m.liveLocationMessage?.degreesLatitude,lng:m.liveLocationMessage?.degreesLongitude,live:true}; break;
      case 'contactMessage':       base.contact=m.contactMessage; break;
      case 'contactsArrayMessage': base.contacts=m.contactsArrayMessage?.contacts; break;
      case 'reactionMessage': base.reaction={targetId:m.reactionMessage?.key?.id,emoji:m.reactionMessage?.text}; break;
      case 'pollCreationMessage':
      case 'pollCreationMessageV2':
      case 'pollCreationMessageV3':
        base.poll={name:m[type]?.name,options:m[type]?.options?.map(o=>o.optionName)}; break;
    }
    return base;
  }

  // ── Safe send ─────────────────────────────────────────────────────────────
  async _send(sessionId, to, payload, hint='') {
    const jidTo = this.jid(to);
    const inst  = await this.getInstance(sessionId);
    if (inst.status !== 'connected') throw new Error(`Session non connectée (${inst.status})`);
    const { ok } = await antiBan.canSend(sessionId, jidTo);
    if (!ok) return { ok:false, error:'Rate limit', willRetry:true };
    await antiBan.simulateHuman(inst.sock, jidTo, hint);
    const res = await inst.sock.sendMessage(jidTo, payload);
    inst.lastActivity = Date.now();
    return { ok:true, messageId:res.key.id, jid:jidTo, timestamp:res.messageTimestamp };
  }

  // ── ✅ TEXT ───────────────────────────────────────────────────────────────
  async sendText(sessionId, to, text, opts={}) {
    const payload = { text:String(text), linkPreview:opts.linkPreview!==false };
    if (opts.mentions?.length) payload.mentions = opts.mentions.map(m=>this.jid(m));
    if (opts.quotedId) {
      const inst = await this.getInstance(sessionId);
      const q = inst.store.messages[this.jid(to)]?.get(opts.quotedId);
      if (q) payload.quoted = q;
    }
    return this._send(sessionId, to, payload, text);
  }

  // ── ✅ MEDIA ──────────────────────────────────────────────────────────────
  async sendMedia(sessionId, to, buffer, type='image', caption='', opts={}) {
    if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
    const extras = opts.mentions?.length ? { mentions: opts.mentions.map(m=>this.jid(m)) } : {};
    const map = {
      image:    { image:buffer,    caption, mimetype:opts.mimetype, ...extras },
      video:    { video:buffer,    caption, mimetype:opts.mimetype, gifPlayback:opts.gif||false },
      audio:    { audio:buffer,    ptt:opts.ptt??false, mimetype:opts.mimetype||'audio/mpeg' },
      sticker:  { sticker:buffer },
      document: { document:buffer, caption, mimetype:opts.mimetype||'application/octet-stream', fileName:opts.fileName||'file' }
    };
    if (!map[type]) throw new Error(`Type inconnu: ${type}`);
    return this._send(sessionId, to, map[type], caption);
  }

  async downloadMedia(sessionId, rawMsg) {
    const inst = await this.getInstance(sessionId);
    const type = getContentType(rawMsg.message);
    const buf  = await downloadMediaMessage(rawMsg,'buffer',{},{ logger, reuploadRequest:inst.sock.updateMediaMessage });
    return { buffer:buf, mimetype:rawMsg.message?.[type]?.mimetype||'application/octet-stream', type };
  }

  // ── ✅ POLL ───────────────────────────────────────────────────────────────
  async sendPoll(sessionId, to, name, values, selectableCount=1) {
    return this._send(sessionId, to, { poll:{ name:String(name), values:values.map(String), selectableOptionsCount:Math.max(1,Math.min(selectableCount,values.length)) }}, name);
  }

  // ── ✅ REACTION ───────────────────────────────────────────────────────────
  async sendReaction(sessionId, to, messageId, emoji) {
    return this._send(sessionId, to, { react:{ text:emoji||'', key:{ id:messageId, remoteJid:this.jid(to), fromMe:false }}});
  }

  // ── ✅ LOCATION ───────────────────────────────────────────────────────────
  async sendLocation(sessionId, to, lat, lng, name='', address='') {
    return this._send(sessionId, to, { location:{ degreesLatitude:+lat, degreesLongitude:+lng, name:String(name), address:String(address) }});
  }

  // ── ✅ CONTACT CARD ───────────────────────────────────────────────────────
  async sendContact(sessionId, to, contacts) {
    const cards = contacts.map(c => ({ vcard:`BEGIN:VCARD\nVERSION:3.0\nFN:${c.fullName||c.name}\nTEL;type=CELL:${c.phone}\n${c.org?'ORG:'+c.org+'\n':''}END:VCARD` }));
    const payload = contacts.length===1
      ? { contacts:{ displayName:contacts[0].fullName||contacts[0].name, contacts:cards }}
      : { contacts:{ displayName:`${contacts.length} contacts`, contacts:cards }};
    return this._send(sessionId, to, payload);
  }

  // ── ✅ MENTION ────────────────────────────────────────────────────────────
  async sendMention(sessionId, to, text, jids=[]) {
    return this.sendText(sessionId, to, text, { mentions:jids });
  }

  // ── ✅ READ ───────────────────────────────────────────────────────────────
  async markAsRead(sessionId, jidTo, messageIds=[]) {
    const inst = await this.getInstance(sessionId);
    await inst.sock.readMessages(messageIds.map(id=>({ remoteJid:this.jid(jidTo), id, fromMe:false })));
    return { ok:true };
  }

  // ── ✅ DELETE ─────────────────────────────────────────────────────────────
  async deleteMessage(sessionId, jidTo, messageId) {
    const inst = await this.getInstance(sessionId);
    await inst.sock.sendMessage(this.jid(jidTo), { delete:{ remoteJid:this.jid(jidTo), id:messageId, fromMe:true }});
    return { ok:true };
  }

  // ── ✅ FORWARD ────────────────────────────────────────────────────────────
  async forwardMessage(sessionId, to, fromJid, messageId) {
    const inst = await this.getInstance(sessionId);
    const msg  = inst.store.messages[fromJid]?.get(messageId);
    if (!msg) throw new Error('Message introuvable');
    await inst.sock.sendMessage(this.jid(to), { forward:msg, force:true });
    return { ok:true };
  }

  // ── ✅ MUTE / UNMUTE ──────────────────────────────────────────────────────
  async muteChat(sessionId, jidTo, durationMs=null) {
    const inst = await this.getInstance(sessionId);
    await inst.sock.chatModify({ mute: durationMs ? Date.now()+durationMs : null }, this.jid(jidTo));
    return { ok:true };
  }
  async unmuteChat(sessionId, jidTo) {
    const inst = await this.getInstance(sessionId);
    await inst.sock.chatModify({ mute:null }, this.jid(jidTo));
    return { ok:true };
  }

  // ── ✅ BLOCK / UNBLOCK ────────────────────────────────────────────────────
  async blockContact(sessionId, jidTo) {
    const inst = await this.getInstance(sessionId);
    await inst.sock.updateBlockStatus(this.jid(jidTo),'block');
    return { ok:true };
  }
  async unblockContact(sessionId, jidTo) {
    const inst = await this.getInstance(sessionId);
    await inst.sock.updateBlockStatus(this.jid(jidTo),'unblock');
    return { ok:true };
  }

  // ── ✅ CONTACTS & PROFILE ─────────────────────────────────────────────────
  async checkPhones(sessionId, phones) {
    const inst = await this.getInstance(sessionId);
    const r = await inst.sock.onWhatsApp(...phones.map(p=>this.jid(p)));
    return r.map(x=>({ jid:x.jid, exists:x.exists }));
  }
  async getContactInfo(sessionId, jidTo) {
    const inst = await this.getInstance(sessionId);
    const j = this.jid(jidTo);
    const [pic,status] = await Promise.allSettled([
      inst.sock.profilePictureUrl(j,'image'),
      inst.sock.fetchStatus(j)
    ]);
    return { jid:j, photo:pic.status==='fulfilled'?pic.value:null, status:status.status==='fulfilled'?status.value:null };
  }
  async getProfilePicture(sessionId, jidTo, hd=false) {
    const inst = await this.getInstance(sessionId);
    try { return { ok:true, url:await inst.sock.profilePictureUrl(this.jid(jidTo), hd?'image':'preview') }; }
    catch { return { ok:true, url:null }; }
  }
  async updateMyStatus(sessionId, status) {
    const inst = await this.getInstance(sessionId);
    await inst.sock.updateProfileStatus(status);
    return { ok:true };
  }
  async updateMyName(sessionId, name) {
    const inst = await this.getInstance(sessionId);
    await inst.sock.updateProfileName(name);
    return { ok:true };
  }
  async getContacts(sessionId) {
    const inst = await this.getInstance(sessionId);
    return Object.values(inst.store.contacts||{}).map(c=>({ id:c.id, name:c.name||c.notify||'', phone:c.id.split('@')[0] }));
  }
  async subscribePresence(sessionId, jidTo) {
    const inst = await this.getInstance(sessionId);
    await inst.sock.presenceSubscribe(this.jid(jidTo));
    return { ok:true };
  }

  // ── ✅ STATUS (Stories) ───────────────────────────────────────────────────
  async sendTextStatus(sessionId, text, bgColor='#075E54', font=2) {
    const inst = await this.getInstance(sessionId);
    const r = await inst.sock.sendMessage('status@broadcast',{ text, font, backgroundColor:bgColor, statusJidList:['status@broadcast'] });
    return { ok:true, messageId:r.key.id };
  }
  async sendMediaStatus(sessionId, buffer, type='image', caption='') {
    const inst = await this.getInstance(sessionId);
    const r = await inst.sock.sendMessage('status@broadcast', type==='image'?{image:buffer,caption}:{video:buffer,caption});
    return { ok:true, messageId:r.key.id };
  }

  // ── ✅ GROUPS ─────────────────────────────────────────────────────────────
  async getGroups(sessionId) {
    const inst = await this.getInstance(sessionId);
    const g    = await inst.sock.groupFetchAllParticipating();
    return Object.values(g).map(x=>({ id:x.id, subject:x.subject, desc:x.desc||'', owner:x.owner, creation:x.creation, size:x.participants?.length||0,
      participants:(x.participants||[]).map(p=>({ id:p.id, admin:p.admin||null, superAdmin:p.superAdmin||false })) }));
  }
  async getGroupMeta(sessionId, groupJid) {
    const inst = await this.getInstance(sessionId);
    const m    = await inst.sock.groupMetadata(groupJid);
    const code = await inst.sock.groupInviteCode(groupJid).catch(()=>null);
    return { id:m.id, subject:m.subject, desc:m.desc||'', owner:m.owner, creation:m.creation,
      inviteLink:code?`https://chat.whatsapp.com/${code}`:null, inviteCode:code,
      participants:m.participants.map(p=>({ id:p.id, admin:p.admin||null, superAdmin:p.superAdmin||false })) };
  }
  async createGroup(sessionId, subject, participants) {
    const inst = await this.getInstance(sessionId);
    const r    = await inst.sock.groupCreate(subject, participants.map(p=>this.jid(p)));
    return { ok:true, groupJid:r.gid, subject };
  }
  async groupParticipants(sessionId, groupJid, participants, action) {
    const inst = await this.getInstance(sessionId);
    const r    = await inst.sock.groupParticipantsUpdate(groupJid, participants.map(p=>this.jid(p)), action);
    return { ok:true, results:r };
  }
  async updateGroupSubject(sessionId, groupJid, subject) {
    const inst = await this.getInstance(sessionId);
    await inst.sock.groupUpdateSubject(groupJid,subject);
    return { ok:true };
  }
  async updateGroupDescription(sessionId, groupJid, desc) {
    const inst = await this.getInstance(sessionId);
    await inst.sock.groupUpdateDescription(groupJid,desc);
    return { ok:true };
  }
  async updateGroupSettings(sessionId, groupJid, settings) {
    const inst = await this.getInstance(sessionId);
    if (settings.messagesAdmin!==undefined) await inst.sock.groupSettingUpdate(groupJid,settings.messagesAdmin?'announcement':'not_announcement');
    if (settings.editInfoAdmin!==undefined)  await inst.sock.groupSettingUpdate(groupJid,settings.editInfoAdmin?'locked':'unlocked');
    return { ok:true };
  }
  async getGroupInviteLink(sessionId, groupJid) {
    const inst = await this.getInstance(sessionId);
    const code = await inst.sock.groupInviteCode(groupJid);
    return { ok:true, link:`https://chat.whatsapp.com/${code}`, code };
  }
  async revokeGroupInvite(sessionId, groupJid) {
    const inst = await this.getInstance(sessionId);
    const code = await inst.sock.groupRevokeInvite(groupJid);
    return { ok:true, newCode:code, newLink:`https://chat.whatsapp.com/${code}` };
  }
  async joinGroupByLink(sessionId, inviteCode) {
    const inst = await this.getInstance(sessionId);
    const gid  = await inst.sock.groupAcceptInvite(inviteCode);
    return { ok:true, groupJid:gid };
  }
  async getGroupInviteInfo(sessionId, inviteCode) {
    const inst = await this.getInstance(sessionId);
    const info = await inst.sock.groupGetInviteInfo(inviteCode);
    return { ok:true, group:info };
  }
  async leaveGroup(sessionId, groupJid) {
    const inst = await this.getInstance(sessionId);
    await inst.sock.groupLeave(groupJid);
    return { ok:true };
  }

  // ── ✅ CHANNELS ───────────────────────────────────────────────────────────
  async getFollowedChannels(sessionId) {
    const inst = await this.getInstance(sessionId);
    const ch   = await inst.sock.newsletterSubscribed().catch(()=>[]);
    return { ok:true, channels:ch||[] };
  }
  async getChannelInfo(sessionId, inviteOrJid) {
    const inst = await this.getInstance(sessionId);
    const info = await inst.sock.newsletterMetadata('invite', inviteOrJid.replace('@newsletter','')).catch(()=>null);
    return { ok:true, channel:info };
  }
  async followChannel(sessionId, channelJid) {
    const inst = await this.getInstance(sessionId);
    await inst.sock.newsletterFollow(channelJid);
    return { ok:true };
  }
  async unfollowChannel(sessionId, channelJid) {
    const inst = await this.getInstance(sessionId);
    await inst.sock.newsletterUnfollow(channelJid);
    return { ok:true };
  }
  async muteChannel(sessionId, channelJid) {
    const inst = await this.getInstance(sessionId);
    await inst.sock.newsletterMute(channelJid);
    return { ok:true };
  }
  async sendToChannel(sessionId, channelJid, content) {
    const inst = await this.getInstance(sessionId);
    const r    = await inst.sock.sendMessage(channelJid, content);
    return { ok:true, messageId:r.key.id };
  }
  async reactToChannelMsg(sessionId, channelJid, messageId, emoji) {
    const inst = await this.getInstance(sessionId);
    await inst.sock.sendMessage(channelJid,{ react:{ text:emoji, key:{ id:messageId, remoteJid:channelJid, fromMe:false }}});
    return { ok:true };
  }

  // ── 🔜 COMMUNITIES ────────────────────────────────────────────────────────
  async getCommunities(_sessionId) {
    return { ok:true, communities:[], note:'Communities API coming soon in Baileys' };
  }

  // ── SESSION CONTROL ───────────────────────────────────────────────────────
  async getQR(sessionId) {
    const inst = await this.getInstance(sessionId);
    if (inst.qr) {
      const qrBase64 = await QRCode.toDataURL(inst.qr);
      return { ok:true, qr:inst.qr, qrBase64, status:inst.status };
    }
    return { ok:true, qr:null, status:inst.status, user:inst.user };
  }
  getStatus(sessionId) {
    const inst = this.instances.get(sessionId);
    return { ok:true, status:inst?.status||'not_initialized', connected:inst?.status==='connected',
      user:inst?.user?{ id:inst.user.id, name:inst.user.name }:null, lastActivity:inst?.lastActivity||null };
  }
  getAllSessions() {
    return [...this.instances.entries()].map(([id,inst])=>({ sessionId:id, status:inst.status,
      connected:inst.status==='connected', user:inst.user?{ id:inst.user.id,name:inst.user.name }:null, lastActivity:inst.lastActivity }));
  }
  async logout(sessionId) {
    const inst = this.instances.get(sessionId);
    if (inst?.sock) { try { await inst.sock.logout(); } catch {} }
    this.instances.delete(sessionId);
    const supabase = require('../utils/supabaseClient');
    await supabase.from('whatsapp_sessions').delete().eq('session_id',sessionId);
    return { ok:true };
  }
  async restartSession(sessionId) {
    const inst = this.instances.get(sessionId);
    if (inst?.sock) { try { inst.sock.end(); } catch {} }
    this.instances.delete(sessionId);
    await this._delay(2000);
    await this.getInstance(sessionId);
    return { ok:true };
  }

  // ── Webhook bus ───────────────────────────────────────────────────────────
  onWebhook(sessionId, cb) { this._webhookHandlers.set(sessionId, cb); }
  _notify(sessionId, event, data) {
    const cb = this._webhookHandlers.get(sessionId) || this._webhookHandlers.get('*');
    if (cb) try { cb({ sessionId, event, data, ts:Date.now() }); } catch {}
  }
}

module.exports = new BaileysManager();
