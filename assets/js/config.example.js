// Supabase configuration — template.
// Copy this file to `config.js` and fill in your project's values
// (Supabase Dashboard -> Project Settings -> API).
//
// These values are PUBLIC by design: the URL is in every request and the
// "publishable" anon key is meant to ship in the browser. Data is protected by
// Row Level Security (see DB.sql), not by keeping this key secret.
export const SUPABASE_URL = "https://your-project.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_xxxxxxxxxxxxxxxx";

// AI financial assistant.
// ---------------------------------------------------------------------------
// The assistant NEVER talks to Mistral directly: requests go through the
// Supabase Edge Function "chat-ai", which holds the API key server-side as the
// Supabase Secret MISTRAL_API_KEY. No provider key is ever shipped to the browser.
//
// true  -> use the Mistral model (needs: `supabase secrets set MISTRAL_API_KEY=...`
//          and `supabase functions deploy chat-ai`).
// false -> use the built-in LOCAL interpreter/advisor (offline, no key). It still
//          answers questions such as "can I afford a 70 EUR/month instalment?"
//          by analysing your own transactions.
// If the Edge Function is unreachable the app falls back to the local mode.
export const AI_ASSISTANT_ENABLED = false;
