// Smart-search engine.
// Runs a spec (produced by the interpreter) against the store data and returns
// a UI-ready result: natural-language answer, row list, summaries and related
// statistics.
import { state, selectors } from "../store.js";
import { formatMoney, formatDate, monthKey } from "../utils.js";
import { interpret, aiEnabled, aiAdvisorAnswer, financeSnapshot } from "./interpreter.js";

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const MONTH_LABEL = (d) => d.toLocaleDateString("it-IT", { month: "long", year: "numeric" });

// Entry point: from question to result.
export async function ask(query, section = "all") {
  const spec = await interpret(query, section);
  if (!spec) return null;
  const result = run(spec);
  result.spec = spec;

  // AI advisor layer: if configured, it replaces the answer with a
  // conversational expert explanation (the computed data/rows stay visible).
  if (aiEnabled() && spec.intent !== "budget_planner" && !result.loadTrip) {
    try {
      const better = await aiAdvisorAnswer(query, result, spec);
      if (better) {
        result.answer = better;
        result.aiAnswer = true;
        result.spec.source = "ai";
      }
    } catch (err) {
      console.warn("[assistant] AI answer unavailable, falling back to local:", err.message);
    }
  }
  return result;
}

function run(spec) {
  if (spec.intent === "budget_planner") {
    return {
      title: "Consulente di budget",
      answer: "Costruiamo insieme un budget su misura, passo dopo passo.",
      planner: true, rows: [], summary: [], stats: [],
    };
  }
  if (spec.intent === "affordability") return affordability(spec);
  if (spec.section === "trips" && spec.intent !== "section_summary") return tripSearch(spec);

  // In a non-transactional section, generic questions become a summary.
  const NON_TX = ["budget", "savings", "future", "subscriptions"];
  const SPECIAL = ["savings_plan", "subscription_increases", "compare_months"];
  if (NON_TX.includes(spec.section) && !SPECIAL.includes(spec.intent)) {
    return sectionSummary(spec);
  }
  switch (spec.intent) {
    case "aggregate": return aggregate(spec);
    case "compare_months": return compareMonths(spec);
    case "savings_plan": return savingsPlan(spec);
    case "subscription_increases": return subscriptionIncreases(spec);
    case "section_summary": return sectionSummary(spec);
    default: return search(spec);
  }
}

// Transaction filter.
function filterTx(spec) {
  return state.transactions.filter((t) => {
    if (spec.type && t.type !== spec.type) return false;
    if (spec.paymentMethod && t.payment_method !== spec.paymentMethod) return false;
    if (spec.categories?.length) {
      const name = t.category_name || selectors.categoryName(t.category_id);
      if (!spec.categories.some((c) => c.toLowerCase() === (name || "").toLowerCase())) return false;
    }
    if (spec.dateFrom && t.tx_date < spec.dateFrom) return false;
    if (spec.dateTo && t.tx_date > spec.dateTo) return false;
    if (spec.amountMin != null && +t.amount < spec.amountMin) return false;
    if (spec.amountMax != null && +t.amount > spec.amountMax) return false;
    if (spec.text) {
      const hay = `${t.title} ${t.description || ""}`.toLowerCase();
      if (!hay.includes(spec.text.toLowerCase())) return false;
    }
    return true;
  });
}

const signed = (t) => (t.type === "ENTRATA" ? +t.amount : -t.amount);
const sum = (rows) => rows.reduce((s, t) => s + +t.amount, 0);

function describeFilters(spec) {
  const parts = [];
  if (spec.type) parts.push(spec.type === "ENTRATA" ? "entrate" : "uscite");
  if (spec.categories?.length) parts.push(`categoria ${spec.categories.join(", ")}`);
  if (spec.paymentMethod) parts.push(spec.paymentMethod === "CARTA" ? "pagate con carta" : "in contanti");
  if (spec.amountMin != null && spec.amountMax != null) parts.push(`tra ${formatMoney(spec.amountMin)} e ${formatMoney(spec.amountMax)}`);
  else if (spec.amountMin != null) parts.push(`sopra ${formatMoney(spec.amountMin)}`);
  else if (spec.amountMax != null) parts.push(`sotto ${formatMoney(spec.amountMax)}`);
  if (spec.periodLabel && spec.periodLabel !== "tutto il periodo") parts.push(spec.periodLabel);
  return parts.join(" · ");
}

