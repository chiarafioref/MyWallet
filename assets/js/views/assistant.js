// Financial assistant: natural-language search + budget advisor.
//  - targeted suggestions per section / category
//  - the answer appears right below the bar (no scroll)
//  - "Budget advisor" wizard (50/30/20 rule)
import { state } from "../store.js";
import { ask, buildTripReport } from "../assistant/engine.js";
import { aiEnabled } from "../assistant/interpreter.js";
import { renderBudgetPlanner } from "../assistant/budget-planner.js";
import { trips as tripApi } from "../data.js";
import { el, qs, formatMoney, debounce, emptyState } from "../utils.js";
import { icon, iconEl } from "../icons.js";

const RECENT_KEY = "mywallet:recent-searches";

const SECTIONS = [
  { value: "all", label: "Tutto", icon: "sparkles" },
  { value: "wallet", label: "Portafoglio", icon: "wallet" },
  { value: "budget", label: "Budget", icon: "wallet" },
  { value: "savings", label: "Risparmi", icon: "savings" },
  { value: "future", label: "Spese future", icon: "calendar" },
  { value: "subscriptions", label: "Abbonamenti", icon: "repeat" },
  { value: "trips", label: "Viaggi", icon: "plane" },
];

// Targeted questions per section.
const SECTION_SUGGESTIONS = {
  all: [
    "Con il mio budget posso permettermi una rata di 70 € al mese?",
    "Quanto ho speso questo mese?",
    "Perché questo mese ho speso più del solito?",
    "Posso comprare una lavatrice da 500 € a rate?",
    "Come posso risparmiare 200 € al mese?",
    "Aiutami a creare un budget personalizzato",
  ],
  wallet: [
    "Quanto ho speso questo mese?",
    "Mostrami le spese superiori a 100 €",
    "Fammi vedere le transazioni pagate con la carta",
    "Quanto ho speso lo scorso weekend?",
    "In media quanto spendo a transazione?",
    "Quante transazioni ho fatto questo mese?",
  ],
  budget: [
    "Come vanno i miei budget?",
    "Quali budget ho superato?",
    "Posso permettermi una rata di 90 € al mese?",
    "Aiutami a creare un budget personalizzato",
    "Configura un budget con la regola 50/30/20",
  ],
  savings: [
    "A che punto sono con i miei obiettivi di risparmio?",
    "Quanto ho risparmiato in totale?",
    "Come posso risparmiare 300 € al mese?",
  ],
  future: [
    "Quali spese future ho pianificato?",
    "Quanto devo ancora accantonare?",
  ],
  subscriptions: [
    "Quanto spendo di abbonamenti al mese?",
    "Quali abbonamenti aumenteranno di prezzo?",
    "Qual è il costo annuale dei miei abbonamenti?",
  ],
  trips: [
    "Quanti viaggi ho fatto?",
  ],
};

// A different question type for each expense category.
const CATEGORY_TEMPLATES = [
  (c) => `Quanto ho speso per ${c} questo mese?`,
  (c) => `Qual è la mia spesa media per ${c}?`,
  (c) => `Mostrami le spese di ${c} degli ultimi 3 mesi`,
  (c) => `Come è cambiata la spesa per ${c} rispetto al mese scorso?`,
  (c) => `Qual è stata la spesa più alta per ${c}?`,
  (c) => `Quante volte ho speso per ${c} questo mese?`,
];

let currentSection = "all";
let lastQuery = "";
let hasResult = false;

function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
}
function pushRecent(q) {
  const list = [q, ...getRecent().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 6);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* no-op */ }
}

function suggestionPool() {
  const base = SECTION_SUGGESTIONS[currentSection] || SECTION_SUGGESTIONS.all;
  let extra = [];
  if (currentSection === "wallet" || currentSection === "all") {
    const cats = [...new Set(state.categories.filter((c) => c.kind === "expense").map((c) => c.name))];
    extra = cats.map((c, i) => CATEGORY_TEMPLATES[i % CATEGORY_TEMPLATES.length](c));
  }
  if (currentSection === "trips" || currentSection === "all") {
    extra = [...extra, ...state.trips.map((t) => `Quanto ho speso durante il viaggio a ${t.name}?`)];
  }
  return [...base, ...extra];
}

