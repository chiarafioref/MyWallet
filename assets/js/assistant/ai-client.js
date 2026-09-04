// AI assistant — browser client.
// -----------------------------------------------------------------------------
// The Mistral API key never reaches the browser. Every request is forwarded to
// the Supabase Edge Function "chat-ai", which holds the key server-side (as the
// Supabase Secret MISTRAL_API_KEY) and calls Mistral on our behalf.
//
// supabaseClient.functions.invoke() automatically attaches the logged-in user's
// JWT, and the function is deployed with verify_jwt = true, so only
// authenticated users can reach it.
// -----------------------------------------------------------------------------
import { supabaseClient } from "../supabaseClient.js";
import { AI_ASSISTANT_ENABLED } from "../config.js";

const FUNCTION_NAME = "chat-ai";

// The assistant is "on" only when the flag is set in config.js. If the flag is
// true but the Edge Function is missing/unreachable, chatCompletion() throws and
// the callers transparently fall back to the built-in local interpreter/advisor.
export const aiEnabled = () => AI_ASSISTANT_ENABLED === true;

/**
 * Run one chat-completion request through the Edge Function.
 *
 * @param {Array<{ role: "system"|"user"|"assistant", content: string }>} messages
 * @param {{ temperature?: number, jsonMode?: boolean }} [options]
 *        jsonMode -> ask the model to reply with a strict JSON object.
 * @returns {Promise<string>} the assistant message content
 */
export async function chatCompletion(messages, { temperature = 0.3, jsonMode = false } = {}) {
  const { data, error } = await supabaseClient.functions.invoke(FUNCTION_NAME, {
    body: { messages, temperature, jsonMode },
  });

  if (error) {
    // Surface the Edge Function's error message when available (helps debugging).
    let detail = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) detail = body.error;
    } catch { /* ignore: keep the generic message */ }
    throw new Error(`Edge Function "${FUNCTION_NAME}": ${detail}`);
  }

  const content = data?.content;
  if (!content) throw new Error(`Edge Function "${FUNCTION_NAME}": empty response`);
  return String(content);
}