// Intent: search (list).
function search(spec) {
  if (spec.section === "trips") return tripSearch(spec);

  const rows = filterTx(spec).slice().sort((a, b) => b.tx_date.localeCompare(a.tx_date));
  const totalOut = sum(rows.filter((t) => t.type === "USCITA"));
  const totalIn = sum(rows.filter((t) => t.type === "ENTRATA"));

  const summary = [];
  if (totalOut) summary.push({ label: "Totale uscite", value: formatMoney(totalOut), kind: "expense" });
  if (totalIn) summary.push({ label: "Totale entrate", value: formatMoney(totalIn), kind: "income" });
  summary.push({ label: "Transazioni", value: String(rows.length) });

  const filt = describeFilters(spec);
  let answer;
  if (!rows.length) {
    answer = `Nessuna transazione trovata${filt ? " per " + filt : ""}.`;
  } else if (spec.type === "ENTRATA") {
    answer = `Ho trovato ${rows.length} entrate${filt ? " (" + filt + ")" : ""} per un totale di ${formatMoney(totalIn)}.`;
  } else {
    answer = `Ho trovato ${rows.length} transazioni${filt ? " (" + filt + ")" : ""}. Uscite: ${formatMoney(totalOut)}${totalIn ? `, entrate: ${formatMoney(totalIn)}` : ""}.`;
  }

  return {
    title: "Risultati ricerca",
    answer,
    rows: rows.map(txRow),
    summary,
    stats: correlatedStats(spec, rows),
  };
}

function txRow(t) {
  return {
    title: t.title,
    subtitle: [t.category_name, formatDate(t.tx_date), t.payment_method, t.subscription_id ? "abbonamento" : ""].filter(Boolean).join(" · "),
    amount: signed(t),
    type: t.type,
  };
}

// Intent: aggregation.
function aggregate(spec) {
  const rows = filterTx(spec);
  const filt = describeFilters(spec);
  const kindWord = spec.type === "ENTRATA" ? "ricevuto" : "speso";
  let answer, headline;

  if (!rows.length) {
    return { title: "Riepilogo", answer: `Nessun dato${filt ? " per " + filt : ""}.`, rows: [], summary: [], stats: [] };
  }

  if (spec.aggregate === "max" || spec.aggregate === "min") {
    const sorted = rows.slice().sort((a, b) => +b.amount - +a.amount);
    const pick = spec.aggregate === "max" ? sorted[0] : sorted[sorted.length - 1];
    headline = formatMoney(pick.amount);
    answer = `La ${spec.type === "ENTRATA" ? "entrata" : "spesa"} ${spec.aggregate === "max" ? "più alta" : "più bassa"}${filt ? " (" + filt + ")" : ""} è "${pick.title}" di ${formatMoney(pick.amount)} del ${formatDate(pick.tx_date)}${pick.category_name ? ` — ${pick.category_name}` : ""}.`;
    return {
      title: "Riepilogo", answer,
      rows: [txRow(pick)],
      summary: [{ label: spec.aggregate === "max" ? "Importo massimo" : "Importo minimo", value: headline }],
      stats: correlatedStats(spec, rows),
    };
  }

  if (spec.aggregate === "count") {
    return {
      title: "Riepilogo",
      answer: `Ci sono ${rows.length} transazioni${filt ? " per " + filt : ""}.`,
      rows: rows.slice().sort((a, b) => b.tx_date.localeCompare(a.tx_date)).map(txRow),
      summary: [{ label: "Transazioni", value: String(rows.length) }],
      stats: correlatedStats(spec, rows),
    };
  }

  if (spec.aggregate === "avg") {
    const avg = sum(rows) / rows.length;
    answer = `In media hai ${kindWord} ${formatMoney(avg)} a transazione${filt ? " (" + filt + ")" : ""}, su ${rows.length} movimenti.`;
    return {
      title: "Riepilogo", answer,
      rows: rows.slice().sort((a, b) => +b.amount - +a.amount).slice(0, 10).map(txRow),
      summary: [{ label: "Media", value: formatMoney(avg) }, { label: "Totale", value: formatMoney(sum(rows)) }],
      stats: correlatedStats(spec, rows),
    };
  }

  // default: sum
  const total = sum(rows);
  answer = `${cap(spec.periodLabel && spec.periodLabel !== "tutto il periodo" ? spec.periodLabel : "In totale")} hai ${kindWord} ${formatMoney(total)}${spec.categories?.length ? ` in ${spec.categories.join(", ")}` : ""}${spec.paymentMethod ? ` (${spec.paymentMethod.toLowerCase()})` : ""}.`;
  return {
    title: "Riepilogo",
    answer,
    rows: rows.slice().sort((a, b) => b.tx_date.localeCompare(a.tx_date)).map(txRow),
    summary: [
      { label: `Totale ${spec.type === "ENTRATA" ? "entrate" : "uscite"}`, value: formatMoney(total), kind: spec.type === "ENTRATA" ? "income" : "expense" },
      { label: "Transazioni", value: String(rows.length) },
      { label: "Media", value: formatMoney(total / rows.length) },
    ],
    stats: correlatedStats(spec, rows),
  };
}

