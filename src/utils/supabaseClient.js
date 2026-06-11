// src/utils/supabaseClient.js
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY)
  console.error('❌ SUPABASE_URL et SUPABASE_KEY sont requis');

module.exports = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
