// Statistics: a few charts, high information value.
//  - month KPIs (expense / income / balance + change)
//  - where the money goes: donut + per-category ranking
//  - income and expenses over the last 6 months
//  - spending pace over the last 8 weeks
import { state, selectors } from "../store.js";
import { el, formatMoney, emptyState, monthKey, animateCounter } from "../utils.js";
import { icon, iconEl } from "../icons.js";
import { donutChart, catColor } from "../chart.js";

export function render(container) {
  container.innerHTML = "";

  if (!state.transactions.length) {
    container.append(el("div", { class: "view" }, [
      el("header", { class: "view-head" }, [el("h2", { text: "Statistiche" })]),
      emptyState("chart", "Registra qualche transazione per vedere le tue statistiche"),
    ]));
    return;
  }

  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const rawMonth = now.toLocaleDateString("it-IT", { month: "long" });
  const monthName = rawMonth.charAt(0).toUpperCase() + rawMonth.slice(1);

  const incNow = selectors.monthIncome();
  const expNow = selectors.monthExpense();
  const incPrev = selectors.monthIncome(prev);
  const expPrev = selectors.monthExpense(prev);

  const byCat = Object.entries(selectors.spentByCategory()).sort((a, b) => b[1] - a[1]);
  const catTotal = byCat.reduce((s, [, v]) => s + v, 0);
  const months6 = last6Months();
  const weeks8 = last8Weeks();

  let i = 0;
  const step = () => ({ style: `--i:${i++}` });

  const view = el("div", { class: "view view--stats" }, [
    el("header", { class: "view-head" }, [
      el("div", {}, [
        el("h2", { text: "Statistiche" }),
        el("p", { class: "muted", text: `Come stai andando a ${monthName}` }),
      ]),
    ]),

    // Month KPIs
    el("div", { class: "stats-kpi", ...step() }, [
      kpi("expense", "trendingDown", `Uscite di ${monthName}`, expNow, delta(expNow, expPrev, false)),
      kpi("income", "trendingUp", `Entrate di ${monthName}`, incNow, delta(incNow, incPrev, true)),
      kpi("balance", "wallet", "Risparmio del mese", incNow - expNow, null),
    ]),

    // Where the money goes
    card(step(), "Dove vanno i tuoi soldi", monthName,
      byCat.length
        ? el("div", { class: "spend-breakdown" }, [
            donutChart(byCat, { showLegend: false }),
            catRank(byCat, catTotal),
          ])
        : emptyState("chart", "Nessuna spesa registrata questo mese")
    ),

    // Income and expenses, 6 months
    card(step(), "Entrate e uscite", "Ultimi 6 mesi", groupedBars(months6)),

    // Spending pace, 8 weeks
    card(step(), "Ritmo di spesa", "Uscite delle ultime 8 settimane", weekBars(weeks8)),

    // Budget CTA
    el("button", { class: "stats-cta card glass", ...step(), onclick: () => { location.hash = "budget"; } }, [
      el("span", { class: "stats-cta__ic", html: icon("wallet", { size: 18 }) }),
      el("div", { class: "stats-cta__txt" }, [
        el("strong", { text: "Imposta un budget per categoria" }),
        el("span", { class: "muted", text: "Un limite mensile su misura per le tue spese" }),
      ]),
      iconEl("chevronRight", { size: 16 }),
    ]),
  ]);

  container.append(view);
  view.querySelectorAll("[data-counter]").forEach((n) => animateCounter(n, Number(n.dataset.counter)));
}

function card(attrs, title, subtitle, content) {
  return el("section", { class: "card glass stats-card", ...attrs }, [
    el("div", { class: "stats-card__head" }, [
      el("h3", { text: title }),
      subtitle ? el("span", { class: "stats-card__sub", text: subtitle }) : null,
    ]),
    content,
  ]);
}

function kpi(kind, iconName, label, value, deltaNode) {
  return el("div", { class: `stat-card stat-card--${kind}` }, [
    el("div", { class: "stat-card__top" }, [
      el("span", { class: "stat-card__icon", html: icon(iconName, { size: 15 }) }),
      el("span", { class: "stat-label", text: label }),
    ]),
    el("strong", { class: "stat-value", "data-counter": value, "data-value": 0, text: formatMoney(0) }),
    deltaNode,
  ]);
}

