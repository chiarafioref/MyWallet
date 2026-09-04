// Monthly analysis: a bank-statement-style report for the month.
//  - summary (income first, then expenses) + opening/closing balance
//  - month metrics (savings, budgets respected, goals, etc.)
//  - detailed expense-distribution chart
//  - full list of incoming and outgoing movements
//  - export to a tidy PDF with logo and app name as a watermark
import { state, selectors } from "../store.js";
import { el, qs, formatMoney, formatDate, isSameMonth, monthKey } from "../utils.js";
import { icon, iconEl, brandMark } from "../icons.js";
import { donutChart, catColor } from "../chart.js";

let refDate = new Date();

const MONTHS = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];
const monthLabel = (d) => `${cap(MONTHS[d.getMonth()])} ${d.getFullYear()}`;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function render(container) {
  container.innerHTML = "";
  const view = el("div", { class: "view view--analysis" }, [
    el("header", { class: "view-head" }, [
      el("div", {}, [
        el("h2", { text: "Report mensile" }),
        el("p", { class: "muted", text: "Il tuo estratto conto, mese per mese" }),
      ]),
      el("div", { class: "analysis-tools" }, [
        monthPicker(),
        el("button", { class: "btn btn--primary", id: "analysis-pdf" }, [iconEl("download", { size: 17 }), "Salva PDF"]),
      ]),
    ]),
    el("div", { id: "analysis-body" }),
  ]);
  container.append(view);
  renderBody();
}

function monthPicker() {
  const now = new Date();
  const value = `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, "0")}`;
  return el("input", {
    type: "month",
    class: "month-picker",
    value,
    max: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    onchange: (e) => {
      if (!e.target.value) return;
      const [y, m] = e.target.value.split("-").map(Number);
      refDate = new Date(y, m - 1, 1);
      renderBody();
    },
  });
}

function computeReport() {
  const y = refDate.getFullYear();
  const m = refDate.getMonth();
  const monthStart = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const now = new Date();
  const isCurrentMonth = y === now.getFullYear() && m === now.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const days = isCurrentMonth ? now.getDate() : daysInMonth;

  const monthTx = state.transactions
    .filter((t) => monthKey(new Date(t.tx_date)) === monthKey(refDate))
    .slice()
    .sort((a, b) => a.tx_date.localeCompare(b.tx_date) || a.title.localeCompare(b.title));

  const incomeTx = monthTx.filter((t) => t.type === "ENTRATA");
  const expenseTx = monthTx.filter((t) => t.type === "USCITA");
  const income = incomeTx.reduce((s, t) => s + +t.amount, 0);
  const expense = expenseTx.reduce((s, t) => s + +t.amount, 0);
  const net = income - expense;

  const saldoInizio = state.transactions
    .filter((t) => t.tx_date < monthStart)
    .reduce((s, t) => s + (t.type === "ENTRATA" ? +t.amount : -t.amount), 0);
  const saldoFine = saldoInizio + net;

  const byCat = Object.entries(selectors.spentByCategory(refDate)).sort((a, b) => b[1] - a[1]);
  const topCat = byCat[0] || null;

  const savedThisMonth = state.goalContributions
    .filter((c) => isSameMonth(c.contributed_on, refDate) && +c.amount > 0)
    .reduce((s, c) => s + +c.amount, 0);

  const spentMap = selectors.spentByCategory(refDate);
  const budgetRows = state.budgets.map((b) => {
    const name = selectors.categoryName(b.category_id);
    const spent = spentMap[name] || 0;
    return { name, limit: +b.monthly_limit, spent, over: spent - +b.monthly_limit, respected: spent <= +b.monthly_limit };
  }).sort((a, b) => b.spent - a.spent);
  const respected = budgetRows.filter((r) => r.respected).length;

  const goalsReached = state.goals.filter((g) => g.target_amount && selectors.goalSaved(g.id) >= +g.target_amount);

  const worst = [...budgetRows].sort((a, b) => b.over - a.over)[0];
  const savable = [...budgetRows].filter((r) => r.over < 0).sort((a, b) => a.over - b.over)[0];
  let advice;
  if (worst && worst.over > 0) {
    advice = `Hai superato il budget di "${worst.name}" di ${formatMoney(worst.over)}. Il prossimo mese prova a contenere questa spesa.`;
  } else if (savable) {
    advice = `Ottimo controllo su "${savable.name}": hai speso ${formatMoney(-savable.over)} in meno del budget. Potresti spostare la differenza nei risparmi.`;
  } else {
    advice = "Imposta dei budget per categoria per ricevere consigli mirati su dove risparmiare.";
  }

  return {
    y, m, label: monthLabel(refDate), isCurrentMonth,
    holder: `${state.profile.first_name || ""} ${state.profile.last_name || ""}`.trim() || "Titolare",
    income, expense, net, saldoInizio, saldoFine,
    incomeTx, expenseTx, monthTx, byCat, topCat,
    savedThisMonth, budgetRows, respected, goalsReached, advice,
    avgPerDay: days ? expense / days : 0,
    days,
  };
}

