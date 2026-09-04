// App bootstrap: auth gate, mobile-first layout, router, realtime.
import { getSession, onAuthChange, renderAuthScreen, signOut } from "./auth.js";
import { state, on, loadAll, startRealtime, stopRealtime, applyTheme } from "./store.js";
import { profile as profileApi } from "./data.js";
import { qs, el, toast } from "./utils.js";
import { icon, brandMark } from "./icons.js";

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
import { generateRecurring } from "./recurring.js";
import { generateSubscriptions } from "./subscriptions.js";

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

// Bottom tab bar (mobile): Home · Movimenti · [ + ] · Cerca · Report
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

init();

async function init() {
  const session = await getSession();
  onAuthChange(handleSession);
  handleSession(session);
}

async function handleSession(session) {
  if (session?.user) {
    if (!booted) {
      booted = true;
      renderShell();
      await loadAll(session.user);
      startRealtime(session.user.id);
      on("change", onStoreChange);
      renderRoute();
      try {
        const n = await generateRecurring();
        if (n) toast(n === 1 ? "1 transazione ricorrente generata" : `${n} transazioni ricorrenti generate`, "success");
      } catch (err) {
        console.warn(err);
      }
      try {
        const n = await generateSubscriptions();
        if (n) toast(n === 1 ? "1 spesa da abbonamento registrata" : `${n} spese da abbonamento registrate`, "success");
      } catch (err) {
        console.warn(err);
      }
    }
  } else {
    booted = false;
    stopRealtime();
    applyTheme("light");
    renderAuthScreen(app, () => {});
  }
}

function onStoreChange() {
  renderRoute();
  updateThemeToggle();
}

function renderShell() {
  app.innerHTML = "";
  app.classList.add("app");

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
            el("button", {
              class: "nav-link",
              "data-route": key,
              onclick: () => navigate(key),
              html: `<span class="nav-link__icon">${icon(r.icon)}</span><span>${r.label}</span>`,
            }),
          ])
        )
    ),
    el("div", { class: "sidebar__foot" }, [
      el("button", {
        class: "nav-link js-theme-toggle",
        onclick: toggleTheme,
        html: `<span class="nav-link__icon">${icon("moon")}</span><span>Tema</span>`,
      }),
      el("button", {
        class: "nav-link",
        "data-route": "impostazioni",
        onclick: () => navigate("impostazioni"),
        html: `<span class="nav-link__icon">${icon("settings")}</span><span>Impostazioni</span>`,
      }),
      el("button", {
        class: "nav-link",
        onclick: async () => { await signOut(); },
        html: `<span class="nav-link__icon">${icon("logout")}</span><span>Esci</span>`,
      }),
    ]),
  ]);

  const closeDrawer = () => drawer.classList.remove("is-open");
  const toggleDrawer = () => drawer.classList.toggle("is-open");
  drawer.addEventListener("click", (e) => {
    if (e.target.closest(".nav-link:not(.js-theme-toggle)")) closeDrawer();
  });

  const appBar = el("header", { class: "app-bar" }, [
    el("button", { class: "icon-btn", "aria-label": "Menu", onclick: toggleDrawer, html: icon("menu", { size: 22 }) }),
    el("span", { class: "app-bar__brand" }, [
      el("span", { class: "icn-wrap", html: brandMark(22) }),
      el("span", { text: "MyWallet" }),
    ]),
    el("span", { class: "app-bar__spacer" }),
    el("button", { class: "icon-btn js-theme-toggle", "aria-label": "Cambia tema", onclick: toggleTheme, html: icon("moon", { size: 22 }) }),
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

  const bottomNav = el(
    "nav",
    { class: "bottom-nav", "aria-label": "Navigazione" },
    [
      ...BOTTOM_LEFT.map(bottomBtn),
      el("button", {
        class: "bottom-nav__fab",
        "aria-label": "Aggiungi spesa o entrata",
        title: "Aggiungi spesa o entrata",
        onclick: () => openTxModal(),
        html: icon("plus", { size: 24, stroke: 2.4 }),
      }),
      ...BOTTOM_RIGHT.map(bottomBtn),
    ]
  );

  app.append(appBar, drawer, scrim, main, bottomNav);

  // Keyboard shortcuts: 1..9 for the sections, "/" for the assistant.
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    if (e.key === "/") {
      e.preventDefault();
      navigate("assistente");
      requestAnimationFrame(() => qs("#assistant-input")?.focus());
      return;
    }
    if (e.key === "Escape") closeDrawer();
    const keys = Object.keys(ROUTES);
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= keys.length) navigate(keys[n - 1]);
  });

  updateThemeToggle();
}

function navigate(route) {
  if (!ROUTES[route]) return;
  currentRoute = route;
  location.hash = route;
  qs(".sidebar")?.classList.remove("is-open");
  renderRoute();
}

window.addEventListener("hashchange", () => {
  const r = location.hash.slice(1);
  if (ROUTES[r] && r !== currentRoute) {
    currentRoute = r;
    renderRoute();
  }
});

function renderRoute() {
  const outlet = qs("#route-outlet");
  if (!outlet) return;
  const route = ROUTES[location.hash.slice(1)] ? location.hash.slice(1) : currentRoute;
  currentRoute = route;

  document.querySelectorAll("[data-route]").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.route === route)
  );

  outlet.classList.remove("view-enter");
  void outlet.offsetWidth;
  outlet.classList.add("view-enter");
  outlet.scrollTo?.({ top: 0 });
  window.scrollTo?.({ top: 0 });

  if (state.loading) {
    outlet.innerHTML = `<div class="view"><div class="skeleton-list">${"<div class='skeleton-row'></div>".repeat(4)}</div></div>`;
    return;
  }
  ROUTES[route].render(outlet);
}

async function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  updateThemeToggle();
  try {
    const updated = await profileApi.update({ theme: next });
    state.profile = updated;
  } catch {
    // Offline: the theme stays applied locally.
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
