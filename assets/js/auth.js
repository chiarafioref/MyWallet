// Supabase authentication: signup, login, logout, session.
import { supabaseClient } from "./supabaseClient.js";
import { qs, toast } from "./utils.js";
import { brandMark, icon } from "./icons.js";

export async function getSession() {
  const { data } = await supabaseClient.auth.getSession();
  return data.session;
}

export function onAuthChange(cb) {
  const { data } = supabaseClient.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

async function signUp({ email, password, firstName, lastName }) {
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { data: { first_name: firstName, last_name: lastName } },
  });
  if (error) throw error;
  return data;
}

async function signIn({ email, password }) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabaseClient.auth.signOut();
}

export function renderAuthScreen(root, onAuthenticated) {
  // #app uses a grid (sidebar) once logged in; neutralise it here.
  root.classList.remove("app");
  root.innerHTML = `
    <div class="auth-screen">
      <aside class="auth-hero" aria-hidden="true">
        <div class="auth-hero__content">
          <span class="auth-hero__brand">${brandMark(30)}<span>MyWallet</span></span>
          <h2>Il tuo denaro,<br />sempre sotto controllo.</h2>
          <p class="auth-hero__lead">Registra entrate e uscite, imposta budget su misura, pianifica le spese future e chiedi consiglio all'assistente finanziario.</p>
          <ul class="auth-hero__features">
            <li><span class="icn-wrap">${icon("trendingUp", { size: 18 })}</span> Saldo aggiornato in tempo reale</li>
            <li><span class="icn-wrap">${icon("wallet", { size: 18 })}</span> Budget e statistiche per categoria</li>
            <li><span class="icn-wrap">${icon("sparkles", { size: 18 })}</span> Assistente finanziario con AI</li>
          </ul>
        </div>
      </aside>

      <main class="auth-panel">
        <div class="auth-card">
          <span class="auth-card__brand">${brandMark(26)}<span>MyWallet</span></span>

          <div class="auth-card__head">
            <h1 id="auth-title">Bentornato</h1>
            <p id="auth-sub">Accedi al tuo portafoglio digitale.</p>
          </div>

          <div class="auth-tabs" data-mode="login">
            <button type="button" class="auth-tab is-active" data-mode="login">Accedi</button>
            <button type="button" class="auth-tab" data-mode="signup">Registrati</button>
          </div>

          <form class="auth-form" id="auth-form" novalidate>
            <div class="auth-names" id="auth-names">
              <div class="field field--name">
                <label>Nome</label>
                <input name="firstName" type="text" autocomplete="given-name" disabled />
              </div>
              <div class="field field--name">
                <label>Cognome</label>
                <input name="lastName" type="text" autocomplete="family-name" disabled />
              </div>
            </div>
            <div class="field">
              <label>Email</label>
              <input name="email" type="email" autocomplete="email" required />
              <span class="field-error"></span>
            </div>
            <div class="field">
              <label>Password</label>
              <input name="password" type="password" autocomplete="current-password" minlength="6" required />
              <span class="field-error"></span>
            </div>
            <button type="submit" class="btn btn--primary btn--block">
              <span class="btn-label">Accedi</span>
            </button>
          </form>

          <p class="auth-alt">
            <span id="auth-alt-text">Non hai un account?</span>
            <button type="button" class="link" id="auth-alt-btn">Registrati</button>
          </p>
        </div>
      </main>
    </div>
  `;

  let mode = "login";
  const form = qs("#auth-form", root);
  const tabs = [...root.querySelectorAll(".auth-tab")];
  const tabWrap = qs(".auth-tabs", root);
  const authNames = qs("#auth-names", root);
  const btnLabel = qs(".btn-label", root);
  const title = qs("#auth-title", root);
  const sub = qs("#auth-sub", root);
  const altText = qs("#auth-alt-text", root);
  const altBtn = qs("#auth-alt-btn", root);

  function setMode(next) {
    mode = next;
    tabWrap.dataset.mode = mode;
    tabs.forEach((t) => t.classList.toggle("is-active", t.dataset.mode === mode));
    const signup = mode === "signup";
    authNames.classList.toggle("is-open", signup);
    authNames.querySelectorAll("input").forEach((i) => { i.disabled = !signup; if (!signup) { i.value = ""; validateField(i); } });
    btnLabel.textContent = signup ? "Crea account" : "Accedi";
    title.textContent = signup ? "Crea il tuo account" : "Bentornato";
    sub.textContent = signup
      ? "Bastano pochi secondi per iniziare a gestire il tuo denaro."
      : "Accedi al tuo portafoglio digitale.";
    altText.textContent = signup ? "Hai già un account?" : "Non hai un account?";
    altBtn.textContent = signup ? "Accedi" : "Registrati";
    form.querySelector('[name="password"]')
      .setAttribute("autocomplete", signup ? "new-password" : "current-password");
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
  altBtn.addEventListener("click", () => setMode(mode === "signup" ? "login" : "signup"));

  form.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => validateField(input));
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const inputs = [...form.querySelectorAll("input:not(:disabled)")];
    const valid = inputs.map(validateField).every(Boolean);
    if (!valid) return;

    const fd = Object.fromEntries(new FormData(form));
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.classList.add("is-loading");

    try {
      if (mode === "signup") {
        await signUp(fd);
        toast("Account creato! Controlla l'email se la conferma è attiva.", "success");
        const { data } = await supabaseClient.auth.getSession();
        if (data.session) onAuthenticated(data.session);
      } else {
        const data = await signIn(fd);
        onAuthenticated(data.session);
      }
    } catch (err) {
      toast(translateAuthError(err.message), "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove("is-loading");
    }
  });
}

function validateField(input) {
  const wrap = input.closest(".field");
  const errNode = wrap?.querySelector(".field-error");
  let msg = "";
  if (input.required && !input.value.trim()) msg = "Campo obbligatorio";
  else if (input.type === "email" && input.value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.value))
    msg = "Email non valida";
  else if (input.minLength > 0 && input.value && input.value.length < input.minLength)
    msg = `Minimo ${input.minLength} caratteri`;
  wrap?.classList.toggle("has-error", !!msg);
  if (errNode) errNode.textContent = msg;
  return !msg;
}

function translateAuthError(message = "") {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "Email o password non corretti";
  if (m.includes("already registered")) return "Email già registrata";
  if (m.includes("password should be")) return "Password troppo debole (min 6 caratteri)";
  if (m.includes("email not confirmed")) return "Devi confermare l'email prima di accedere";
  return message || "Errore di autenticazione";
}
