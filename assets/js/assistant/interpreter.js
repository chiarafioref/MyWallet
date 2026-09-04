// Smart-search interpreter.
// Turns a natural-language request into a "search spec" that the engine runs
// against the data. Uses the Mistral model (via the "chat-ai" Edge Function)
// when the AI assistant is enabled, otherwise the built-in local interpreter
// (Italian rules, offline).
import { state, selectors } from "../store.js";
import { aiEnabled, chatCompletion } from "./ai-client.js";

// Re-exported so existing importers keep using interpreter.js as the entry point.
export { aiEnabled };

/* Shape of the returned spec:
{
  intent: "search" | "aggregate" | "compare_months" | "savings_plan"
          | "subscription_increases" | "section_summary" | "budget_planner",
  section: "all"|"wallet"|"trips"|"budget"|"savings"|"future"|"subscriptions",
  type: "ENTRATA"|"USCITA"|null,
  categories: string[],
  paymentMethod: "CARTA"|"CONTANTI"|null,
  amountMin: number|null, amountMax: number|null,
  dateFrom: "YYYY-MM-DD"|null, dateTo: "YYYY-MM-DD"|null,
  text: string|null,
  aggregate: "sum"|"max"|"min"|"avg"|"count"|null,
  tripName: string|null,
  target: number|null,
  periodLabel: string,
  source: "ai"|"local"
}
*/

export async function interpret(query, section = "all") {
  const q = (query || "").trim();
  if (!q) return null;
  if (aiEnabled()) {
    try {
      const spec = await aiInterpret(q, section);
      if (spec) return { ...blankSpec(section), ...spec, source: "ai" };
    } catch (err) {
      console.warn("[assistant] AI unavailable, using the local interpreter:", err.message);
    }
  }
  return localInterpret(q, section);
}

function blankSpec(section) {
  return {
    intent: "search", section: section || "all", type: null, categories: [],
    paymentMethod: null, amountMin: null, amountMax: null, dateFrom: null, dateTo: null,
    text: null, aggregate: null, tripName: null, target: null,
    affordMonthly: null, affordTotal: null, affordLabel: null,
    periodLabel: "", source: "local",
  };
}

// AI interpreter: the model (through the Edge Function) turns the question into
// the search "spec" understood by the engine.
async function aiInterpret(query, section) {
  const categories = [...new Set(state.categories.map((c) => c.name))];
  const trips = state.trips.map((t) => t.name);
  const today = todayISO();

  const system = [
    "Sei un assistente finanziario che converte richieste in italiano in una struttura JSON di ricerca.",
    `Oggi è ${today}. Rispondi SOLO con un oggetto JSON valido, senza testo aggiuntivo.`,
    "Campi ammessi: intent, section, type, categories, paymentMethod, amountMin, amountMax, dateFrom, dateTo, text, aggregate, tripName, target, affordMonthly, affordTotal, affordLabel, periodLabel.",
    'intent ∈ ["search","aggregate","compare_months","savings_plan","subscription_increases","section_summary","budget_planner","affordability"].',
    'Usa "budget_planner" quando l\'utente chiede aiuto a creare/configurare/pianificare un budget personalizzato.',
    'Usa "affordability" quando l\'utente chiede se può permettersi una spesa, una rata o un acquisto (es. "posso comprare X a rate a 70€ al mese?"). affordMonthly = importo mensile della rata; affordTotal = costo totale una tantum; affordLabel = cosa vuole comprare.',
    'section ∈ ["all","wallet","trips","budget","savings","future","subscriptions"].',
    'type ∈ ["ENTRATA","USCITA",null]. paymentMethod ∈ ["CARTA","CONTANTI",null].',
    'aggregate ∈ ["sum","max","min","avg","count",null].',
    "dateFrom/dateTo in formato YYYY-MM-DD. Converti periodi relativi (es. \"questo mese\", \"ultimi 3 mesi\", \"scorso weekend\") in date esplicite.",
    `Categorie disponibili: ${categories.join(", ")}.`,
    trips.length ? `Viaggi: ${trips.join(", ")}.` : "",
    "categories deve contenere solo nomi presenti nell'elenco. periodLabel è una breve descrizione del periodo in italiano.",
  ].filter(Boolean).join("\n");

  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: section && section !== "all" ? `[sezione: ${section}] ${query}` : query },
    ],
    { temperature: 0, jsonMode: true }
  );
  // Some providers wrap the JSON in a markdown block: strip it.
  const clean = String(raw).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const spec = JSON.parse(clean);
  // Normalise categories to the real names.
  if (Array.isArray(spec.categories)) {
    spec.categories = spec.categories
      .map((name) => matchCategory(String(name)))
      .filter(Boolean);
  }
  return spec;
}