export function render(container) {
  container.innerHTML = "";
  const view = el("div", { class: `view assistant${hasResult ? " has-result" : ""}` }, [
    el("header", { class: "view-head" }, [
      el("div", {}, [
        el("h2", { text: "Assistente finanziario" }),
        el("p", { class: "muted", text: aiEnabled() ? "AI attiva · fai una domanda o chiedi aiuto per un budget" : "Fai una domanda sul tuo portafoglio o chiedi aiuto per un budget" }),
      ]),
    ]),

    el("section", { class: "assistant__search card glass" }, [
      el("div", { class: "assistant__bar" }, [
        el("span", { class: "assistant__icon", html: icon("sparkles", { size: 19 }) }),
        el("input", {
          id: "assistant-input",
          type: "text",
          autocomplete: "off",
          placeholder: "Chiedi qualcosa… es. \"Quanto ho speso per i ristoranti?\"",
          value: lastQuery,
          oninput: debounce((e) => renderSuggestions(e.target.value), 120),
          onfocus: () => { qs("#assistant-suggestions")?.classList.remove("is-hidden"); },
          onkeydown: (e) => { if (e.key === "Enter") runQuery(e.target.value); },
        }),
        el("button", { class: "btn btn--primary assistant__go", "aria-label": "Chiedi", onclick: () => runQuery(qs("#assistant-input").value) }, [iconEl("search", { size: 18 })]),
      ]),
      el("div", { class: "assistant__sections" }, SECTIONS.map((s) =>
        el("button", {
          class: `assistant__seg${s.value === currentSection ? " is-active" : ""}`,
          "data-section": s.value,
          onclick: () => { currentSection = s.value; render(container); },
        }, [iconEl(s.icon, { size: 14 }), el("span", { text: s.label })])
      )),
      el("div", { id: "assistant-suggestions", class: `assistant__suggestions${hasResult ? " is-hidden" : ""}` }),
    ]),

    el("div", { id: "assistant-result", class: "assistant__result" }),
    recentBlock(),
  ]);

  container.append(view);
  renderSuggestions(lastQuery);
  if (lastQuery) runQuery(lastQuery, true);
}

function recentBlock() {
  const recent = getRecent();
  if (!recent.length) return el("div", { hidden: true });
  return el("section", { class: "assistant__recent" }, [
    el("span", { class: "assistant__recent-lab muted" }, [iconEl("clock", { size: 13 }), "Ricerche recenti"]),
    el("div", { class: "assistant__recent-list" }, recent.map((q) =>
      el("button", { class: "assistant__recent-item", onclick: () => runQuery(q) }, [
        el("span", { text: q }),
        iconEl("chevronRight", { size: 13 }),
      ])
    )),
  ]);
}

function renderSuggestions(value) {
  const holder = qs("#assistant-suggestions");
  if (!holder) return;
  const v = (value || "").toLowerCase().trim();
  const pool = [...new Set(suggestionPool())];
  const list = (v
    ? pool.filter((s) => s.toLowerCase().includes(v) || v.split(" ").every((w) => s.toLowerCase().includes(w)))
    : pool
  ).slice(0, 8);

  holder.innerHTML = "";
  if (!list.length) return;
  list.forEach((s, i) => {
    holder.append(
      el("button", { class: "assistant__suggestion", style: `--i:${i}`, onclick: () => runQuery(s) }, [
        el("span", { class: "assistant__suggestion-ic", html: icon(/budget/i.test(s) ? "wallet" : "search", { size: 14 }) }),
        el("span", { text: s }),
      ])
    );
  });
}

// Bring the answer into view, after the suggestions collapse (~0.32s).
function scrollResultIntoView() {
  setTimeout(() => {
    const holder = qs("#assistant-result");
    if (!holder) return;
    const r = holder.getBoundingClientRect();
    const appbar = window.innerWidth < 1024 ? 56 : 0;
    // Already visible in a comfortable spot? No need to scroll.
    if (r.top >= appbar - 2 && r.top < window.innerHeight * 0.6) return;
    window.scrollTo({ top: Math.max(0, r.top + window.scrollY - appbar - 12), behavior: "smooth" });
  }, 360);
}