// Intent: "why did I spend more than usual?"
function compareMonths(spec) {
  const now = new Date();
  const cur = monthKey(now);
  const prev = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  const byCat = (key) => {
    const m = {};
    for (const t of state.transactions) {
      if (t.type !== "USCITA" || monthKey(new Date(t.tx_date)) !== key) continue;
      const n = t.category_name || selectors.categoryName(t.category_id);
      m[n] = (m[n] || 0) + +t.amount;
    }
    return m;
  };
  const a = byCat(cur), b = byCat(prev);
  const curTot = Object.values(a).reduce((s, v) => s + v, 0);
  const prevTot = Object.values(b).reduce((s, v) => s + v, 0);
  const diff = curTot - prevTot;

  const deltas = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .map((n) => ({ name: n, delta: (a[n] || 0) - (b[n] || 0) }))
    .sort((x, y) => y.delta - x.delta);
  const up = deltas.filter((d) => d.delta > 0.5);

  let answer;
  if (Math.abs(diff) < 1) {
    answer = `Questo mese hai speso ${formatMoney(curTot)}, in linea con il mese scorso (${formatMoney(prevTot)}).`;
  } else if (diff > 0) {
    const detail = up.slice(0, 5).map((d) => `${d.name} +${formatMoney(d.delta)}`).join(", ");
    answer = `Hai speso ${formatMoney(diff)} in più rispetto al mese scorso (${formatMoney(curTot)} contro ${formatMoney(prevTot)}). Le differenze principali sono: ${detail}.`;
  } else {
    answer = `Buone notizie: questo mese hai speso ${formatMoney(-diff)} in meno rispetto al mese scorso (${formatMoney(curTot)} contro ${formatMoney(prevTot)}).`;
  }

  return {
    title: "Confronto con il mese scorso",
    answer,
    rows: [],
    summary: [
      { label: MONTH_LABEL(now), value: formatMoney(curTot), kind: "expense" },
      { label: "Mese scorso", value: formatMoney(prevTot) },
      { label: "Differenza", value: formatMoney(diff, { sign: true }), kind: diff > 0 ? "expense" : "income" },
    ],
    stats: deltas.filter((d) => Math.abs(d.delta) > 0.5).slice(0, 8)
      .map((d) => ({ label: d.name, value: formatMoney(d.delta, { sign: true }) })),
  };
}