// AI advisor (conversational expert budget-planning answer).
// Active only when the AI assistant is enabled. Receives the question + a
// synthetic snapshot of the user's finances + the numbers already computed by
// the engine, and returns a clear, simple, detailed answer in Italian.
export async function aiAdvisorAnswer(query, engineResult, spec) {
  if (!aiEnabled()) return null;
  const snap = financeSnapshot();
  const computed = {
    rispostaBase: engineResult?.answer || null,
    riepilogo: (engineResult?.summary || []).map((s) => `${s.label}: ${s.value}`),
    dettaglio: (engineResult?.stats || []).slice(0, 12).map((s) => `${s.label}: ${s.value}`),
    intent: spec?.intent,
    rataMensileRichiesta: spec?.affordMonthly ?? null,
    costoTotaleRichiesto: spec?.affordTotal ?? null,
  };

  const system = [
    "Sei un consulente finanziario esperto in finanza personale e budget planning.",
    "Rispondi in italiano, in modo chiaro, semplice e concreto, come spiegheresti a un amico.",
    "Basati SOLO sui dati forniti: non inventare cifre. Se un dato manca, dillo.",
    "Struttura la risposta così:",
    "1) la prima frase è la sintesi: se la domanda è sì/no dai un verdetto diretto (Sì / Sì ma con cautela / No / Dipende), altrimenti una frase che risponde subito al punto;",
    "2) il ragionamento con i numeri: margine mensile = entrate medie − uscite medie; impatto della nuova spesa; quanto resterebbe; a quale percentuale del reddito corrisponde;",
    "3) i riferimenti da esperto: le rate/debiti non dovrebbero superare il 20-30% del reddito netto; è bene tenere 3-6 mensilità di spese come fondo di emergenza; regola 50/30/20;",
    "4) 1-2 consigli pratici e personalizzati (quali categorie tagliare, di quanto).",
    "Usa numeri in euro con 2 decimali. Niente elenchi puntati lunghi, massimo ~180 parole. Non usare markdown.",
  ].join("\n");

  const user =
    `Domanda dell'utente: ${query}\n\n` +
    `Fotografia finanziaria (medie mensili degli ultimi mesi con dati):\n${JSON.stringify(snap, null, 1)}\n\n` +
    `Numeri già calcolati dall'app:\n${JSON.stringify(computed, null, 1)}`;

  const text = (await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.3 }
  )).trim();
  return text || null;
}

