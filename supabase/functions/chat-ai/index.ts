// Supabase Edge Function: chat-ai
// =============================================================================
// Authenticated proxy to the Mistral AI chat-completions API.
//
// The Mistral API key lives ONLY here, as the Supabase Secret MISTRAL_API_KEY,
// and is never shipped to the browser. The frontend calls this function with:
//
//   supabaseClient.functions.invoke("chat-ai", {
//     body: { messages, temperature, jsonMode }
//   })
//
// verify_jwt = true (see supabase/config.toml): only authenticated users can
// invoke it; functions.invoke() attaches the current session JWT automatically.
// =============================================================================

const MISTRAL_ENDPOINT = "https://api.mistral.ai/v1/chat/completions";

// Model: overridable via the optional MISTRAL_MODEL secret, else a sane default.
const DEFAULT_MODEL = Deno.env.get("MISTRAL_MODEL") ?? "mistral-small-latest";

// CORS origin: set the ALLOWED_ORIGIN secret to your site URL in production
// (e.g. https://<user>.github.io). Falls back to "*" for local development.
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

// Input limits (defence against abuse / runaway cost).
const MAX_MESSAGES = 16;
const MAX_TOTAL_CHARS = 12_000;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Vary": "Origin",
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
interface RequestPayload {
  messages?: ChatMessage[];
  temperature?: number;
  jsonMode?: boolean;
  model?: string;
}

const VALID_ROLES = new Set(["system", "user", "assistant"]);

Deno.serve(async (req: Request): Promise<Response> => {
  // 1. CORS preflight.
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // 2. Auth header present (the platform already verified the JWT).
  if (!(req.headers.get("Authorization") ?? "").toLowerCase().startsWith("bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }

  // 3. Secret configured?
  const apiKey = Deno.env.get("MISTRAL_API_KEY");
  if (!apiKey) {
    console.error("[chat-ai] MISTRAL_API_KEY secret is not configured");
    return json({ error: "Service unavailable" }, 503);
  }

  // 4. Parse and validate the request body.
  let payload: RequestPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { messages, temperature, jsonMode, model } = payload;

  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: "`messages` must be a non-empty array" }, 400);
  }
  if (messages.length > MAX_MESSAGES) {
    return json({ error: "Too many messages" }, 400);
  }

  let totalChars = 0;
  for (const m of messages) {
    if (!m || typeof m.content !== "string" || !VALID_ROLES.has(m.role)) {
      return json({ error: "Malformed message" }, 400);
    }
    totalChars += m.content.length;
  }
  if (totalChars > MAX_TOTAL_CHARS) {
    return json({ error: "Prompt too large" }, 400);
  }

  const temp = typeof temperature === "number" && temperature >= 0 && temperature <= 2
    ? temperature
    : 0.3;

  // 5. Call Mistral with the server-side key.
  const body: Record<string, unknown> = {
    model: typeof model === "string" && model.length <= 60 ? model : DEFAULT_MODEL,
    temperature: temp,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (jsonMode === true) body.response_format = { type: "json_object" };

  let upstream: Response;
  try {
    upstream = await fetch(MISTRAL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("[chat-ai] upstream request failed:", String(err));
    return json({ error: "Upstream request failed" }, 502);
  }

  if (!upstream.ok) {
    // Log the provider detail server-side only; return a generic message.
    console.error(`[chat-ai] Mistral HTTP ${upstream.status}:`, await upstream.text());
    return json({ error: "AI provider error" }, 502);
  }

  const data = await upstream.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";

  // 6. Minimal response: the frontend only needs { content }.
  return json({ content });
});
