// -----------------------------------------------------------------------------
// Configurazione Supabase
// -----------------------------------------------------------------------------
// Questi valori sono PUBBLICI per design:
//   - SUPABASE_URL: è l'endpoint del progetto, viaggia in ogni richiesta.
//   - SUPABASE_ANON_KEY: chiave "publishable", pensata per stare nel browser.
//     A proteggere i dati è la Row Level Security (vedi DB.sql), non questa chiave.
// Nessun segreto (API key di provider) deve stare in questo file: la chiave di
// Mistral vive come Secret di Supabase ed è usata solo dalla Edge Function
// "chat-ai". Per questo il file può essere committato e il sito pubblicato.
// -----------------------------------------------------------------------------
export const SUPABASE_URL = "https://gdymolojdywwsvrymapy.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_1tt0yu4UL3nVShjMLbXxlQ_FK9XuAPv";

// -----------------------------------------------------------------------------
// Assistente finanziario AI
// -----------------------------------------------------------------------------
// true  -> l'assistente usa il modello Mistral tramite la Edge Function "chat-ai"
//          (richiede: Secret MISTRAL_API_KEY impostato + funzione deployata).
// false -> l'assistente usa l'interprete locale integrato (offline, senza AI).
// Se la funzione non è raggiungibile, l'app ripiega comunque sull'interprete locale.
// -----------------------------------------------------------------------------
export const AI_ASSISTANT_ENABLED = true;
