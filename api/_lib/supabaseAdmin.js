/* ==========================================================================
   api/_lib/supabaseAdmin.js — Supabase Storage client, server-side only.

   Uses SUPABASE_SERVICE_ROLE_KEY, which grants full access to the project's
   Storage. This key must NEVER be sent to, imported by, or bundled into any
   frontend file — it only ever lives in Vercel's server-side environment
   variables and is read here via process.env.
   ========================================================================== */

const { createClient } = require("@supabase/supabase-js");

let cachedClient = null;

function getSupabaseAdmin() {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase server environment variables are not configured.");
  }

  cachedClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

function getBucket() {
  return process.env.SUPABASE_BUCKET || "gp-documents";
}

module.exports = { getSupabaseAdmin, getBucket };