// Snapshot of the user's finances (monthly averages + commitments + goals).
export function financeSnapshot() {
  const now = new Date();
  const incomeByM = {};
  const expenseByM = {};
  const catByM = {};
  for (const t of state.transactions) {
    const k = `${new Date(t.tx_date).getFullYear()}-${String(new Date(t.tx_date).getMonth() + 1).padStart(2, "0")}`;
    if (t.type === "ENTRATA") incomeByM[k] = (incomeByM[k] || 0) + +t.amount;
    else {
      expenseByM[k] = (expenseByM[k] || 0) + +t.amount;
      const cn = t.category_name || "ALTRO";
      catByM[cn] = catByM[cn] || {};
      catByM[cn][k] = (catByM[cn][k] || 0) + +t.amount;
    }
  }
  const months = [...new Set([...Object.keys(incomeByM), ...Object.keys(expenseByM)])].sort();
  // Last 4 months with at least one movement (future excluded).
  const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const useMonths = months.filter((k) => k <= curKey).slice(-4);
  const n = Math.max(1, useMonths.length);
  const avg = (obj) => useMonths.reduce((s, k) => s + (obj[k] || 0), 0) / n;

  const avgIncome = avg(incomeByM);
  const avgExpense = avg(expenseByM);
  const byCategory = Object.entries(catByM)
    .map(([name, m]) => ({ name, mensile: round2(avg(m)) }))
    .filter((c) => c.mensile > 0)
    .sort((a, b) => b.mensile - a.mensile)
    .slice(0, 10);

  const subs = selectors.subscriptionCostSummary();
  const goals = state.goals.map((g) => ({
    nome: g.name,
    accantonato: round2(selectors.goalSaved(g.id)),
    obiettivo: g.target_amount ? round2(+g.target_amount) : null,
  }));
  const future = state.futureExpenses.map((f) => ({
    nome: f.name,
    totale: round2(+f.total_amount),
    accantonato: round2(selectors.futureSaved(f.id)),
    scadenza: f.due_date,
  }));
  const budgets = state.budgets.map((b) => {
    const name = selectors.categoryName(b.category_id);
    return { categoria: name, limite: round2(+b.monthly_limit), speso_questo_mese: round2(selectors.spentByCategory()[name] || 0) };
  });

  return {
    mesiConsiderati: n,
    entrateMensiliMedie: round2(avgIncome),
    usciteMensiliMedie: round2(avgExpense),
    margineMensileMedio: round2(avgIncome - avgExpense),
    saldoTotaleStimato: round2(selectors.totalBalance()),
    speseMensiliPerCategoria: byCategory,
    abbonamenti: { numero: subs.count, costoMensile: round2(subs.monthly) },
    budgetImpostati: budgets,
    obiettiviRisparmio: goals,
    speseFuture: future,
  };
}

const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;

// Local interpreter (Italian rules).
const NUM_WORDS = {
  un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6,
  sette: 7, otto: 8, nove: 9, dieci: 10, undici: 11, dodici: 12,
};
const MONTHS = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];

// Words too generic to be treated as a category name on their own
// ("spesa" = expense in a broad sense, "altro" = anything).
const AMBIGUOUS_CATEGORY_NAMES = new Set(["SPESA", "ALTRO"]);

const CATEGORY_SYNONYMS = {
  CASA: ["casa", "affitto", "mutuo"],
  SPESA: ["supermercato", "alimentari", "spesa alimentare", "fare la spesa", "spesa settimanale", "generi alimentari"],
  RISTORANTI: ["ristorante", "ristoranti", "trattoria", "pizzeria", "cena", "pranzo"],
  BAR: ["bar", "caffè", "caffe", "aperitivo", "colazione"],
  TRASPORTI: ["trasporti", "treno", "bus", "metro", "autobus", "biglietto", "taxi"],
  CARBURANTE: ["carburante", "benzina", "diesel", "gasolio", "rifornimento"],
  "SPESE AUTO": ["auto", "macchina", "meccanico", "assicurazione auto", "bollo", "revisione"],
  UTENZE: ["utenze", "bolletta", "bollette", "luce", "gas", "acqua", "internet", "telefono"],
  SHOPPING: ["shopping", "vestiti", "abbigliamento", "scarpe", "acquisti"],
  SPORT: ["sport", "palestra", "piscina", "abbonamento palestra"],
  INTRATTENIMENTO: ["intrattenimento", "concerto", "concerti", "cinema", "eventi", "teatro"],
  SALUTE: ["salute", "medico", "farmacia", "dentista", "visita", "analisi"],
  ISTRUZIONE: ["istruzione", "scuola", "università", "universita", "corso", "libri"],
  VIAGGI: ["viaggi", "vacanza", "vacanze", "hotel", "volo", "aereo"],
  REGALI: ["regali", "regalo"],
  TASSE: ["tasse", "imposte", "f24", "iva"],
  "RATE FINANZIAMENTI": ["rata", "rate", "finanziamento", "prestito", "mutuo"],
  ALTRO: ["varie ed eventuali"],
  STIPENDIO: ["stipendio", "salario", "busta paga"],
  RIMBORSO: ["rimborso", "rimborsi"],
};