// Intent: "can I afford this expense / instalment?"
function affordability(spec) {
  const snap = financeSnapshot();
  const income = snap.entrateMensiliMedie;
  const expense = snap.usciteMensiliMedie;
  const margin = snap.margineMensileMedio;
  const M = spec.affordMonthly != null && spec.affordMonthly !== "" ? Number(spec.affordMonthly) : null;
  const total = spec.affordTotal != null && spec.affordTotal !== "" ? Number(spec.affordTotal) : null;
  const what = spec.affordLabel ? `"${spec.affordLabel}"` : "questa spesa";

  if (income <= 0 && expense <= 0) {
    return {
      title: "Sostenibilità della spesa",
      answer: "Non ho ancora abbastanza movimenti per stimare le tue entrate e uscite mensili. Registra almeno un mese di transazioni e potrò dirti con precisione se puoi permetterti una nuova spesa o una rata.",
      rows: [], summary: [], stats: [],
    };
  }

  const DISCRETIONARY = new Set(["RISTORANTI", "BAR", "SHOPPING", "INTRATTENIMENTO", "SPORT"]);
  const cuts = snap.speseMensiliPerCategoria.filter((c) => DISCRETIONARY.has(c.name) && c.mensile > 3);
  const cutPool = cuts.reduce((s, c) => s + c.mensile, 0);
  const existingDebt = snap.speseMensiliPerCategoria.find((c) => c.name === "RATE FINANZIAMENTI")?.mensile || 0;
  const cutList = () => cuts.map((c) => `${cap(c.name.toLowerCase())} ${formatMoney(c.mensile)}/mese`).join(", ");
  const cutStats = cuts.map((c) => ({ label: `${cap(c.name.toLowerCase())} — spesa media`, value: `${formatMoney(c.mensile)}/mese` }));

  const summary = [
    { label: "Entrate medie/mese", value: formatMoney(income), kind: "income" },
    { label: "Uscite medie/mese", value: formatMoney(expense), kind: "expense" },
    { label: "Margine medio/mese", value: formatMoney(margin), kind: margin >= 0 ? "income" : "expense" },
  ];
  const lines = [];

  // monthly instalment
  if (Number.isFinite(M) && M > 0) {
    const after = margin - M;
    const pctIncome = income > 0 ? (M / income) * 100 : 0;
    const debtPct = income > 0 ? ((existingDebt + M) / income) * 100 : 0;
    const buffer = income * 0.10;

    if (margin <= 0) {
      lines.push(`No. In media spendi ${formatMoney(expense)} al mese a fronte di ${formatMoney(income)} di entrate: non hai margine per una rata di ${formatMoney(M)} senza tagliare altre spese.`);
    } else if (after >= buffer) {
      lines.push(`Sì, puoi permetterti ${what}. Con una rata di ${formatMoney(M)} al mese ti resterebbe comunque un margine di circa ${formatMoney(after)}/mese.`);
    } else if (after > 0) {
      lines.push(`Sì, ma con cautela. Una rata di ${formatMoney(M)} lascerebbe il tuo margine mensile a soli ${formatMoney(after)}: sostenibile solo se entrate e uscite restano stabili.`);
    } else {
      lines.push(`Rischioso. La rata di ${formatMoney(M)} supera il tuo margine mensile medio (${formatMoney(margin)}): andresti in rosso di circa ${formatMoney(-after)} ogni mese.`);
    }

    lines.push(`Il calcolo: margine mensile = entrate medie (${formatMoney(income)}) − uscite medie (${formatMoney(expense)}) = ${formatMoney(margin)}. La rata di ${formatMoney(M)} pesa il ${pctIncome.toFixed(0)}% del tuo reddito.`);
    lines.push(existingDebt > 0
      ? `Contando le rate che già paghi (${formatMoney(existingDebt)}/mese), impegneresti il ${debtPct.toFixed(0)}% del reddito in rate: la soglia prudente consigliata è il 20-30%.`
      : `Riferimento da esperto: il totale delle rate non dovrebbe superare il 20-30% del reddito netto (nel tuo caso max ~${formatMoney(income * 0.25)}/mese).`);
    if (after < buffer && cutPool > 0) {
      lines.push(`Per liberare spazio puoi ridurre le spese discrezionali: ${cutList()}. Tagliando ~${formatMoney(Math.min(cutPool, M))} copriresti la rata senza intaccare il resto.`);
    }
    lines.push(`Prima di impegnarti, assicurati di avere un fondo di emergenza di 3-6 mensilità di spese (~${formatMoney(expense * 3)}–${formatMoney(expense * 6)}).`);

    summary.push({ label: "Rata richiesta", value: `${formatMoney(M)}/mese`, kind: "expense" });
    summary.push({ label: "Margine dopo la rata", value: `${formatMoney(after)}/mese`, kind: after > 0 ? "income" : "expense" });
    return { title: "Posso permettermelo?", answer: lines.join("\n"), rows: [], summary, stats: cutStats };
  }

  // one-off cost
  if (Number.isFinite(total) && total > 0) {
    const monthsToSave = margin > 0 ? total / margin : Infinity;
    const suggRata = total / 12;
    if (margin <= 0) {
      lines.push(`Al momento no: non hai un margine mensile positivo da destinare a una spesa di ${formatMoney(total)}.`);
    } else if (monthsToSave <= 3) {
      lines.push(`Sì. Con il tuo margine di ${formatMoney(margin)}/mese metteresti da parte ${formatMoney(total)} in circa ${Math.ceil(monthsToSave)} mesi.`);
    } else if (monthsToSave <= 8) {
      lines.push(`Sì, con un po' di pianificazione: servirebbero ~${Math.ceil(monthsToSave)} mesi di risparmio, oppure una rata da ~${formatMoney(suggRata)}/mese in 12 mesi.`);
    } else {
      lines.push(`Solo pianificando: al ritmo attuale (${formatMoney(margin)}/mese di margine) ci vorrebbero ~${Math.ceil(monthsToSave)} mesi. Una rata da ~${formatMoney(suggRata)}/mese sarebbe più gestibile.`);
    }
    lines.push(`Il calcolo: margine mensile = ${formatMoney(income)} − ${formatMoney(expense)} = ${formatMoney(margin)}. La spesa di ${formatMoney(total)} vale ${margin > 0 ? "circa " + Math.ceil(monthsToSave) : "diversi"} mesi di margine.`);
    lines.push(`Se la rateizzi, controlla che la rata resti entro il 20-30% del reddito (max ~${formatMoney(income * 0.25)}/mese) e ti lasci comunque un margine positivo.`);
    if (cutPool > 0) lines.push(`Voci su cui puoi intervenire per accelerare: ${cutList()}.`);
    summary.push({ label: "Costo totale", value: formatMoney(total), kind: "expense" });
    if (margin > 0) summary.push({ label: "Mesi di risparmio", value: String(Math.ceil(monthsToSave)) });
    return { title: "Posso permettermelo?", answer: lines.join("\n"), rows: [], summary, stats: cutStats };
  }

  // no amount specified
  const safeRata = Math.max(0, margin - income * 0.10);
  lines.push(margin > 0
    ? `Con le tue abitudini attuali hai un margine mensile medio di ${formatMoney(margin)} (entrate ${formatMoney(income)} − uscite ${formatMoney(expense)}).`
    : `Al momento le uscite medie (${formatMoney(expense)}) sono pari o superiori alle entrate (${formatMoney(income)}): non c'è margine per nuove spese fisse senza tagliare altro.`);
  if (margin > 0) {
    lines.push(`Tenendo un cuscinetto del 10% del reddito, potresti sostenere una nuova rata fino a ~${formatMoney(safeRata)}/mese. Restando entro il 20-30% del reddito, il limite prudente per il totale delle rate è ~${formatMoney(income * 0.25)}/mese.`);
    lines.push(`Indicami l'importo (es. "posso permettermi una rata di 70€ al mese?") e ti do una risposta precisa.`);
  }
  summary.push({ label: "Rata sostenibile stimata", value: `~${formatMoney(safeRata)}/mese`, kind: "income" });
  return { title: "Quanto posso permettermi?", answer: lines.join("\n"), rows: [], summary, stats: cutStats };
}

