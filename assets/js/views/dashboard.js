// Dashboard: monthly overview with counters and micro-animations.
import { state, selectors } from "../store.js";
import { el, formatMoney, formatDate, animateCounter, emptyState } from "../utils.js";
import { icon, iconEl } from "../icons.js";
import { donutChart } from "../chart.js";
import { openTransferModal } from "./transactions.js";

export function render(container) {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const monthName = now.toLocaleDateString("it-IT", { month: "long" });

  const balance = selectors.totalBalance();
  const income = selectors.monthIncome();
  const expense = selectors.monthExpense();
  const net = income - expense;
  const prevIncome = selectors.monthIncome(prev);
  const prevExpense = selectors.monthExpense(prev);
  const savings = selectors.totalSavings();
  const budgetTotal = state.budgets.reduce((s, b) => s + +b.monthly_limit, 0);
  const budgetLeft = selectors.budgetRemaining();
  const budgetUsed = Math.max(0, budgetTotal - budgetLeft);
  const budgetPct = budgetTotal ? Math.min(100, Math.round((budgetUsed / budgetTotal) * 100)) : 0;
  const nextFuture = selectors.nextFutureExpense();
  const last5 = state.transactions.slice(0, 5);
  const byCat = Object.entries(selectors.spentByCategory()).sort((a, b) => b[1] - a[1]);
  const promoAlerts = selectors.subscriptionPromoAlerts(7);

  let i = 0;
  const step = () => ({ style: `--i:${i++}` });

  container.innerHTML = "";
  const view = el("div", { class: "view view--dashboard" }, [
    el("header", { class: "view-head" }, [
      el("div", {}, [
        el("h2", { text: "Dashboard" }),
        el("p", { class: "muted", text: `Ciao ${state.profile.first_name || ""}, ecco la tua situazione` }),
      ]),
    ]),

    // Total balance (hero)
    el("section", { class: "dash-balance", ...step() }, [
      el("div", { class: "dash-balance__glow" }),
      el("div", { class: "dash-balance__head" }, [
        el("span", { class: "dash-balance__label" }, [iconEl("wallet", { size: 15 }), "Saldo totale"]),
        net !== 0
          ? el("span", { class: `dash-chip dash-chip--${net >= 0 ? "in" : "out"}` }, [
              iconEl(net >= 0 ? "trendingUp" : "trendingDown", { size: 13 }),
              `${formatMoney(net, { sign: true })} a ${monthName}`,
            ])
          : null,
      ]),
      el("strong", {
        class: "dash-balance__value",
        "data-counter": balance, "data-value": 0, text: formatMoney(0),
      }),
      el("div", { class: "dash-balance__split" }, [
        splitItem("in", "trendingUp", "Entrate", income, deltaLine(income, prevIncome, true)),
        splitItem("out", "trendingDown", "Uscite", expense, deltaLine(expense, prevExpense, false)),
      ]),
    ]),

    // Balance by payment method
    methodsCard(step()),

    // Stats grid
    el("div", { class: "stat-grid" }, [
      flowCard(step(), "savings", "trophy", "Risparmi totali", savings, savings > 0 ? el("span", { class: "stat-sub muted", text: "obiettivi in corso" }) : null),
      budgetCard(step(), budgetLeft, budgetTotal, budgetUsed, budgetPct),
      futureCard(step(), nextFuture),
    ]),

    // Promo alerts
    ...promoAlerts.map((p, k) =>
      el("section", { class: "card glass promo-alert fade-in", style: `--i:${k}` }, [
        el("strong", {}, [
          el("span", { class: "icn-wrap", html: icon("alert", { size: 16 }) }),
          "Abbonamento in promozione in scadenza",
        ]),
        el("p", {
          text: `${p.sub.name} passerà da ${formatMoney(p.from)} a ${formatMoney(p.to)} il ${formatDate(p.sub.promo_end_date)}. Il tuo costo mensile per gli abbonamenti aumenterà di ${formatMoney(p.monthlyDelta)}.`,
        }),
      ])
    ),

    // Chart + timeline
    el("div", { class: "dash-columns" }, [
      el("section", { class: "card glass dash-panel", ...step() }, [
        el("h3", {}, [el("span", { class: "icn-wrap", html: icon("chart", { size: 16 }) }), "Spese per categoria"]),
        byCat.length
          ? donutChart(byCat)
          : emptyState("chart", "Nessuna spesa registrata questo mese"),
      ]),
      el("section", { class: "card glass dash-panel", ...step() }, [
        el("h3", {}, [el("span", { class: "icn-wrap", html: icon("receipt", { size: 16 }) }), "Ultime transazioni"]),
        last5.length
          ? el(
              "ul",
              { class: "tx-timeline" },
              last5.map((t, k) =>
                el("li", { class: "tx-timeline__item", style: `--i:${k}` }, [
                  el("span", { class: `tx-timeline__badge tx-timeline__badge--${t.type === "ENTRATA" ? "in" : "out"}`, html: icon(t.type === "ENTRATA" ? "arrowUp" : "arrowDown", { size: 15 }) }),
                  el("div", { class: "tx-timeline__body" }, [
                    el("strong", { text: t.title }),
                    el("span", { class: "muted", text: `${t.category_name || ""} · ${formatDate(t.tx_date)}` }),
                  ]),
                  el("span", {
                    class: `tx-amount tx-amount--${t.type === "ENTRATA" ? "in" : "out"}`,
                    text: formatMoney(t.type === "ENTRATA" ? +t.amount : -t.amount, { sign: true }),
                  }),
                ])
              )
            )
          : emptyState("receipt", "Ancora nessuna transazione"),
      ]),
    ]),
  ]);

  container.append(view);
  view.querySelectorAll("[data-counter]").forEach((n) =>
    animateCounter(n, Number(n.dataset.counter))
  );
}

