// Availability: where the money sits, by payment method.
//  - total wealth
//  - per method: name, icon, balance, share of total, 30-day trend
//  - history of the movements that changed a balance (transfers included;
//    they do not enter statistics/budgets/charts)
import { state, selectors } from "../store.js";
import { el, formatMoney, formatDate, animateCounter } from "../utils.js";
import { icon, iconEl } from "../icons.js";
import { openTransferModal } from "./transactions.js";

const METHODS = [
  { key: "CARTA", label: "Carta", icon: "creditCard" },
  { key: "CONTANTI", label: "Contanti", icon: "banknote" },
];

let scope = "ALL"; // ALL | CARTA | CONTANTI

export function render(container) {
  container.innerHTML = "";
  const bal = selectors.paymentMethodBalances();
  const total = selectors.totalBalance();

  let i = 0;
  const step = () => ({ style: `--i:${i++}` });

  const view = el("div", { class: "view view--avail" }, [
    el("header", { class: "view-head" }, [
      el("div", {}, [
        el("h2", { text: "Disponibilità" }),
        el("p", { class: "muted", text: "Dove si trovano i tuoi soldi, aggiornato in tempo reale" }),
      ]),
      el("button", { class: "btn btn--primary", onclick: () => openTransferModal() }, [iconEl("swap", { size: 17 }), "Sposta denaro"]),
    ]),

    // total wealth
    el("section", { class: "avail-hero", ...step() }, [
      el("div", { class: "avail-hero__glow" }),
      el("span", { class: "avail-hero__label" }, [iconEl("wallet", { size: 15 }), "Patrimonio complessivo"]),
      el("strong", { class: "avail-hero__value", "data-counter": total, "data-value": 0, text: formatMoney(0) }),
      el("span", { class: "avail-hero__hint", text: "Somma di carta e contanti" }),
    ]),

    // per-method availability cards
    el("div", { class: "avail-grid" }, METHODS.map((m) => methodCard(m, bal[m.key], total, step()))),

    // movement history
    el("section", { class: "card glass avail-history", ...step() }, [
      el("div", { class: "avail-history__head" }, [
        el("h3", {}, [el("span", { class: "icn-wrap", html: icon("receipt", { size: 15 }) }), "Movimenti"]),
        segTabs(),
      ]),
      el("div", { id: "avail-list" }),
    ]),
  ]);

  container.append(view);
  view.querySelectorAll("[data-counter]").forEach((n) => animateCounter(n, Number(n.dataset.counter)));
  renderHistory();
}

function methodCard(m, amount, total, attrs) {
  const trend = selectors.methodTrend(m.key, 30);
  const pct = total > 0 && amount > 0 ? Math.round((amount / total) * 100) : null;
  const barW = total > 0 ? Math.max(0, Math.min(100, (amount / total) * 100)) : 0;
  return el("button", {
    class: `avail-card${scope === m.key ? " is-active" : ""}`, ...attrs,
    onclick: () => { scope = scope === m.key ? "ALL" : m.key; refreshTabs(); renderHistory(); syncCards(); },
  }, [
    el("div", { class: "avail-card__top" }, [
      el("span", { class: "avail-card__ic", html: icon(m.icon, { size: 16 }) }),
      el("span", { class: "avail-card__name", text: m.label }),
      pct != null ? el("span", { class: "avail-card__pct", text: `${pct}%` }) : null,
    ]),
    el("strong", { class: "avail-card__value", "data-counter": amount, "data-value": 0, text: formatMoney(0) }),
    el("div", { class: "avail-card__bar" }, [el("span", { class: "avail-card__fill", style: `--w:${barW}%` })]),
    el("span", {
      class: `avail-card__trend avail-card__trend--${trend > 0.005 ? "up" : trend < -0.005 ? "down" : "flat"}`,
    }, [
      trend > 0.005 ? iconEl("arrowUp", { size: 12 }) : trend < -0.005 ? iconEl("arrowDown", { size: 12 }) : null,
      trend === 0 ? "stabile negli ultimi 30 giorni" : `${formatMoney(trend, { sign: true })} negli ultimi 30 giorni`,
    ].filter(Boolean)),
  ]);
}

function syncCards() {
  document.querySelectorAll(".avail-card").forEach((c, idx) => {
    c.classList.toggle("is-active", scope === METHODS[idx]?.key);
  });
}

function segTabs() {
  const opts = [["ALL", "Tutti"], ["CARTA", "Carta"], ["CONTANTI", "Contanti"]];
  return el("div", { class: "avail-tabs", id: "avail-tabs" }, opts.map(([val, label]) =>
    el("button", {
      type: "button",
      class: `avail-tabs__btn${scope === val ? " is-on" : ""}`,
      "data-v": val,
      onclick: () => { scope = val; refreshTabs(); renderHistory(); syncCards(); },
      text: label,
    })
  ));
}
function refreshTabs() {
  document.querySelectorAll("#avail-tabs .avail-tabs__btn").forEach((b) => b.classList.toggle("is-on", b.dataset.v === scope));
}

function renderHistory() {
  const holder = document.getElementById("avail-list");
  if (!holder) return;
  const method = scope === "ALL" ? null : scope;
  const moves = selectors.methodMovements(method);
  holder.innerHTML = "";

  if (!moves.length) {
    holder.append(el("p", { class: "muted avail-empty", text: "Nessun movimento su questa disponibilità." }));
    return;
  }

  // Running balance (only for a single method).
  let running = null;
  if (method) {
    running = {};
    let acc = 0;
    for (const mv of [...moves].reverse()) { acc += mv.delta; running[mv.id] = acc; }
  }

  holder.append(el("ul", { class: "avail-move-list" }, moves.map((mv, k) => {
    const cls = mv.kind === "in" ? "in" : mv.kind === "out" ? "out" : "transfer";
    const amountText = mv.kind === "transfer" && method == null
      ? formatMoney(mv.amount)
      : formatMoney(mv.delta, { sign: true });
    return el("li", { class: `avail-move avail-move--${cls}`, style: `--i:${Math.min(k, 16)}` }, [
      el("span", { class: `avail-move__ic avail-move__ic--${cls}`, html: icon(mv.kind === "in" ? "arrowUp" : mv.kind === "out" ? "arrowDown" : "swap", { size: 14 }) }),
      el("div", { class: "avail-move__body" }, [
        el("strong", { text: mv.title }),
        el("span", { class: "muted", text: [mv.sub, formatDate(mv.date), mv.note].filter(Boolean).join(" · ") }),
      ]),
      el("div", { class: "avail-move__right" }, [
        el("span", { class: `avail-move__amt avail-move__amt--${cls}`, text: amountText }),
        running && running[mv.id] != null
          ? el("span", { class: "avail-move__run muted", text: `saldo ${formatMoney(running[mv.id])}` })
          : null,
      ]),
    ]);
  })));
}