function norm(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function matchCategory(token) {
  const t = norm(token).trim();
  if (!t) return null;
  const names = [...new Set(state.categories.map((c) => c.name))];
  // exact name
  const exact = names.find((n) => norm(n) === t);
  if (exact) return exact;
  // by synonym -> only if the category exists for the user
  for (const [cat, syns] of Object.entries(CATEGORY_SYNONYMS)) {
    if (!names.some((n) => norm(n) === norm(cat))) continue;
    if (syns.some((s) => t === norm(s) || t.includes(norm(s)) || norm(s).includes(t))) return cat;
  }
  // contains the category name
  const partial = names.find((n) => t.includes(norm(n)) || norm(n).includes(t));
  return partial || null;
}

function findCategories(text) {
  const t = norm(text);
  const found = new Set();
  const names = [...new Set(state.categories.map((c) => c.name))];
  for (const n of names) {
    if (AMBIGUOUS_CATEGORY_NAMES.has(n)) continue; // "spesa"/"altro": only via synonym or "categoria X"
    if (new RegExp(`\\b${norm(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t)) found.add(n);
  }
  for (const [cat, syns] of Object.entries(CATEGORY_SYNONYMS)) {
    if (!names.some((n) => norm(n) === norm(cat))) continue;
    if (syns.some((s) => new RegExp(`\\b${norm(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t))) {
      found.add(cat);
    }
  }
  // explicit reference: "categoria spesa", "in categoria altro"
  const m = t.match(/categoria\s+([a-zà-ù ]{3,20})/);
  if (m) { const c = matchCategoryLoose(m[1].trim(), names); if (c) found.add(c); }
  return [...found];
}

function matchCategoryLoose(token, names) {
  const t = norm(token);
  return names.find((n) => norm(n) === t) || names.find((n) => t.startsWith(norm(n)) || norm(n).startsWith(t)) || null;
}

// Local date in YYYY-MM-DD format (no toISOString: it would shift by timezone).
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
const todayISO = () => iso(new Date());

function parseNumberWord(text, near) {
  const m = norm(text).match(new RegExp(`(\\d+|${Object.keys(NUM_WORDS).join("|")})\\s+${near}`));
  if (!m) return null;
  return NUM_WORDS[m[1]] ?? Number(m[1]);
}

function parsePeriod(text) {
  const t = norm(text);
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  if (/\boggi\b/.test(t)) return { from: iso(startOfDay(now)), to: iso(now), label: "oggi" };
  if (/\bieri\b/.test(t)) {
    const d = new Date(y, m, now.getDate() - 1);
    return { from: iso(d), to: iso(d), label: "ieri" };
  }
  if (/scorso week ?end|weekend scorso|ultimo week ?end/.test(t)) {
    const day = now.getDay() || 7; // Mon=1..Sun=7
    const lastSun = new Date(y, m, now.getDate() - day);
    const lastSat = new Date(y, m, now.getDate() - day - 1);
    return { from: iso(lastSat), to: iso(lastSun), label: "lo scorso weekend" };
  }
  if (/questo week ?end|questo fine settimana/.test(t)) {
    const day = now.getDay() || 7;
    const sat = new Date(y, m, now.getDate() - day + 6);
    const sun = new Date(y, m, now.getDate() - day + 7);
    return { from: iso(sat), to: iso(sun), label: "questo weekend" };
  }
  if (/questa settimana/.test(t)) {
    const day = now.getDay() || 7;
    const mon = new Date(y, m, now.getDate() - day + 1);
    return { from: iso(mon), to: iso(now), label: "questa settimana" };
  }
  if (/settimana scorsa|scorsa settimana|ultima settimana/.test(t)) {
    const day = now.getDay() || 7;
    const mon = new Date(y, m, now.getDate() - day + 1 - 7);
    const sun = new Date(y, m, now.getDate() - day);
    return { from: iso(mon), to: iso(sun), label: "la settimana scorsa" };
  }
  let n = parseNumberWord(t, "giorni");
  if (n) return { from: iso(new Date(y, m, now.getDate() - n)), to: iso(now), label: `ultimi ${n} giorni` };
  n = parseNumberWord(t, "settimane");
  if (n) return { from: iso(new Date(y, m, now.getDate() - n * 7)), to: iso(now), label: `ultime ${n} settimane` };
  n = parseNumberWord(t, "mesi");
  if (n) return { from: iso(new Date(y, m - n + 1, 1)), to: iso(now), label: `ultimi ${n} mesi` };
  n = parseNumberWord(t, "anni");
  if (n) return { from: iso(new Date(y - n, m, 1)), to: iso(now), label: `ultimi ${n} anni` };

  if (/mese scorso|scorso mese|il mese passato/.test(t)) {
    return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)), label: "il mese scorso" };
  }
  if (/questo mese|nel mese|del mese|mese corrente/.test(t)) {
    return { from: iso(new Date(y, m, 1)), to: iso(now), label: "questo mese" };
  }
  if (/anno scorso|scorso anno|l'anno passato/.test(t)) {
    return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: "l'anno scorso" };
  }
  if (/quest'? ?anno|anno corrente|nell'anno/.test(t)) {
    return { from: `${y}-01-01`, to: iso(now), label: "quest'anno" };
  }
  for (let i = 0; i < 12; i++) {
    if (new RegExp(`\\b(a |in |di |nel mese di )?${MONTHS[i]}\\b`).test(t)) {
      const year = i > m ? y - 1 : y;
      return { from: iso(new Date(year, i, 1)), to: iso(new Date(year, i + 1, 0)), label: `${MONTHS[i]} ${year}` };
    }
  }
  return null;
}