function renderBody() {
  const holder = qs("#analysis-body");
  if (!holder) return;
  const d = computeReport();

  const pdfBtn = qs("#analysis-pdf");
  if (pdfBtn) {
    pdfBtn.onclick = () => exportPDF(computeReport());
    pdfBtn.disabled = !d.monthTx.length;
  }

  let i = 0;
  const step = () => ({ style: `--i:${i++}` });

  holder.innerHTML = "";

  if (!d.monthTx.length) {
    holder.append(
      coverCard(d, step()),
      el("div", { class: "an-empty card glass", ...step() }, [
        el("span", { class: "icn-wrap", html: icon("receipt", { size: 32 }) }),
        el("p", { text: `Nessun movimento registrato a ${d.label}.` }),
      ])
    );
    return;
  }

  holder.append(
    coverCard(d, step()),

    // month metrics
    el("div", { class: "an-metrics", ...step() }, [
      metric("Risparmi del mese", formatMoney(d.savedThisMonth), "savings", "savings"),
      metric("Budget rispettati", `${d.respected} / ${state.budgets.length || 0}`, "wallet", "budget"),
      metric("Obiettivi raggiunti", String(d.goalsReached.length), "trophy", "savings"),
      metric("Spesa media al giorno", formatMoney(d.avgPerDay), "calendar", "expense"),
      metric("Categoria più costosa", d.topCat ? d.topCat[0] : "—", "chart", "neutral", d.topCat ? formatMoney(d.topCat[1]) : null),
    ]),

    // distribution chart
    card(step(), "Distribuzione delle spese", d.label,
      d.byCat.length
        ? el("div", { class: "an-dist" }, [
            donutChart(d.byCat, { showLegend: false }),
            catRank(d.byCat, d.expense),
          ])
        : el("p", { class: "muted", text: "Nessuna spesa in questo mese." })
    ),

    // incoming movements (first)
    txSection(step(), "Movimenti in entrata", d.incomeTx, "in", d.income),

    // outgoing movements (then)
    txSection(step(), "Movimenti in uscita", d.expenseTx, "out", d.expense),

    // budgets
    card(step(), "Budget del mese", d.label,
      d.budgetRows.length
        ? el("ul", { class: "report-list" }, d.budgetRows.map((r) =>
            el("li", {}, [
              el("span", { text: r.name }),
              el("span", { class: "muted", text: `${formatMoney(r.spent)} / ${formatMoney(r.limit)}` }),
              el("strong", { class: r.respected ? "tx-amount--in" : "tx-amount--out", text: r.respected ? "Rispettato" : `+${formatMoney(r.over)}` }),
            ])
          ))
        : el("p", { class: "muted", text: "Nessun budget impostato." })
    ),

    // advice
    el("section", { class: "card glass an-advice", ...step() }, [
      el("h3", {}, [el("span", { class: "icn-wrap", html: icon("lightbulb", { size: 16 }) }), "Consiglio"]),
      el("p", { text: d.advice }),
    ]),
  );

  // animated counters
  holder.querySelectorAll("[data-count]").forEach((n) => animateValue(n, +n.dataset.count));
}

