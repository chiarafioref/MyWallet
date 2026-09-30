// Client dell'assistente AI. La API key di Mistral non arriva mai al browser: ogni richiesta
// passa dalla Edge Function "chat-ai", che la conserva come Secret e accetta solo utenti
// autenticati (functions.invoke() allega il JWT della sessione).
import { supabaseClient } from "../supabaseClient.js";
import { AI_ASSISTANT_ENABLED } from "../config.js";
import { state } from "../store.js";
import { isDemoUser } from "../demo.js";

const FUNCTION_NAME = "chat-ai";

// Gli utenti demo usano solo l'interprete locale (la Edge Function li rifiuta comunque).
// Se la funzione non è raggiungibile chatCompletion() lancia un errore e i chiamanti
// ripiegano sull'interprete locale.
export const aiEnabled = () => AI_ASSISTANT_ENABLED === true && !isDemoUser(state.user);

/**
 * Esegue una richiesta di chat completion tramite la Edge Function.
 * @param {Array<{ role: "system"|"user"|"assistant", content: string }>} messages
 * @param {{ temperature?: number, jsonMode?: boolean }} [options] jsonMode: risposta in JSON rigoroso
 * @returns {Promise<string>} testo della risposta
 */
export async function chatCompletion(messages, { temperature = 0.3, jsonMode = false } = {}) {
  const { data, error } = await supabaseClient.functions.invoke(FUNCTION_NAME, {
    body: { messages, temperature, jsonMode },
  });

  if (error) {
    let detail = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) detail = body.error;
    } catch {
      // Corpo della risposta non in JSON: resta il messaggio generico.
    }
    throw new Error(`Edge Function "${FUNCTION_NAME}": ${detail}`);
  }

  const content = data?.content;
  if (!content) throw new Error(`Edge Function "${FUNCTION_NAME}": risposta vuota`);
  return String(content);
}