// Intent: "how can I save N EUR per month?"
function savingsPlan(spec) {
  const target = spec.target || 200;
  const DISCRETIONARY = ["RISTORANTI", "BAR", "SHOPPING", "INTRATTENIMENTO", "SPORT", "CARBURANTE", "SPESA"];

  // Monthly average per category over the last 3 full months + the current one.
  const now = new Date();
  const months = [0, 1, 2].map((i) => monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  const perCat = {};
  for (const t of state.transactions) {
    if (t.type !== "USCITA") continue;
    const k = monthKey(new Date(t.tx_date));
    if (!months.includes(k)) continue;
    const n = t.category_name || selectors.categoryName(t.category_id);
    perCat[n] = (perCat[n] || 0) + +t.amount;
  }
  const monthlyAvg = Object.fromEntries(Object.entries(perCat).map(([n, v]) => [n, v / months.length]));

  // Subscriptions as a compressible item.
  const subMonthly = selectors.subscriptionCostSummary().monthly;
  const pool = DISCRETIONARY
    .map((n) => ({ name: n, monthly: monthlyAvg[n] || 0 }))
    .filter((r) => r.monthly > 0);
  if (subMonthly > 0) pool.push({ name: "ABBONAMENTI", monthly: subMonthly });
  pool.sort((a, b) => b.monthly - a.monthly);

  const base = pool.reduce((s, r) => s + r.monthly, 0);
  if (base <= 0) {
    return {
      title: "Piano di risparmio",
      answer: `Non ho abbastanza dati di spesa recenti per costruire un piano. Registra qualche transazione in più e riprova.`,
      rows: [], summary: [], stats: [],
    };
  }
  let pct = Math.min(0.4, target / base);
  const cuts = pool.map((r) => ({ ...r, cut: r.monthly * pct })).filter((r) => r.cut >= 1);
  const totalCut = cuts.reduce((s, r) => s + r.cut, 0);

  const detail = cuts.map((r) => `${cap(r.name.toLowerCase())} (${formatMoney(r.cut)})`).join(", ");
  const answer =
    `Riducendo del ${Math.round(pct * 100)}% le spese in ${detail} potresti risparmiare circa ${formatMoney(totalCut)} al mese` +
    (totalCut < target * 0.95 ? ` — meno dei ${formatMoney(target)} richiesti: servirebbe anche rivedere le spese fisse.` : ".");

  return {
    title: "Piano di risparmio",
    answer,
    rows: [],
    summary: [
      { label: "Obiettivo", value: `${formatMoney(target)}/mese` },
      { label: "Risparmio stimato", value: `${formatMoney(totalCut)}/mese`, kind: "income" },
      { label: "Taglio medio", value: `${Math.round(pct * 100)}%` },
    ],
    stats: cuts.map((r) => ({ label: `${cap(r.name.toLowerCase())} (ora ${formatMoney(r.monthly)}/mese)`, value: `−${formatMoney(r.cut)}` })),
  };
}

// Intent: "which subscriptions will increase in price?"
function subscriptionIncreases(spec) {
  const today = todayISO();
  const list = state.subscriptions
    .filter((s) => !s.is_paused && s.promo && s.regular_amount && s.promo_end_date && s.promo_end_date >= today && +s.regular_amount > +s.amount)
    .sort((a, b) => a.promo_end_date.localeCompare(b.promo_end_date));

  if (!list.length) {
    return { title: "Abbonamenti", answer: "Nessun abbonamento in promozione è destinato ad aumentare nei prossimi mesi.", rows: [], summary: [], stats: [] };
  }
  const totalDelta = list.reduce((s, x) => {
    const months = selectors.subIntervalMonths(x);
    return s + (+x.regular_amount - +x.amount) / months;
  }, 0);

  const answer = `${list.length} abbonament${list.length > 1 ? "i aumenteranno" : "o aumenterà"} di prezzo: ` +
    list.map((s) => `${s.name} da ${formatMoney(s.amount)} a ${formatMoney(s.regular_amount)} dal ${formatDate(s.promo_end_date)}`).join("; ") +
    `. Impatto totale: +${formatMoney(totalDelta)}/mese.`;

  return {
    title: "Abbonamenti in aumento",
    answer,
    rows: list.map((s) => ({
      title: s.name,
      subtitle: `${s.category_name || ""} · nuovo prezzo dal ${formatDate(s.promo_end_date)}`,
      amount: -(+s.regular_amount),
      type: "USCITA",
    })),
    summary: [
      { label: "Abbonamenti", value: String(list.length) },
      { label: "Aumento mensile", value: `+${formatMoney(totalDelta)}`, kind: "expense" },
    ],
    stats: list.map((s) => ({ label: s.name, value: `${formatMoney(s.amount)} → ${formatMoney(s.regular_amount)}` })),
  };
}

// Intent: section summary.
function sectionSummary(spec) {
  if (spec.section === "budget") {
    const spent = selectors.spentByCategory();
    const rows = state.budgets.map((b) => {
      const name = selectors.categoryName(b.category_id);
      const used = spent[name] || 0;
      return { name, used, limit: +b.monthly_limit, pct: Math.round((used / +b.monthly_limit) * 100) };
    });
    const over = rows.filter((r) => r.used > r.limit);
    return {
      title: "Situazione budget",
      answer: rows.length
        ? `Hai ${rows.length} budget attivi. ${over.length ? `Superati: ${over.map((r) => r.name).join(", ")}.` : "Nessun budget superato finora questo mese."}`
        : "Non hai ancora impostato budget.",
      rows: [],
      summary: [
        { label: "Budget", value: String(rows.length) },
        { label: "Superati", value: String(over.length), kind: over.length ? "expense" : "income" },
        { label: "Rimanente totale", value: formatMoney(selectors.budgetRemaining()) },
      ],
      stats: rows.sort((a, b) => b.pct - a.pct).map((r) => ({ label: r.name, value: `${formatMoney(r.used)} / ${formatMoney(r.limit)} (${r.pct}%)` })),
    };
  }
  if (spec.section === "savings") {
    const rows = state.goals.map((g) => ({ name: g.name, saved: selectors.goalSaved(g.id), target: g.target_amount ? +g.target_amount : null }));
    const totalSaved = rows.reduce((s, r) => s + r.saved, 0);
    return {
      title: "Situazione risparmi",
      answer: rows.length ? `Hai ${rows.length} obiettivi di risparmio, per un totale accantonato di ${formatMoney(totalSaved)}.` : "Non hai ancora obiettivi di risparmio.",
      rows: [],
      summary: [{ label: "Obiettivi", value: String(rows.length) }, { label: "Totale risparmiato", value: formatMoney(totalSaved), kind: "income" }],
      stats: rows.map((r) => ({
        label: r.name,
        value: r.target
          ? `${formatMoney(r.saved)} / ${formatMoney(r.target)} (${Math.round((r.saved / r.target) * 100)}%)`
          : `${formatMoney(r.saved)} accantonati`,
      })),
    };
  }
  if (spec.section === "future") {
    const rows = state.futureExpenses.map((f) => ({ name: f.name, saved: selectors.futureSaved(f.id), total: +f.total_amount, due: f.due_date }));
    const need = rows.reduce((s, r) => s + Math.max(0, r.total - r.saved), 0);
    return {
      title: "Spese future",
      answer: rows.length ? `Hai ${rows.length} spese future pianificate; mancano ${formatMoney(need)} da accantonare in totale.` : "Nessuna spesa futura pianificata.",
      rows: [],
      summary: [{ label: "Pianificate", value: String(rows.length) }, { label: "Da accantonare", value: formatMoney(need), kind: "expense" }],
      stats: rows.map((r) => ({ label: `${r.name} · ${formatDate(r.due)}`, value: `${formatMoney(r.saved)} / ${formatMoney(r.total)}` })),
    };
  }
  if (spec.section === "subscriptions") {
    const s = selectors.subscriptionCostSummary();
    return {
      title: "Abbonamenti",
      answer: `Hai ${s.count} abbonamenti attivi: ${formatMoney(s.monthly)} al mese, ${formatMoney(s.yearly)} all'anno.`,
      rows: selectors.activeSubscriptions().map((sub) => ({
        title: sub.name,
        subtitle: `${sub.category_name || ""} · prossimo ${formatDate(sub.next_payment_date)}`,
        amount: -selectors.subAmountOn(sub, new Date()),
        type: "USCITA",
      })),
      summary: [
        { label: "Attivi", value: String(s.count) },
        { label: "Al mese", value: formatMoney(s.monthly), kind: "expense" },
        { label: "All'anno", value: formatMoney(s.yearly), kind: "expense" },
      ],
      stats: [],
    };
  }
  return search(spec);
}

// Trip search.
function tripSearch(spec) {
  const trip = spec.tripName
    ? state.trips.find((t) => t.name.toLowerCase().includes(spec.tripName.toLowerCase()))
    : null;

  if (spec.tripName && !trip) {
    return { title: "Viaggi", answer: `Non ho trovato un viaggio chiamato "${spec.tripName}".`, rows: [], summary: [], stats: [] };
  }
  if (!trip) {
    const rows = state.trips.map((t) => ({ title: t.name, subtitle: `${(t.trip_members || []).length} partecipanti · ${t.status}`, amount: 0, type: "INFO" }));
    return { title: "I tuoi viaggi", answer: `Hai ${state.trips.length} viaggi condivisi.`, rows, summary: [], stats: [] };
  }
  // The trip's expense detail is loaded by the view (async) and passed to
  // buildTripReport(); here we only return the reference.
  return {
    title: `Viaggio: ${trip.name}`,
    answer: `Carico il resoconto del viaggio "${trip.name}"…`,
    rows: [],
    summary: [{ label: "Partecipanti", value: String((trip.trip_members || []).length) }, { label: "Stato", value: trip.status }],
    stats: [],
    tripId: trip.id,
    tripName: trip.name,
    loadTrip: true,
  };
}

// Builds a trip report with expenses/members already loaded.
export function buildTripReport(trip, expenses, members, spec = {}) {
  let list = expenses.slice();
  if (spec.categories?.length) {
    list = list.filter((e) => spec.categories.some((c) => c.toLowerCase() === (e.category_name || "").toLowerCase()));
  }
  if (spec.dateFrom) list = list.filter((e) => e.expense_date >= spec.dateFrom);
  if (spec.dateTo) list = list.filter((e) => e.expense_date <= spec.dateTo);
  if (spec.amountMin != null) list = list.filter((e) => +e.amount >= spec.amountMin);
  if (spec.amountMax != null) list = list.filter((e) => +e.amount <= spec.amountMax);

  const total = list.reduce((s, e) => s + (e.type === "ENTRATA" ? -e.amount : +e.amount), 0);
  const paid = {};
  for (const e of list) {
    if (e.type !== "USCITA") continue;
    const payer = e.paid_by || e.created_by;
    paid[payer] = (paid[payer] || 0) + +e.amount;
  }
  const perHead = members.length ? total / members.length : 0;
  const settlement = members.map((m) => ({
    name: m.display_name,
    paid: paid[m.user_id] || 0,
    balance: (paid[m.user_id] || 0) - perHead,
  }));

  const nameOf = (id) => members.find((m) => m.user_id === id)?.display_name || "—";

  return {
    title: `Viaggio: ${trip.name}`,
    answer: `Nel viaggio "${trip.name}" sono state registrate ${list.length} spese per un totale di ${formatMoney(total)}` +
      (members.length ? `, ${formatMoney(perHead)} a testa.` : ".") +
      (trip.status === "TERMINATO" ? " Viaggio terminato." : ""),
    rows: list.slice().sort((a, b) => b.expense_date.localeCompare(a.expense_date)).map((e) => ({
      title: e.title,
      subtitle: `${e.category_name} · ${formatDate(e.expense_date)} · ${nameOf(e.paid_by || e.created_by)}`,
      amount: e.type === "ENTRATA" ? +e.amount : -e.amount,
      type: e.type,
    })),
    summary: [
      { label: "Totale spese", value: formatMoney(total), kind: "expense" },
      { label: "Spese registrate", value: String(list.length) },
      { label: "Quota a testa", value: formatMoney(perHead) },
    ],
    stats: settlement.map((s) => ({
      label: `${s.name} (ha speso ${formatMoney(s.paid)})`,
      value: s.balance >= 0 ? `deve ricevere ${formatMoney(s.balance)}` : `deve dare ${formatMoney(-s.balance)}`,
    })),
    spec,
  };
}

// Related statistics.
function correlatedStats(spec, rows) {
  if (!rows?.length) return [];
  const stats = [];

  // Breakdown by category (unless already filtered to a single one).
  if (!spec.categories || spec.categories.length !== 1) {
    const byCat = {};
    for (const t of rows) {
      if (t.type !== "USCITA") continue;
      const n = t.category_name || selectors.categoryName(t.category_id);
      byCat[n] = (byCat[n] || 0) + +t.amount;
    }
    Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .forEach(([n, v]) => stats.push({ label: n, value: formatMoney(v) }));
  } else {
    // Monthly trend of the filtered category.
    const byMonth = {};
    for (const t of rows) {
      const k = monthKey(new Date(t.tx_date));
      byMonth[k] = (byMonth[k] || 0) + +t.amount;
    }
    Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6)
      .forEach(([k, v]) => stats.push({ label: k, value: formatMoney(v) }));
  }
  return stats;
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