function coverCard(d, attrs) {
  return el("section", { class: "an-cover", ...attrs }, [
    el("div", { class: "an-cover__glow" }),
    el("div", { class: "an-cover__top" }, [
      el("span", { class: "an-cover__brand" }, [el("span", { class: "icn-wrap", html: brandMark(20) }), "MyWallet"]),
      el("span", { class: "an-cover__period", text: `Estratto conto · ${d.label}` }),
    ]),
    el("p", { class: "an-cover__holder", text: d.holder }),
    el("div", { class: "an-cover__flow" }, [
      flowItem("in", "trendingUp", "Entrate del mese", d.income),
      flowItem("out", "trendingDown", "Uscite del mese", d.expense),
    ]),
    el("div", { class: "an-cover__balance" }, [
      balPill("Saldo iniziale", d.saldoInizio),
      el("span", { class: "an-cover__arrow", html: icon("chevronRight", { size: 14 }) }),
      balPill("Risultato", d.net, true),
      el("span", { class: "an-cover__arrow", html: icon("chevronRight", { size: 14 }) }),
      balPill("Saldo finale", d.saldoFine, false, true),
    ]),
  ]);
}

function flowItem(dir, iconName, label, value) {
  return el("div", { class: `an-flow an-flow--${dir}` }, [
    el("span", { class: "an-flow__ic", html: icon(iconName, { size: 15 }) }),
    el("div", {}, [
      el("span", { class: "an-flow__lab", text: label }),
      el("strong", { class: "an-flow__val", "data-count": value, text: formatMoney(0) }),
    ]),
  ]);
}

function balPill(label, value, sign = false, strong = false) {
  return el("div", { class: `an-bal${strong ? " an-bal--strong" : ""}` }, [
    el("span", { class: "an-bal__lab", text: label }),
    el("strong", { class: "an-bal__val", text: formatMoney(value, { sign }) }),
  ]);
}

