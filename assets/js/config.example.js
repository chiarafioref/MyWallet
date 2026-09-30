// Template: copia in `config.js` e inserisci i valori del tuo progetto
// (Supabase Dashboard → Project Settings → API).
//
// Valori pubblici per design: URL del progetto e chiave "publishable" viaggiano in ogni
// richiesta del browser. I dati sono protetti dalla Row Level Security (DB.sql), non dalla
// segretezza della chiave. La API key di Mistral è un Secret della Edge Function "chat-ai".
export const SUPABASE_URL = "https://your-project.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_xxxxxxxxxxxxxxxx";

// true: l'assistente usa Mistral tramite la Edge Function "chat-ai".
// false: usa solo l'interprete locale. Se la funzione non risponde si ripiega comunque su quest'ultimo.
export const AI_ASSISTANT_ENABLED = false;
