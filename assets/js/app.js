// Bootstrap dell'app: controllo autenticazione, layout, router basato su hash e realtime.
import { getSession, onAuthChange, renderAuthScreen, signOut } from "./auth.js";
import { state, on, loadAll, startRealtime, stopRealtime, applyTheme } from "./store.js";
import { profile as profileApi } from "./data.js";
import { qs, el, toast } from "./utils.js";
import { icon, brandMark } from "./icons.js";
import { openOnboarding } from "./onboarding.js";
import { generateRecurring } from "./recurring.js";
import { generateSubscriptions } from "./subscriptions.js";
import { isDemoUser, ensureDemoData, demoBanner } from "./demo.js";

import { render as dashboard } from "./views/dashboard.js";
import { render as transactions, openTxModal } from "./views/transactions.js";
import { render as availability } from "./views/availability.js";
import { render as assistant } from "./views/assistant.js";
import { render as budgets } from "./views/budgets.js";
import { render as subscriptions } from "./views/subscriptions.js";
import { render as savings } from "./views/savings.js";
import { render as future } from "./views/future.js";
import { render as trips } from "./views/trips.js";
import { render as stats } from "./views/stats.js";
import { render as analysis } from "./views/analysis.js";
import { render as settings } from "./views/settings.js";

const ROUTES = {
  dashboard: { label: "Dashboard", icon: "dashboard", render: dashboard },
  transazioni: { label: "Transazioni", icon: "transactions", render: transactions },
  disponibilita: { label: "Disponibilità", icon: "creditCard", render: availability },
  assistente: { label: "Assistente", icon: "sparkles", render: assistant },
  statistiche: { label: "Statistiche", icon: "chart", render: stats },
  analisi: { label: "Analisi mensile", icon: "analysis", render: analysis },
  budget: { label: "Budget", icon: "wallet", render: budgets },
  abbonamenti: { label: "Abbonamenti", icon: "repeat", render: subscriptions },
  risparmi: { label: "Risparmi", icon: "savings", render: savings },
  viaggio: { label: "In viaggio", icon: "plane", render: trips },
  future: { label: "Spese future", icon: "calendar", render: future },
  impostazioni: { label: "Impostazioni", icon: "settings", render: settings },
};

// Barra di navigazione inferiore (mobile), ai lati del pulsante "+".
const BOTTOM_LEFT = [
  { key: "dashboard", label: "Home" },
  { key: "transazioni", label: "Movimenti" },
];
const BOTTOM_RIGHT = [
  { key: "assistente", label: "Cerca" },
  { key: "statistiche", label: "Report" },
];

const app = qs("#app");
let currentRoute = "dashboard";
let booted = false;
let banner = null;

on("change", () => {
  if (!booted) return;
  renderRoute();
  updateThemeToggle();
});
document.addEventListener("keydown", onShortcut);
window.addEventListener("hashchange", () => {
  const r = location.hash.slice(1);
  if (ROUTES[r] && r !== currentRoute) {
    currentRoute = r;
    renderRoute();
  }
});

init();

async function init() {
  const session = await getSession();
  onAuthChange(handleSession);
  handleSession(session);
}

async function handleSession(session) {
  if (!session?.user) {
    booted = false;
    banner?.stop();
    banner = null;
    stopRealtime();
    applyTheme("light");
    renderAuthScreen(app);
    return;
  }
  if (booted) return;
  booted = true;

  const user = session.user;
  renderShell(user);

  // I dati della demo vanno caricati prima di leggerli, altrimenti l'app si aprirebbe vuota.
  if (isDemoUser(user)) {
    state.loading = true;
    renderRoute();
    try {
      await ensureDemoData();
    } catch (err) {
      toast(`Impossibile avviare la demo: ${err.message}`, "error");
      await signOut();
      return;
    }
  }

  await loadAll(user);
  startRealtime(session.user.id);
  if (!state.profile?.onboarding_completed) openOnboarding();

  await runGenerator(generateRecurring, (n) =>
    n === 1 ? "1 transazione ricorrente generata" : `${n} transazioni ricorrenti generate`
  );
  await runGenerator(generateSubscriptions, (n) =>
    n === 1 ? "1 spesa da abbonamento registrata" : `${n} spese da abbonamento registrate`
  );
}

async function runGenerator(generate, message) {
  try {
    const n = await generate();
    if (n) toast(message(n), "success");
  } catch (err) {
    console.warn(err);
  }
}

// Scorciatoie: 1..9 aprono le sezioni, "/" apre l'assistente, Esc chiude il menu.
function onShortcut(e) {
  if (!booted || e.target.matches("input, textarea, select")) return;
  if (e.key === "/") {
    e.preventDefault();
    navigate("assistente");
    requestAnimationFrame(() => qs("#assistant-input")?.focus());
    return;
  }
  if (e.key === "Escape") qs(".sidebar")?.classList.remove("is-open");
  const keys = Object.keys(ROUTES);
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= keys.length) navigate(keys[n - 1]);
}

