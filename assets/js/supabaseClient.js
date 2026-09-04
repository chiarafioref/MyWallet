// Single place where the Supabase client is created.
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
  console.warn(
    "[MyWallet] Configure assets/js/config.js with the URL and anon key of your Supabase project."
  );
}
