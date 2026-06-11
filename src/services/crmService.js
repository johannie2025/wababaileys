// src/services/crmService.js — Wise OS CRM Engine
const supabase = require('../utils/supabaseClient');

class CRMService {

  // ─── Contacts ──────────────────────────────────────────────────────────────
  async upsertContact(entityId, data) {
    const { phone, name, jid, tags = [], meta = {} } = data;
    const { data: contact, error } = await supabase
      .from('crm_contacts')
      .upsert({
        entity_id: entityId,
        phone: String(phone).replace(/\D/g, ''),
        jid: jid || `${String(phone).replace(/\D/g, '')}@s.whatsapp.net`,
        name: name || '',
        tags,
        meta,
        updated_at: new Date().toISOString()
      }, { onConflict: 'entity_id,phone' })
      .select().single();
    if (error) throw error;
    return contact;
  }

  async getContact(entityId, phone) {
    const { data } = await supabase
      .from('crm_contacts')
      .select('*')
      .eq('entity_id', entityId)
      .eq('phone', String(phone).replace(/\D/g, ''))
      .maybeSingle();
    return data;
  }

  async listContacts(entityId, filters = {}) {
    let q = supabase.from('crm_contacts').select('*').eq('entity_id', entityId);
    if (filters.tag) q = q.contains('tags', [filters.tag]);
    if (filters.stage) q = q.eq('pipeline_stage', filters.stage);
    if (filters.search) q = q.ilike('name', `%${filters.search}%`);
    q = q.order('updated_at', { ascending: false });
    if (filters.limit) q = q.limit(filters.limit);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async addTags(entityId, phone, tags = []) {
    const contact = await this.getContact(entityId, phone);
    if (!contact) return null;
    const merged = [...new Set([...(contact.tags || []), ...tags])];
    const { data } = await supabase
      .from('crm_contacts')
      .update({ tags: merged, updated_at: new Date().toISOString() })
      .eq('id', contact.id).select().single();
    return data;
  }

  async removeTags(entityId, phone, tags = []) {
    const contact = await this.getContact(entityId, phone);
    if (!contact) return null;
    const filtered = (contact.tags || []).filter(t => !tags.includes(t));
    const { data } = await supabase
      .from('crm_contacts')
      .update({ tags: filtered, updated_at: new Date().toISOString() })
      .eq('id', contact.id).select().single();
    return data;
  }

  async updatePipelineStage(entityId, phone, stage, note = '') {
    const contact = await this.getContact(entityId, phone);
    if (!contact) return null;
    // Historique pipeline
    const history = contact.pipeline_history || [];
    history.push({ stage, note, date: new Date().toISOString() });
    const { data } = await supabase
      .from('crm_contacts')
      .update({ pipeline_stage: stage, pipeline_history: history, updated_at: new Date().toISOString() })
      .eq('id', contact.id).select().single();
    return data;
  }

  async logMessage(entityId, phone, direction, content, type = 'text') {
    const contact = await this.getContact(entityId, phone);
    await supabase.from('crm_messages').insert({
      entity_id: entityId,
      contact_id: contact?.id || null,
      phone: String(phone).replace(/\D/g, ''),
      direction, // 'in' | 'out'
      content,
      type,
      timestamp: new Date().toISOString()
    });
  }

  async getMessages(entityId, phone, limit = 50) {
    const { data } = await supabase
      .from('crm_messages')
      .select('*')
      .eq('entity_id', entityId)
      .eq('phone', String(phone).replace(/\D/g, ''))
      .order('timestamp', { ascending: false })
      .limit(limit);
    return (data || []).reverse();
  }

  // ─── Notes ─────────────────────────────────────────────────────────────────
  async addNote(contactId, userId, text) {
    const { data } = await supabase.from('crm_notes').insert({
      contact_id: contactId, user_id: userId, text,
      created_at: new Date().toISOString()
    }).select().single();
    return data;
  }

  async getNotes(contactId) {
    const { data } = await supabase
      .from('crm_notes').select('*')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });
    return data || [];
  }

  // ─── Pipeline dashboard stats ──────────────────────────────────────────────
  async getPipelineStats(entityId) {
    const { data } = await supabase
      .from('crm_contacts')
      .select('pipeline_stage')
      .eq('entity_id', entityId);
    const stats = {};
    for (const row of (data || [])) {
      const s = row.pipeline_stage || 'nouveau';
      stats[s] = (stats[s] || 0) + 1;
    }
    return stats;
  }
}

module.exports = new CRMService();