function renderShell(user) {
  app.innerHTML = "";
  app.classList.add("app");

  const navButton = (iconName, label, attrs) =>
    el("button", {
      class: "nav-link",
      html: `<span class="nav-link__icon">${icon(iconName)}</span><span>${label}</span>`,
      ...attrs,
    });

  const drawer = el("nav", { class: "sidebar" }, [
    el("div", { class: "sidebar__brand" }, [
      el("span", { class: "icn-wrap", html: brandMark(24) }),
      el("span", { text: "MyWallet" }),
    ]),
    el(
      "ul",
      { class: "sidebar__nav" },
      Object.entries(ROUTES)
        .filter(([key]) => key !== "impostazioni")
        .map(([key, r], i) =>
          el("li", { style: `--i:${i}` }, [
            navButton(r.icon, r.label, { "data-route": key, onclick: () => navigate(key) }),
          ])
        )
    ),
    el("div", { class: "sidebar__foot" }, [
      navButton("moon", "Tema", { class: "nav-link js-theme-toggle", onclick: toggleTheme }),
      navButton("lightbulb", "Tutorial", { onclick: () => openOnboarding() }),
      navButton("settings", "Impostazioni", { "data-route": "impostazioni", onclick: () => navigate("impostazioni") }),
      navButton("logout", "Esci", { onclick: () => signOut() }),
    ]),
  ]);

  const closeDrawer = () => drawer.classList.remove("is-open");
  drawer.addEventListener("click", (e) => {
    if (e.target.closest(".nav-link:not(.js-theme-toggle)")) closeDrawer();
  });

  const appBar = el("header", { class: "app-bar" }, [
    el("button", {
      class: "icon-btn",
      "aria-label": "Menu",
      onclick: () => drawer.classList.toggle("is-open"),
      html: icon("menu", { size: 22 }),
    }),
    el("span", { class: "app-bar__brand" }, [
      el("span", { class: "icn-wrap", html: brandMark(22) }),
      el("span", { text: "MyWallet" }),
    ]),
    el("span", { class: "app-bar__spacer" }),
    el("button", {
      class: "icon-btn js-theme-toggle",
      "aria-label": "Cambia tema",
      onclick: toggleTheme,
      html: icon("moon", { size: 22 }),
    }),
  ]);

  const scrim = el("div", { class: "drawer-scrim", onclick: closeDrawer });
  const main = el("main", { class: "content", id: "route-outlet" });

  const bottomBtn = ({ key, label }) =>
    el("button", {
      class: "bottom-nav__btn",
      "data-route": key,
      onclick: () => navigate(key),
      html: `${icon(ROUTES[key].icon, { size: 21 })}<span>${label}</span>`,
    });

  const bottomNav = el("nav", { class: "bottom-nav", "aria-label": "Navigazione" }, [
    ...BOTTOM_LEFT.map(bottomBtn),
    el("button", {
      class: "bottom-nav__fab",
      "aria-label": "Aggiungi spesa o entrata",
      title: "Aggiungi spesa o entrata",
      onclick: () => openTxModal(),
      html: icon("plus", { size: 24, stroke: 2.4 }),
    }),
    ...BOTTOM_RIGHT.map(bottomBtn),
  ]);

  app.append(appBar, drawer, scrim, main, bottomNav);

  if (isDemoUser(user)) {
    banner = demoBanner(user, {
      onExpire: () => {
        toast("La demo è terminata: i dati di esempio sono stati azzerati.", "info");
        signOut();
      },
    });
  }
  updateThemeToggle();
}

function navigate(route) {
  if (!ROUTES[route]) return;
  currentRoute = route;
  location.hash = route;
  qs(".sidebar")?.classList.remove("is-open");
  renderRoute();
}

function renderRoute() {
  const outlet = qs("#route-outlet");
  if (!outlet) return;
  const hashRoute = location.hash.slice(1);
  const route = ROUTES[hashRoute] ? hashRoute : currentRoute;
  currentRoute = route;

  document.querySelectorAll("[data-route]").forEach((b) => b.classList.toggle("is-active", b.dataset.route === route));

  // Riavvia l'animazione di ingresso della vista.
  outlet.classList.remove("view-enter");
  void outlet.offsetWidth;
  outlet.classList.add("view-enter");
  outlet.scrollTo?.({ top: 0 });
  window.scrollTo?.({ top: 0 });

  if (state.loading) {
    outlet.innerHTML = `<div class="view"><div class="skeleton-list">${"<div class='skeleton-row'></div>".repeat(4)}</div></div>`;
  } else {
    ROUTES[route].render(outlet);
  }
  // Le view svuotano l'outlet: il banner della demo va reinserito dopo ogni rendering.
  if (banner) outlet.prepend(banner.node);
}

async function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  updateThemeToggle();
  try {
    state.profile = await profileApi.update({ theme: next });
  } catch {
    // Offline: il tema resta applicato localmente.
  }
}

function updateThemeToggle() {
  const dark = document.documentElement.dataset.theme === "dark";
  document.querySelectorAll(".js-theme-toggle").forEach((btn) => {
    const label = btn.querySelector(".nav-link__icon");
    if (label) label.innerHTML = icon(dark ? "sun" : "moon");
    else btn.innerHTML = icon(dark ? "sun" : "moon", { size: 22 });
  });
}
