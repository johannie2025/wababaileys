// src/services/chatbotService.js — Wise OS Chatbot Engine + Gemini IA
const supabase = require('../utils/supabaseClient');
const axios    = require('axios');
const crm      = require('./crmService');

class ChatbotService {

  // ─── Load entity config (keywords, ai_prompt, flows) ─────────────────────
  async getEntityConfig(entityId) {
    const cacheKey = `chatbot:config:${entityId}`;
    // Simple in-memory TTL cache (60s)
    if (this._cache?.[cacheKey]?.ts > Date.now() - 60000) {
      return this._cache[cacheKey].data;
    }
    const { data } = await supabase
      .from('chatbot_configs')
      .select('*')
      .eq('entity_id', entityId)
      .eq('active', true)
      .maybeSingle();
    if (!this._cache) this._cache = {};
    this._cache[cacheKey] = { ts: Date.now(), data };
    return data;
  }

  // ─── Main router: keyword → flow → AI ─────────────────────────────────────
  async process(sessionId, entityId, msg) {
    const text = (msg.text || '').trim().toLowerCase();
    if (!text) return null;

    const config = await this.getEntityConfig(entityId);
    if (!config?.active) return null;

    // 1. Keyword match
    const keywords = config.keywords || [];
    for (const kw of keywords) {
      const triggers = Array.isArray(kw.triggers) ? kw.triggers : [kw.trigger];
      const matched = triggers.some(t =>
        kw.exact
          ? text === t.toLowerCase()
          : text.includes(t.toLowerCase())
      );
      if (matched) {
        await this._logInteraction(entityId, msg, 'keyword', kw.id);
        return this._buildResponse(kw.response, kw.type || 'text', kw, msg);
      }
    }

    // 2. AI fallback (Gemini)
    if (config.ai_enabled) {
      return this._askAI(entityId, config, msg, text);
    }

    // 3. Default reply
    if (config.default_reply) {
      return { type: 'text', text: config.default_reply };
    }

    return null;
  }

  // ─── Build response object from keyword config ────────────────────────────
  _buildResponse(response, type, kw, msg) {
    const base = { type, source: 'keyword', kwId: kw.id };

    if (type === 'text') return { ...base, text: response };
    if (type === 'buttons') return {
      ...base, text: response.text || response,
      buttons: kw.buttons || [], footer: kw.footer || ''
    };
    if (type === 'list') return {
      ...base, title: kw.title, text: response,
      buttonText: kw.buttonText || 'Options',
      sections: kw.sections || []
    };
    if (type === 'poll') return {
      ...base, name: kw.pollName || response,
      values: kw.pollOptions || [], selectableCount: kw.selectableCount || 1
    };
    if (type === 'media') return {
      ...base, caption: response, mediaUrl: kw.mediaUrl,
      mediaType: kw.mediaType || 'image'
    };
    if (type === 'payment_link') return {
      ...base,
      text: `${response}\n\n💳 Paiement: ${kw.paymentLink}`,
      paymentLink: kw.paymentLink
    };
    return { ...base, text: response };
  }

  // ─── Gemini AI ─────────────────────────────────────────────────────────────
  async _askAI(entityId, config, msg, text) {
    try {
      const contact = await crm.getContact(entityId, msg.from?.split('@')[0]);
      const history = await crm.getMessages(entityId, msg.from?.split('@')[0], 10);

      const systemPrompt = config.ai_system_prompt || `Tu es un assistant commercial professionnel pour ${config.entity_name || 'cette entreprise'}. Réponds en français, sois concis et utile. Si le prospect montre de l'intérêt pour un achat, guide-le vers la finalisation. Tu dois qualifier chaque prospect.`;

      const conversationHistory = history.slice(-6).map(m => ({
        role: m.direction === 'in' ? 'user' : 'model',
        parts: [{ text: m.content }]
      }));
      conversationHistory.push({ role: 'user', parts: [{ text }] });

      const resp = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: conversationHistory,
          generationConfig: { temperature: 0.7, maxOutputTokens: 400 }
        }
      );

      const aiText = resp.data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Auto-qualification based on AI reply + text
      await this._autoQualify(entityId, msg, text, aiText, contact);

      await this._logInteraction(entityId, msg, 'ai', null);
      return { type: 'text', text: aiText, source: 'ai' };
    } catch (err) {
      console.error('[Chatbot] Gemini error:', err.message);
      return null;
    }
  }

  // ─── Auto CRM qualification ────────────────────────────────────────────────
  async _autoQualify(entityId, msg, userText, aiReply, contact) {
    const phone = msg.from?.split('@')[0];
    const lower = userText.toLowerCase();

    // Score buying intent
    const hotKeywords   = ['acheter','commander','prix','tarif','combien','payer','intéressé','je veux'];
    const warmKeywords  = ['info','renseignement','comment','disponible','livraison','délai'];
    const closeKeywords = ['confirmer','valider','d\'accord','ok','oui','c\'est bon'];

    let newStage = null, newTags = [];

    if (closeKeywords.some(k => lower.includes(k)) && contact?.pipeline_stage === 'chaud') {
      newStage = 'closing'; newTags = ['prêt_à_acheter'];
    } else if (hotKeywords.some(k => lower.includes(k))) {
      newStage = 'chaud'; newTags = ['prospect_chaud'];
    } else if (warmKeywords.some(k => lower.includes(k))) {
      newStage = 'tiède'; newTags = ['prospect_tiède'];
    }

    if (phone) {
      await crm.upsertContact(entityId, { phone, jid: msg.from, name: msg.pushName });
      if (newTags.length) await crm.addTags(entityId, phone, newTags);
      if (newStage) await crm.updatePipelineStage(entityId, phone, newStage, `Auto-qualifié: ${userText.slice(0,80)}`);
      await crm.logMessage(entityId, phone, 'in', userText, 'text');
    }
  }

  // ─── Log interaction ───────────────────────────────────────────────────────
  async _logInteraction(entityId, msg, source, kwId) {
    await supabase.from('chatbot_interactions').insert({
      entity_id: entityId,
      jid: msg.from,
      phone: msg.from?.split('@')[0],
      text: msg.text || '',
      source,
      keyword_id: kwId,
      timestamp: new Date().toISOString()
    }).then(() => {}).catch(() => {});
  }

  // ─── Scheduled follow-ups ─────────────────────────────────────────────────
  async scheduleFollowUp(entityId, phone, message, sendAt) {
    const { data } = await supabase.from('crm_followups').insert({
      entity_id: entityId,
      phone,
      message,
      send_at: sendAt,
      status: 'pending',
      created_at: new Date().toISOString()
    }).select().single();
    return data;
  }

  async getPendingFollowUps() {
    const { data } = await supabase
      .from('crm_followups')
      .select('*')
      .eq('status', 'pending')
      .lte('send_at', new Date().toISOString());
    return data || [];
  }

  async markFollowUpSent(id) {
    await supabase.from('crm_followups')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', id);
  }
}

module.exports = new ChatbotService();