function delta(now, prev, goodIfUp) {
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

function catRank(byCat, total) {
  const max = byCat[0]?.[1] || 1;
  return el("ul", { class: "cat-rank" }, byCat.slice(0, 7).map(([name, v], i) => {
    const color = catColor(i);
    const pct = total ? Math.round((v / total) * 100) : 0;
    return el("li", { class: "cat-rank__li", style: `--i:${i}` }, [
      el("span", { class: "cat-rank__name" }, [
        el("span", { class: "cat-rank__dot", style: `background:${color}` }),
        el("span", { class: "cat-rank__label", text: name }),
      ]),
      el("span", { class: "cat-rank__bar" }, [
        el("span", { class: "cat-rank__fill", style: `--w:${Math.max(4, (v / max) * 100)}%; background:${color}` }),
      ]),
      el("span", { class: "cat-rank__val" }, [
        el("strong", { text: formatMoney(v) }),
        el("span", { class: "cat-rank__pct", text: `${pct}%` }),
      ]),
    ]);
  }));
}

function groupedBars(months) {
  const max = Math.max(1, ...months.flatMap((m) => [m.income, m.expense]));
  return el("div", { class: "gbar" }, [
    el("div", { class: "gbar__plot" }, months.map((m, i) =>
      el("div", { class: "gbar__col", style: `--i:${i}`, title: `${m.full}: entrate ${formatMoney(m.income)} · uscite ${formatMoney(m.expense)}` }, [
        el("div", { class: "gbar__pair" }, [
          el("span", { class: "gbar__b gbar__b--in", style: `--h:${(m.income / max) * 100}%` }),
          el("span", { class: "gbar__b gbar__b--out", style: `--h:${(m.expense / max) * 100}%` }),
        ]),
        el("span", { class: "gbar__lab", text: m.label }),
      ])
    )),
    el("div", { class: "chart-legend chart-legend--row" }, [
      legendItem("var(--success)", "Entrate"),
      legendItem("var(--danger)", "Uscite"),
    ]),
  ]);
}

function weekBars(weeks) {
  const max = Math.max(1, ...weeks.map((w) => w.value));
  const avg = weeks.reduce((s, w) => s + w.value, 0) / weeks.length;
  return el("div", { class: "wbar" }, [
    el("div", { class: "wbar__plot" }, weeks.map((w, i) =>
      el("div", { class: "wbar__col", style: `--i:${i}`, title: `Settimana del ${w.label}: ${formatMoney(w.value)}` }, [
        el("span", { class: "wbar__track" }, [
          el("span", { class: "wbar__fill", style: `--h:${Math.max(2, (w.value / max) * 100)}%` }),
        ]),
        el("span", { class: "wbar__lab", text: w.label }),
      ])
    )),
    el("p", { class: "wbar__avg" }, [
      el("span", { class: "icn-wrap", html: icon("info", { size: 13 }) }),
      `Media settimanale ${formatMoney(avg)}`,
    ]),
  ]);
}

function legendItem(color, label) {
  return el("span", {}, [el("span", { class: "dot", style: `background:${color}` }), label]);
}

function sum(type, key) {
  return state.transactions
    .filter((t) => t.type === type && monthKey(new Date(t.tx_date)) === key)
    .reduce((s, t) => s + +t.amount, 0);
}

function last6Months() {
  const now = new Date();
  const out = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    out.push({
      label: d.toLocaleDateString("it-IT", { month: "short" }).replace(".", ""),
      full: d.toLocaleDateString("it-IT", { month: "long", year: "numeric" }),
      income: sum("ENTRATA", key),
      expense: sum("USCITA", key),
    });
  }
  return out;
}

function last8Weeks() {
  const weeks = [];
  const now = new Date();
  for (let i = 7; i >= 0; i--) {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i * 7);
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6);
    const value = state.transactions
      .filter((t) => t.type === "USCITA")
      .filter((t) => { const d = new Date(t.tx_date); return d >= start && d <= end; })
      .reduce((s, t) => s + +t.amount, 0);
    weeks.push({ label: `${start.getDate()}/${start.getMonth() + 1}`, value });
  }
  return weeks;
}