// All amounts mentioned in the (already normalised) text, with position.
function parseMoneyMentions(t) {
  const out = [];
  const re = /(?:€|euro|eur)?\s*(\d+(?:[.,]\d+)?)\s*(?:€|euro|eur)?/g;
  let m;
  while ((m = re.exec(t))) {
    if (m[0].trim() === "") { re.lastIndex++; continue; }
    const n = Number(m[1].replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) continue;
    out.push({ n, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

function parseAmounts(text) {
  const t = norm(text).replace(/\./g, "").replace(/,/g, ".");
  let min = null, max = null;
  let m = t.match(/tra\s*€?\s*(\d+(?:\.\d+)?)\s*(?:e|ed)\s*€?\s*(\d+(?:\.\d+)?)/);
  if (m) { min = Number(m[1]); max = Number(m[2]); return { min, max }; }
  m = t.match(/(?:piu di|oltre|sopra(?:\s*(?:i|a))?|superior[ei]\s*a|maggior[ei]\s*di|almeno|da)\s*€?\s*(\d+(?:\.\d+)?)/);
  if (m) min = Number(m[1]);
  m = t.match(/(?:meno di|sotto(?:\s*(?:i|a))?|inferior[ei]\s*a|minor[ei]\s*di|fino a|massimo|non piu di)\s*€?\s*(\d+(?:\.\d+)?)/);
  if (m) max = Number(m[1]);
  return { min, max };
}

function localInterpret(query, section) {
  const spec = blankSpec(section);
  const t = norm(query);

  // Special intents.
  // Affordability of an expense: "posso permettermi una rata di 70€ al mese?",
  // "con il mio budget riesco a comprare X a rate?", "ho margine per 200€/mese?"
  const asksCanAfford =
    /\b(posso|posso permetterm|riesco a|riuscirei|me la posso|c'?e (il )?margine|ho (il |abbastanza )?margine|mi (posso|conviene)|e sostenibile|è sostenibile|ce la (faccio|farei))\b/.test(t) &&
    /(permett|comprar|acquist|rat[ae]\b|rateizz|a rate|al mese|\/\s*mese|mensil|spendere|pagare|sosten|affrontare|finanziar|prestito|mutuo)/.test(t);
  if (asksCanAfford || /quanto posso (permetterm|spendere).*(al mese|mensil|rat)/.test(t)) {
    spec.intent = "affordability";
    spec.section = "all";
    const money = parseMoneyMentions(t);
    // Monthly amount: a number followed by "al mese / /mese / mensile / ogni mese",
    // or the explicit pattern "rata di N" / "rate da N".
    const monthly = money.find((m) => /^\s*(?:€|euro|eur)?\s*(?:al mese|\/\s*mese|ogni mese|mensil)/.test(t.slice(m.end, m.end + 16)));
    if (monthly) spec.affordMonthly = monthly.n;
    if (spec.affordMonthly == null) {
      const near = t.match(/rat[ae]\s*(?:da|di)\s*€?\s*(\d+(?:[.,]\d+)?)/);
      if (near) spec.affordMonthly = Number(near[1].replace(",", "."));
    }
    if (spec.affordMonthly == null) {
      const big = money.filter((m) => m.n >= 20).sort((a, b) => b.n - a.n)[0];
      if (big) spec.affordTotal = big.n;
    }
    const what = query.match(/(?:comprar[ei]?|acquistar[ei]?|prender[ei]?)\s+([\p{L}\s'']{3,40}?)(?:\s+(?:a rate|a\s+\d|pagand|per|da|che|con|\?)|\?|$)/iu);
    if (what) {
      spec.affordLabel = what[1].trim().toLowerCase()
        .replace(/^(?:un[a']?|il|lo|la|i|gli|le|dei|delle|degli)\s+/i, "")
        .replace(/\s+/g, " ");
    }
    return spec;
  }

  // Budget advisor: "aiutami a creare un budget", "configura un budget 50/30/20"…
  if (
    /\bbudget\b|budgeting|50\/?30\/?20/.test(t) &&
    /(cre[ai]|configur|imposta|impostar|pianific|aiut|consigl|come (faccio|creo|imposto)|nuovo budget|budget personalizzat|budget su misura|budget mensile|setup|configurazione|pianificazione)/.test(t)
  ) {
    spec.intent = "budget_planner";
    spec.section = "budget";
    return spec;
  }
  if (/abbonament/.test(t) && /(aument|aumenter|prezzo|cost[oi]|rincar|promo)/.test(t)) {
    spec.intent = "subscription_increases";
    spec.section = "subscriptions";
    spec.periodLabel = "prossimi mesi";
    return spec;
  }
  if (/(come posso|voglio|vorrei|posso|aiutami a).*risparmi|risparmiare (?:€?\s*\d|di piu)/.test(t)) {
    spec.intent = "savings_plan";
    const m = t.replace(/\./g, "").match(/(\d+(?:,\d+)?)\s*€?\s*(?:al mese|ogni mese|mensili)?/);
    spec.target = m ? Number(m[1].replace(",", ".")) : 200;
    spec.periodLabel = "al mese";
    return spec;
  }
  if (/perch[eé].*(speso|spes[ao])/.test(t) && /(piu|di piu|piu del solito|tanto|cosi tanto)/.test(t)) {
    spec.intent = "compare_months";
    spec.periodLabel = "questo mese vs mese scorso";
    return spec;
  }

  // Trips.
  const tripMatch = query.match(/viaggio\s+(?:a|di|in|per)\s+([\p{L}\s'']+?)(?:\?|$|\bcon\b|\bnel\b|\bdurante\b)/iu);
  if (/viagg/.test(t) || section === "trips") {
    spec.section = "trips";
    if (tripMatch) spec.tripName = tripMatch[1].trim();
    else {
      const known = state.trips.find((tr) => t.includes(norm(tr.name)));
      if (known) spec.tripName = known.name;
    }
  }

  // Income/expense type.
  if (/\b(entrat|ricevut|incassat|guadagnat|stipendi|accredit)/.test(t)) spec.type = "ENTRATA";
  else if (/\b(spes[aeo]|speso|uscit|pagat|comprat|acquistat|costo)/.test(t)) spec.type = "USCITA";

  // Payment method.
  if (/\bcart[ae]\b|bancomat|carta di credito|carta di debito/.test(t)) spec.paymentMethod = "CARTA";
  else if (/contant[ie]|in contanti|cash/.test(t)) spec.paymentMethod = "CONTANTI";

  // Categories.
  spec.categories = findCategories(query);
  if (spec.categories.includes("STIPENDIO") || spec.categories.includes("RIMBORSO")) {
    spec.type = spec.type || "ENTRATA";
  }

  // Period.
  const period = parsePeriod(query);
  if (period) { spec.dateFrom = period.from; spec.dateTo = period.to; spec.periodLabel = period.label; }

  // Amounts.
  const amt = parseAmounts(query);
  spec.amountMin = amt.min;
  spec.amountMax = amt.max;

  // Aggregations / intent.
  if (/quant[oi]\s+ho\s+(speso|spes[ao]|pagato|sborsato)/.test(t) || /quant[oi]\s+ho\s+(ricevut|incassat|guadagnat)/.test(t) || /^quanto /.test(t) || /totale|in totale|somma/.test(t)) {
    spec.intent = "aggregate";
    spec.aggregate = "sum";
    if (!spec.type) spec.type = /ricevut|incassat|guadagnat|stipendi/.test(t) ? "ENTRATA" : "USCITA";
  }
  if (/(spesa|transazione|importo|acquisto)\s+(piu\s+alt[ao]|maggiore|massim[ao]|piu\s+costos[ao]|piu\s+grande)/.test(t) || /qual e la (mia )?spesa (piu|più)/.test(t)) {
    spec.intent = "aggregate"; spec.aggregate = "max"; spec.type = spec.type || "USCITA";
  }
  if (/(spesa|transazione|importo)\s+(piu\s+bass[ao]|minore|minim[ao]|piu\s+piccol[ao])/.test(t)) {
    spec.intent = "aggregate"; spec.aggregate = "min"; spec.type = spec.type || "USCITA";
  }
  if (/\bin media\b|\bmedia\b|mediamente|in media quanto/.test(t)) {
    spec.intent = "aggregate"; spec.aggregate = "avg"; spec.type = spec.type || "USCITA";
  }
  if (/quant[ei]\s+(transazioni|spese|movimenti|operazioni)|numero di (transazioni|spese)/.test(t)) {
    spec.intent = "aggregate"; spec.aggregate = "count";
  }

  // Sections / summaries.
  if (spec.intent === "search" && !spec.categories.length) {
    if (/\bbudget\b/.test(t)) { spec.section = "budget"; spec.intent = "section_summary"; }
    else if (/risparm|obiettiv/.test(t)) { spec.section = "savings"; spec.intent = "section_summary"; }
    else if (/spese future|accantonament/.test(t)) { spec.section = "future"; spec.intent = "section_summary"; }
    else if (/abbonament/.test(t)) { spec.section = "subscriptions"; spec.intent = "section_summary"; }
  }

  // Leftover free text (matched against title/description): only for otherwise
  // unstructured requests, so the filters are not polluted.
  const structured = spec.amountMin != null || spec.amountMax != null || spec.dateFrom ||
    spec.paymentMethod || spec.aggregate || spec.categories.length || spec.tripName ||
    spec.intent !== "search";
  if (!structured) {
    const stop = new RegExp(
      "\\b(mostrami|mostra|fammi|vedere|farmi|elenca|elenco|lista|trova|cerca|voglio|" +
      "tutte|tutti|tutto|le|i|gli|la|il|lo|un|una|di|per|con|del|della|dei|delle|nel|nella|" +
      "questo|quest|questa|mese|anno|settimana|weekend|giorno|scorso|scorsa|ultimi|ultime|" +
      "quanto|quanti|quali|qual|come|dove|ho|hai|abbiamo|speso|spesa|spese|pagato|pagate|pagata|" +
      "ricevuto|incassato|euro|piu|meno|alta|bassa|transazione|transazioni|movimenti|operazioni)\\b",
      "g"
    );
    const leftover = t.replace(stop, " ").replace(/[^a-zà-ù\s]/g, " ").replace(/\s+/g, " ").trim();
    const words = leftover.split(" ").filter((w) => w.length >= 4);
    if (words.length && words.join(" ").length <= 30) spec.text = words.join(" ");
  }

  if (!spec.periodLabel) spec.periodLabel = "tutto il periodo";
  return spec;
}