async function runQuery(query, silent = false) {
  const q = (query || "").trim();
  const input = qs("#assistant-input");
  if (input) input.value = q;
  const holder = qs("#assistant-result");
  if (!q || !holder) return;
  lastQuery = q;
  hasResult = true;

  qs(".view.assistant")?.classList.add("has-result");
  qs("#assistant-suggestions")?.classList.add("is-hidden");

  holder.innerHTML = "";
  holder.append(el("div", { class: "assistant__loading" }, [
    el("span", { class: "assistant__loading-dot" }), el("span", { class: "assistant__loading-dot" }), el("span", { class: "assistant__loading-dot" }),
  ]));

  let res;
  try {
    res = await ask(q, currentSection);
  } catch (err) {
    holder.innerHTML = "";
    holder.append(emptyState("alert", `Non sono riuscito a elaborare la richiesta: ${err.message}`));
    return;
  }
  if (!silent) pushRecent(q);

  holder.innerHTML = "";
  if (!res) { holder.append(emptyState("search", "Prova a riformulare la domanda.")); return; }

  // budget advisor
  if (res.planner || res.spec?.intent === "budget_planner") {
    const mount = el("div", { class: "assistant__planner fade-in" });
    holder.append(mount);
    renderBudgetPlanner(mount, {
      onDone: (r) => {
        hasResult = false;
        lastQuery = "";
        if (r?.created) { location.hash = "budget"; return; }
        const outlet = qs("#route-outlet");
        if (outlet) render(outlet);
      },
    });
    requestAnimationFrame(scrollResultIntoView);
    return;
  }

  // trip detail (async)
  if (res.loadTrip && res.tripId) {
    try {
      const trip = state.trips.find((t) => t.id === res.tripId);
      const [expenses, members] = await Promise.all([
        tripApi.listExpenses(res.tripId),
        tripApi.members(res.tripId),
      ]);
      res = buildTripReport(trip, expenses, members, res.spec || {});
    } catch (err) {
      holder.append(emptyState("alert", `Impossibile caricare il viaggio: ${err.message}`));
      return;
    }
  }

  renderResult(holder, res);
  requestAnimationFrame(scrollResultIntoView);
}

function renderResult(holder, res) {
  let i = 0;
  const step = () => ({ style: `--i:${i++}` });

  const answerLines = String(res.answer || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
  holder.append(
    el("section", { class: "card glass assistant__answer", ...step() }, [
      el("div", { class: "assistant__answer-head" }, [
        el("span", { class: "assistant__answer-avatar", html: icon("sparkles", { size: 15 }) }),
        el("span", { class: "assistant__answer-badge", text: res.spec?.source === "ai" ? "AI" : "assistente" }),
        res.spec?.periodLabel && res.spec.periodLabel !== "tutto il periodo"
          && !["affordability", "budget_planner"].includes(res.spec.intent)
          ? el("span", { class: "assistant__answer-period muted", text: res.spec.periodLabel })
          : null,
      ]),
      ...(answerLines.length ? answerLines.map((line) => el("p", { class: "assistant__answer-p", text: line })) : [el("p", { text: res.answer })]),
    ])
  );

  if (res.summary?.length) {
    holder.append(el("div", { class: "assistant__summary", ...step() }, res.summary.map((s) =>
      el("div", { class: `assistant__stat${s.kind ? " assistant__stat--" + s.kind : ""}` }, [
        el("span", { class: "assistant__stat-lab", text: s.label }),
        el("strong", { class: "assistant__stat-val", text: s.value }),
      ])
    )));
  }

  if (res.stats?.length) {
    holder.append(el("section", { class: "card glass", ...step() }, [
      el("h3", {}, [el("span", { class: "icn-wrap", html: icon("chart", { size: 15 }) }), "Dettaglio"]),
      el("ul", { class: "report-list" }, res.stats.map((s) =>
        el("li", {}, [el("span", { text: s.label }), el("strong", { text: s.value })])
      )),
    ]));
  }

  if (res.rows?.length) {
    holder.append(el("section", { class: "card glass", ...step() }, [
      el("h3", {}, [el("span", { class: "icn-wrap", html: icon("receipt", { size: 15 }) }), `Transazioni (${res.rows.length})`]),
      el("ul", { class: "tx-list" }, res.rows.slice(0, 60).map((r, k) =>
        el("li", { class: "tx-row", style: `--i:${Math.min(k, 12)}` }, [
          el("div", { class: "tx-row__main" }, [
            el("strong", { text: r.title }),
            r.subtitle ? el("span", { class: "tx-row__meta muted", text: r.subtitle }) : null,
          ]),
          r.type && r.type !== "INFO"
            ? el("span", {
                class: `tx-amount tx-amount--${r.amount >= 0 ? "in" : "out"}`,
                text: formatMoney(r.amount, { sign: true }),
              })
            : null,
        ])
      )),
    ]));
  }

  if (res.tripId) {
    holder.append(el("button", {
      class: "btn btn--ghost assistant__cta", ...step(),
      onclick: () => { location.hash = "viaggio"; },
    }, [iconEl("plane", { size: 16 }), "Vai alla sezione Viaggi"]));
  }
}
