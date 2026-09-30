import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

if (SUPABASE_URL.includes("your-project")) {
  console.warn("[MyWallet] Configura assets/js/config.js con URL e chiave del tuo progetto Supabase.");
}
