// Account demo: ogni visitatore entra come utente anonimo con una copia privata dei dati di
// esempio (vedi demo/demo-seed.sql). Un job pg_cron elimina le demo dopo DEMO_MINUTES minuti.
import { supabaseClient } from "./supabaseClient.js";
import { el } from "./utils.js";
import { icon } from "./icons.js";

export const DEMO_MINUTES = 30;

export const isDemoUser = (user) => user?.is_anonymous === true;

export async function signInDemo() {
  const { error } = await supabaseClient.auth.signInAnonymously();
  if (error) throw error;
}

// Idempotente: se il dataset è già stato caricato (es. ricarica della pagina) la RPC non fa nulla.
export async function ensureDemoData() {
  const { error } = await supabaseClient.rpc("start_demo");
  if (error) throw error;
}

// Millisecondi rimasti prima della scadenza della demo (mai negativi).
export function demoTimeLeft(user, now = Date.now()) {
  const expiresAt = new Date(user.created_at).getTime() + DEMO_MINUTES * 60_000;
  return Math.max(0, expiresAt - now);
}

export const formatTimeLeft = (ms) => {
  const minutes = Math.ceil(ms / 60_000);
  return minutes <= 1 ? "meno di un minuto" : `${minutes} minuti`;
};

/**
 * Banner con il tempo rimasto. Alla scadenza chiama `onExpire` (logout): l'utente anonimo
 * viene poi eliminato dal job di pulizia.
 * @returns {{ node: HTMLElement, stop: () => void }}
 */
export function demoBanner(user, { onExpire }) {
  const time = el("strong");
  const node = el("div", { class: "demo-banner", role: "status" }, [
    el("span", { class: "icn-wrap", html: icon("sparkles", { size: 16 }) }),
    el("span", {}, ["Sei in modalità demo: i dati di prova verranno azzerati tra ", time]),
  ]);

  const tick = () => {
    const left = demoTimeLeft(user);
    time.textContent = formatTimeLeft(left);
    if (left === 0) {
      stop();
      onExpire();
    }
  };
  const timer = setInterval(tick, 15_000);
  const stop = () => clearInterval(timer);
  tick();
  return { node, stop };
}
