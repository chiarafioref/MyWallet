// Edge Function "chat-ai": proxy autenticato verso l'API chat completions di Mistral.
// La API key è solo qui, come Secret MISTRAL_API_KEY. Con verify_jwt = true
// (supabase/config.toml) la piattaforma accetta solo richieste con un JWT valido.

const MISTRAL_ENDPOINT = "https://api.mistral.ai/v1/chat/completions";

// Il modello è deciso dal server (Secret MISTRAL_MODEL), mai dal client, per non esporre
// il progetto all'uso di modelli più costosi.
const MODEL = Deno.env.get("MISTRAL_MODEL") ?? "mistral-small-latest";

// In produzione impostare ALLOWED_ORIGIN all'URL del sito; "*" solo per lo sviluppo locale.
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

// Limiti sull'input contro abusi e costi imprevisti.
const MAX_MESSAGES = 16;
const MAX_TOTAL_CHARS = 12_000;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  Vary: "Origin",
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
}

const VALID_ROLES = new Set(["system", "user", "assistant"]);

function jwtClaims(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")));
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }

  // La firma è già verificata dalla piattaforma: qui si leggono solo i claim.
  // Sono ammessi solo utenti registrati, non gli account demo (anonimi) né la chiave pubblica.
  const claims = jwtClaims(auth.slice(7));
  if (claims?.role !== "authenticated" || claims?.is_anonymous === true) {
    return json({ error: "Forbidden" }, 403);
  }

  const apiKey = Deno.env.get("MISTRAL_API_KEY");
  if (!apiKey) {
    console.error("[chat-ai] Secret MISTRAL_API_KEY non configurato");
    return json({ error: "Service unavailable" }, 503);
  }

  let payload: RequestPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { messages, temperature, jsonMode } = payload;

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

  const body: Record<string, unknown> = {
    model: MODEL,
    temperature: typeof temperature === "number" && temperature >= 0 && temperature <= 2 ? temperature : 0.3,
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
    console.error("[chat-ai] richiesta a Mistral fallita:", String(err));
    return json({ error: "Upstream request failed" }, 502);
  }

  if (!upstream.ok) {
    // Il dettaglio dell'errore resta nei log del server; al client un messaggio generico.
    console.error(`[chat-ai] Mistral HTTP ${upstream.status}:`, await upstream.text());
    return json({ error: "AI provider error" }, 502);
  }

  const data = await upstream.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  return json({ content });
});
