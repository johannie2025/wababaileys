// src/core/sessionManager.js — Persistance Baileys sur Supabase
const supabase = require('../utils/supabaseClient');
const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');

async function useSupabaseAuthState(sessionId) {
  let creds, keys = {};

  const { data } = await supabase
    .from('whatsapp_sessions')
    .select('creds, keys')
    .eq('session_id', sessionId)
    .maybeSingle();

  if (data?.creds) {
    creds = JSON.parse(JSON.stringify(data.creds), BufferJSON.reviver);
    keys  = JSON.parse(JSON.stringify(data.keys || {}), BufferJSON.reviver);
  } else {
    creds = initAuthCreds();
  }

  const save = async () => {
    await supabase.from('whatsapp_sessions').upsert({
      session_id: sessionId,
      creds: JSON.parse(JSON.stringify(creds, BufferJSON.replacer)),
      keys:  JSON.parse(JSON.stringify(keys,  BufferJSON.replacer)),
      updated_at: new Date().toISOString()
    }, { onConflict: 'session_id' });
  };

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const result = {};
          for (const id of ids) {
            let v = keys[type]?.[id];
            if (type === 'app-state-sync-key' && v)
              v = proto.Message.AppStateSyncKeyData.fromObject(v);
            result[id] = v;
          }
          return result;
        },
        set: async (data) => {
          for (const [type, vals] of Object.entries(data)) {
            keys[type] = { ...(keys[type] || {}), ...vals };
          }
          await save();
        }
      }
    },
    saveCreds: save
  };
}

module.exports = { useSupabaseAuthState };