function methodsCard(attrs) {
  const bal = selectors.paymentMethodBalances();
  const method = (key, label, iconName) =>
    el("div", { class: "dash-method" }, [
      el("span", { class: "dash-method__ic", html: icon(iconName, { size: 15 }) }),
      el("div", {}, [
        el("span", { class: "dash-method__label muted", text: label }),
        el("strong", { class: "dash-method__value", text: formatMoney(bal[key]) }),
      ]),
    ]);
  return el("section", { class: "card glass dash-methods", ...attrs }, [
    el("div", { class: "dash-methods__head" }, [
      el("button", { class: "dash-methods__title", onclick: () => { location.hash = "disponibilita"; } }, [
        el("span", { class: "icn-wrap", html: icon("wallet", { size: 15 }) }),
        "Disponibilità per metodo",
        el("span", { class: "icn-wrap", html: icon("chevronRight", { size: 14 }) }),
      ]),
      el("button", { class: "btn btn--ghost btn--sm", onclick: () => openTransferModal() }, [iconEl("swap", { size: 15 }), "Sposta denaro"]),
    ]),
    el("div", { class: "dash-methods__grid" }, [
      method("CARTA", "Carta", "creditCard"),
      method("CONTANTI", "Contanti", "banknote"),
    ]),
  ]);
}

function splitItem(dir, iconName, label, value, delta) {
  return el("div", { class: `dash-split dash-split--${dir}` }, [
    el("span", { class: "dash-split__icn", html: icon(iconName, { size: 15 }) }),
    el("div", { class: "dash-split__body" }, [
      el("span", { class: "dash-split__label" }, [label, delta || null]),
      el("strong", { class: "dash-split__value", text: formatMoney(value) }),
    ]),
  ]);
}

function statShell(attrs, kind, iconName, label, children) {
  return el("div", { class: `stat-card stat-card--${kind}`, ...attrs }, [
    el("div", { class: "stat-card__top" }, [
      el("span", { class: "stat-card__icon", html: icon(iconName, { size: 16 }) }),
      el("span", { class: "stat-label", text: label }),
    ]),
    ...children,
  ]);
}

function flowCard(attrs, kind, iconName, label, value, sub) {
  return statShell(attrs, kind, iconName, label, [
    el("strong", { class: "stat-value", "data-counter": value, "data-value": 0, text: formatMoney(0) }),
    sub || null,
  ]);
}

function budgetCard(attrs, left, total, used, pct) {
  const level = pct >= 100 ? "danger" : pct >= 80 ? "warn" : "ok";
  return statShell(attrs, "budget", "wallet", "Budget rimanente", [
    el("strong", { class: "stat-value", "data-counter": total ? left : 0, "data-value": 0, text: formatMoney(total ? left : 0) }),
    total
      ? el("div", { class: "stat-mini" }, [
          el("div", { class: `progress progress--${level}` }, [el("div", { class: "progress__bar", style: `--pct:${pct}%` })]),
          el("span", { class: "stat-sub muted", text: `${formatMoney(used)} di ${formatMoney(total)} usati` }),
        ])
      : el("span", { class: "stat-sub muted", text: "Nessun budget impostato" }),
  ]);
}

function futureCard(attrs, fe) {
  return statShell(attrs, "future", "calendar", "Prossima spesa futura", [
    fe
      ? el("div", { class: "stat-next" }, [
          el("strong", { class: "stat-value", text: formatMoney(fe.total_amount) }),
          el("span", { class: "stat-sub muted", text: `${fe.name} · ${formatDate(fe.due_date)}` }),
        ])
      : el("span", { class: "stat-value stat-value--empty", text: "—" }),
  ]);
}

function deltaLine(now, prev, goodIfUp) {
  if (!prev) return null;
  const diff = now - prev;
  const pct = Math.round((diff / prev) * 100);
  const up = diff >= 0;
  const good = goodIfUp ? up : !up;
  return el("span", { class: `stat-delta stat-delta--${good ? "good" : "bad"}` }, [
    iconEl(up ? "arrowUp" : "arrowDown", { size: 12 }),
    `${Math.abs(pct)}% vs mese scorso`,
  ]);
}