function metric(label, value, iconName, kind, sub) {
  return el("div", { class: `stat-card stat-card--${kind}` }, [
    el("div", { class: "stat-card__top" }, [
      el("span", { class: "stat-card__icon", html: icon(iconName, { size: 15 }) }),
      el("span", { class: "stat-label", text: label }),
    ]),
    el("strong", { class: "stat-value stat-value--sm", text: value }),
    sub ? el("span", { class: "stat-sub muted", text: sub }) : null,
  ]);
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

function catRank(byCat, total) {
  const max = byCat[0]?.[1] || 1;
  return el("ul", { class: "cat-rank" }, byCat.slice(0, 8).map(([name, v], i) => {
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

function txSection(attrs, title, rows, dir, total) {
  return el("section", { class: "card glass stats-card an-txs", ...attrs }, [
    el("div", { class: "stats-card__head" }, [
      el("h3", { text: title }),
      el("span", { class: `an-txs__total an-txs__total--${dir}`, text: `${dir === "in" ? "+ " : "− "}${formatMoney(total)}` }),
    ]),
    rows.length
      ? el("ul", { class: "an-tx-list" }, rows.map((t, k) =>
          el("li", { class: "an-tx", style: `--i:${Math.min(k, 16)}` }, [
            el("span", { class: `an-tx__ic an-tx__ic--${dir}`, html: icon(dir === "in" ? "arrowUp" : "arrowDown", { size: 14 }) }),
            el("div", { class: "an-tx__body" }, [
              el("strong", { text: t.title }),
              el("span", { class: "an-tx__meta muted", text: [formatDate(t.tx_date), t.category_name, t.payment_method === "CONTANTI" ? "Contanti" : "Carta"].filter(Boolean).join(" · ") }),
            ]),
            el("span", { class: `tx-amount tx-amount--${dir}`, text: `${dir === "in" ? "+ " : "− "}${formatMoney(+t.amount)}` }),
          ])
        ))
      : el("p", { class: "muted", text: dir === "in" ? "Nessuna entrata registrata." : "Nessuna spesa registrata." }),
  ]);
}

function animateValue(node, to) {
  const start = performance.now();
  const dur = 650;
  function tick(now) {
    const p = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    node.textContent = formatMoney(to * e);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// PDF export (new window + print).
function exportPDF(d) {
  const w = window.open("", "_blank", "width=900,height=1200");
  if (!w) {
    alert("Consenti le finestre pop-up per salvare il report in PDF.");
    return;
  }
  w.document.open();
  w.document.write(reportHTML(d));
  w.document.close();
  const done = () => { try { w.focus(); w.print(); } catch { /* no-op */ } };
  const ready = () => {
    const fonts = w.document.fonts && w.document.fonts.ready ? w.document.fonts.ready : Promise.resolve();
    fonts.then(() => setTimeout(done, 250)).catch(() => setTimeout(done, 400));
  };
  if (w.document.readyState === "complete") ready();
  else w.addEventListener("load", ready);
}

function reportHTML(d) {
  const gen = new Date().toLocaleString("it-IT", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const donut = donutChart(d.byCat, { showLegend: false, size: 150 }).outerHTML;

  const catTotal = d.expense || 1;
  const distBars = d.byCat.map(([name, v], i) => `
    <div class="pdf-cat">
      <span class="pdf-cat__n"><i style="background:${catColor(i)}"></i>${esc(name)}</span>
      <span class="pdf-cat__track"><i style="width:${Math.max(3, (v / (d.byCat[0][1] || 1)) * 100)}%;background:${catColor(i)}"></i></span>
      <span class="pdf-cat__v">${formatMoney(v)} · ${Math.round((v / catTotal) * 100)}%</span>
    </div>`).join("");

  const txTable = (rows, dir, total) => `
    <table class="pdf-tx">
      <thead><tr>
        <th style="width:16%">Data</th><th>Descrizione</th><th style="width:22%">Categoria</th>
        <th style="width:12%">Metodo</th><th style="width:16%;text-align:right">Importo</th>
      </tr></thead>
      <tbody>
        ${rows.length ? rows.map((t) => `<tr>
          <td>${formatDate(t.tx_date)}</td>
          <td>${esc(t.title)}${t.description ? `<span class="pdf-desc">${esc(t.description)}</span>` : ""}</td>
          <td>${esc(t.category_name || "—")}</td>
          <td>${t.payment_method === "CONTANTI" ? "Contanti" : "Carta"}</td>
          <td class="r ${dir === "in" ? "in" : "out"}">${dir === "in" ? "+ " : "− "}${formatMoney(+t.amount)}</td>
        </tr>`).join("") : `<tr><td colspan="5" class="muted">Nessun movimento.</td></tr>`}
      </tbody>
      <tfoot><tr>
        <td colspan="4">Totale ${dir === "in" ? "entrate" : "uscite"} (${rows.length})</td>
        <td class="r ${dir === "in" ? "in" : "out"}">${dir === "in" ? "+ " : "− "}${formatMoney(total)}</td>
      </tr></tfoot>
    </table>`;

  const budgetTable = d.budgetRows.length ? `
    <table class="pdf-tx pdf-tx--budget">
      <thead><tr><th>Categoria</th><th style="width:22%;text-align:right">Speso</th><th style="width:22%;text-align:right">Limite</th><th style="width:20%;text-align:right">Esito</th></tr></thead>
      <tbody>${d.budgetRows.map((r) => `<tr>
        <td>${esc(r.name)}</td>
        <td class="r">${formatMoney(r.spent)}</td>
        <td class="r">${formatMoney(r.limit)}</td>
        <td class="r ${r.respected ? "in" : "out"}">${r.respected ? "Rispettato" : "+" + formatMoney(r.over)}</td>
      </tr>`).join("")}</tbody>
    </table>` : `<p class="muted">Nessun budget impostato.</p>`;

  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<title>Report ${esc(d.label)} — MyWallet</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 15mm 13mm 20mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  :root { --p: #4f46e5; --ink: #101828; --mut: #667085; --line: #e4e7ec; --in: #067647; --out: #d92d20; --s3: #eef0f4; --text: #101828; --text-2: #667085; --surface-3: #eef0f4; }
  body { font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); font-size: 10.5px; line-height: 1.5; position: relative; }
  .wm { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-24deg); display: flex; flex-direction: column; align-items: center; gap: 14px; opacity: 0.06; z-index: 0; pointer-events: none; }
  .wm svg { width: 200px; height: 200px; color: var(--p); }
  .wm b { font-size: 68px; font-weight: 800; letter-spacing: -0.03em; color: var(--p); }
  .foot { margin-top: 18px; padding-top: 8px; border-top: 1px solid var(--line); text-align: center; font-size: 8px; color: var(--mut); }
  .foot b { color: var(--p); }
  .doc { position: relative; z-index: 1; }

  .cover { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .cover__bar { background: linear-gradient(135deg, #4f46e5, #6d28d9 60%, #4338ca); color: #fff; padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; }
  .cover__bar .brand { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 13px; }
  .cover__bar .brand svg { width: 22px; height: 22px; }
  .cover__bar .per { font-size: 10px; opacity: .9; }
  .cover__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
  .cover__grid > div { padding: 12px 16px; border-right: 1px solid var(--line); }
  .cover__grid > div:last-child { border-right: 0; }
  .cover__grid .k { font-size: 8.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--mut); }
  .cover__grid .v { font-size: 17px; font-weight: 800; margin-top: 2px; }
  .v.in { color: var(--in); } .v.out { color: var(--out); }
  .cover__bal { display: flex; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--line); background: #fafbfc; font-size: 9.5px; }
  .cover__bal span { flex: 1; }
  .cover__bal b { display: block; font-size: 12px; margin-top: 1px; }
  .cover__holder { padding: 8px 16px 0; font-size: 10px; color: var(--mut); }

  .metrics { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-top: 14px; }
  .metric { border: 1px solid var(--line); border-radius: 8px; padding: 8px 9px; }
  .metric .k { font-size: 8px; text-transform: uppercase; letter-spacing: .04em; color: var(--mut); }
  .metric .v { font-size: 12.5px; font-weight: 700; margin-top: 3px; }

  .section { margin-top: 16px; page-break-inside: auto; }
  .section > h2 { font-size: 12px; font-weight: 700; padding-bottom: 4px; margin-bottom: 8px; border-bottom: 2px solid var(--p); display: flex; justify-content: space-between; align-items: baseline; }
  .section > h2 .t { font-size: 11px; font-weight: 700; }
  .section > h2 .t.in { color: var(--in); } .section > h2 .t.out { color: var(--out); }

  .dist { display: flex; gap: 18px; align-items: flex-start; }
  .chart--donut { display: flex; gap: 14px; align-items: center; flex-shrink: 0; }
  .donut-svg { width: 132px; height: 132px; }
  .donut-total { font-size: 13px; font-weight: 800; fill: var(--ink); }
  .donut-sub { font-size: 7px; fill: var(--mut); text-transform: uppercase; letter-spacing: .05em; }
  .chart-legend { list-style: none; display: flex; flex-direction: column; gap: 3px; }
  .chart-legend li { display: flex; align-items: center; gap: 6px; font-size: 8.5px; }
  .chart-legend .dot { width: 8px; height: 8px; border-radius: 2px; }
  .chart-legend .lg-label { min-width: 70px; }
  .chart-legend .lg-value { font-weight: 700; }
  .chart-legend .lg-pct { color: var(--mut); }
  .pdf-cats { flex: 1; display: flex; flex-direction: column; gap: 6px; }
  .pdf-cat { display: grid; grid-template-columns: 30% 1fr auto; align-items: center; gap: 8px; font-size: 9px; }
  .pdf-cat__n { display: flex; align-items: center; gap: 5px; font-weight: 600; }
  .pdf-cat__n i { width: 8px; height: 8px; border-radius: 2px; }
  .pdf-cat__track { height: 7px; background: var(--s3); border-radius: 4px; overflow: hidden; }
  .pdf-cat__track i { display: block; height: 100%; border-radius: 4px; }
  .pdf-cat__v { font-weight: 700; white-space: nowrap; }

  table.pdf-tx { width: 100%; border-collapse: collapse; }
  table.pdf-tx th { text-align: left; font-size: 7.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--mut); border-bottom: 1.5px solid #d0d5dd; padding: 5px 4px; }
  table.pdf-tx td { padding: 4px 4px; border-bottom: 1px solid var(--line); vertical-align: top; }
  table.pdf-tx tr { page-break-inside: avoid; }
  table.pdf-tx .r { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.pdf-tx .in { color: var(--in); font-weight: 700; }
  table.pdf-tx .out { color: var(--out); font-weight: 700; }
  table.pdf-tx tfoot td { font-weight: 800; border-top: 1.5px solid #d0d5dd; border-bottom: 0; padding-top: 6px; }
  .pdf-desc { display: block; font-size: 8px; color: var(--mut); font-style: italic; }
  .muted { color: var(--mut); }
  .advice { margin-top: 14px; border: 1px solid var(--line); border-left: 3px solid var(--p); border-radius: 6px; padding: 9px 11px; font-size: 9.5px; background: #f6f7fb; }
  .advice b { color: var(--p); }
</style></head>
<body>
  <div class="wm">${brandMark(200)}<b>MyWallet</b></div>

  <div class="doc">
    <div class="cover">
      <div class="cover__bar">
        <span class="brand">${brandMark(22)} MyWallet</span>
        <span class="per">Estratto conto · ${esc(d.label)}</span>
      </div>
      <div class="cover__holder">Titolare: <b>${esc(d.holder)}</b></div>
      <div class="cover__grid">
        <div><span class="k">Entrate del mese</span><div class="v in">+ ${formatMoney(d.income)}</div></div>
        <div><span class="k">Uscite del mese</span><div class="v out">− ${formatMoney(d.expense)}</div></div>
      </div>
      <div class="cover__bal">
        <span>Saldo iniziale<b>${formatMoney(d.saldoInizio)}</b></span>
        <span>Risultato del mese<b>${formatMoney(d.net, { sign: true })}</b></span>
        <span>Saldo finale<b>${formatMoney(d.saldoFine)}</b></span>
      </div>
    </div>

    <div class="metrics">
      <div class="metric"><span class="k">Risparmi del mese</span><div class="v">${formatMoney(d.savedThisMonth)}</div></div>
      <div class="metric"><span class="k">Budget rispettati</span><div class="v">${d.respected} / ${state.budgets.length || 0}</div></div>
      <div class="metric"><span class="k">Obiettivi raggiunti</span><div class="v">${d.goalsReached.length}</div></div>
      <div class="metric"><span class="k">Spesa media/giorno</span><div class="v">${formatMoney(d.avgPerDay)}</div></div>
      <div class="metric"><span class="k">Categoria top</span><div class="v">${d.topCat ? esc(d.topCat[0]) : "—"}</div></div>
    </div>

    ${d.byCat.length ? `<div class="section">
      <h2>Distribuzione delle spese</h2>
      <div class="dist">
        ${donut}
        <div class="pdf-cats">${distBars}</div>
      </div>
    </div>` : ""}

    <div class="section">
      <h2>Movimenti in entrata <span class="t in">+ ${formatMoney(d.income)}</span></h2>
      ${txTable(d.incomeTx, "in", d.income)}
    </div>

    <div class="section">
      <h2>Movimenti in uscita <span class="t out">− ${formatMoney(d.expense)}</span></h2>
      ${txTable(d.expenseTx, "out", d.expense)}
    </div>

    <div class="section">
      <h2>Budget del mese</h2>
      ${budgetTable}
    </div>

    <div class="advice"><b>Consiglio.</b> ${esc(d.advice)}</div>

    <div class="foot">Report generato da <b>MyWallet</b> il ${esc(gen)} · Titolare: ${esc(d.holder)}</div>
  </div>
</body></html>`;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
