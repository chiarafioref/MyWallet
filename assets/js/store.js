// Stato globale dell'app: caricamento iniziale, sincronizzazione realtime e selettori.
import { supabaseClient } from "./supabaseClient.js";
import { createEmitter, setCurrency, isSameMonth, dateISO, todayISO, parseDate } from "./utils.js";
import { CATEGORY } from "./categories.js";

const emitter = createEmitter();

export const state = {
  user: null,
  profile: null,
  categories: [],
  transactions: [],
  budgets: [],
  subscriptions: [],
  transfers: [],
  goals: [],
  goalContributions: [],
  futureExpenses: [],
  futureContributions: [],
  trips: [],
  loading: true,
};

export const on = emitter.on;
const notify = (scope = "all") => emitter.emit("change", scope);

// Forza il refresh della UI dopo un aggiornamento ottimistico dello stato,
// senza attendere l'evento realtime.
export const touch = (scope = "all") => notify(scope);

export async function loadAll(user) {
  state.user = user;
  state.loading = true;
  notify();

  const [
    profile,
    categories,
    transactions,
    budgets,
    subscriptions,
    transfers,
    goals,
    goalContributions,
    futureExpenses,
    futureContributions,
    trips,
  ] = await Promise.all([
    supabaseClient.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabaseClient.from("categories").select("*").order("name"),
    supabaseClient.from("transactions").select("*").order("tx_date", { ascending: false }),
    supabaseClient.from("budgets").select("*"),
    supabaseClient.from("subscriptions").select("*").order("next_payment_date"),
    supabaseClient.from("transfers").select("*").order("transfer_date", { ascending: false }),
    supabaseClient.from("savings_goals").select("*").order("created_at"),
    supabaseClient.from("savings_contributions").select("*"),
    supabaseClient.from("future_expenses").select("*").order("due_date"),
    supabaseClient.from("future_expense_contributions").select("*"),
    supabaseClient.from("trips").select("*, trip_members(*)").order("created_at", { ascending: false }),
  ]);

  state.profile = profile.data || { id: user.id, currency: "EUR", theme: "light" };
  state.categories = categories.data || [];
  state.transactions = transactions.data || [];
  state.budgets = budgets.data || [];
  state.subscriptions = subscriptions.data || [];
  state.transfers = transfers.data || [];
  state.goals = goals.data || [];
  state.goalContributions = goalContributions.data || [];
  state.futureExpenses = futureExpenses.data || [];
  state.futureContributions = futureContributions.data || [];
  state.trips = trips.data || [];
  state.loading = false;

  setCurrency(state.profile.currency);
  applyTheme(state.profile.theme);
  notify();
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
}

/* ---------- Realtime ---------- */
let channel = null;

const TABLE_TO_STATE = {
  transactions: "transactions",
  budgets: "budgets",
  subscriptions: "subscriptions",
  transfers: "transfers",
  categories: "categories",
  savings_goals: "goals",
  savings_contributions: "goalContributions",
  future_expenses: "futureExpenses",
  future_expense_contributions: "futureContributions",
};

export function startRealtime(userId) {
  stopRealtime();
  channel = supabaseClient.channel("mywallet");

  for (const [table, key] of Object.entries(TABLE_TO_STATE)) {
    channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `user_id=eq.${userId}` }, (payload) =>
      applyRealtime(key, payload)
    );
  }

  // I viaggi includono relazioni annidate (membri): si ricaricano per intero.
  channel.on("postgres_changes", { event: "*", schema: "public", table: "trips" }, () => reloadTrips());
  channel.on("postgres_changes", { event: "*", schema: "public", table: "trip_expenses" }, () => notify("trips"));

  channel.subscribe();
}

export function stopRealtime() {
  if (channel) {
    supabaseClient.removeChannel(channel);
    channel = null;
  }
}

function applyRealtime(key, { eventType, new: rec, old: prev }) {
  const list = state[key];
  if (eventType === "INSERT") {
    if (!list.some((r) => r.id === rec.id)) list.unshift(rec);
  } else if (eventType === "UPDATE") {
    const i = list.findIndex((r) => r.id === rec.id);
    if (i > -1) list[i] = rec;
    else list.unshift(rec);
  } else if (eventType === "DELETE") {
    const i = list.findIndex((r) => r.id === prev.id);
    if (i > -1) list.splice(i, 1);
  }
  notify(key);
}

export async function reloadTrips() {
  const { data } = await supabaseClient
    .from("trips")
    .select("*, trip_members(*)")
    .order("created_at", { ascending: false });
  state.trips = data || [];
  notify("trips");
}

/* ---------- Selettori ---------- */

// Raggruppamento tematico delle categorie di spesa predefinite nei menu a tendina.
const EXPENSE_CATEGORY_GROUPS = [
  ["Casa e utenze", [CATEGORY.CASA, CATEGORY.UTENZE]],
  ["Spesa e cibo", [CATEGORY.SPESA, CATEGORY.RISTORANTI, CATEGORY.BAR]],
  ["Trasporti", [CATEGORY.TRASPORTI, CATEGORY.CARBURANTE, CATEGORY.SPESE_AUTO]],
  ["Tempo libero", [CATEGORY.INTRATTENIMENTO, CATEGORY.SPORT, CATEGORY.VIAGGI, CATEGORY.SHOPPING]],
  ["Persona e famiglia", [CATEGORY.SALUTE, CATEGORY.ISTRUZIONE, CATEGORY.REGALI]],
  ["Finanze e tasse", [CATEGORY.TASSE, CATEGORY.RATE_FINANZIAMENTI]],
];

const signedAmount = (t) => (t.type === "ENTRATA" ? +t.amount : -t.amount);
const methodOf = (t) => (t.payment_method === "CONTANTI" ? "CONTANTI" : "CARTA");

export const selectors = {
  categoryName(id) {
    return state.categories.find((c) => c.id === id)?.name || "—";
  },
  expenseCategories() {
    return state.categories.filter((c) => c.kind === "expense");
  },
  incomeCategories() {
    return state.categories.filter((c) => c.kind === "income");
  },
  groupedExpenseCategories() {
    const cats = selectors.expenseCategories();
    const byName = new Map(cats.map((c) => [c.name, c]));
    const used = new Set();
    const groups = [];
    for (const [label, names] of EXPENSE_CATEGORY_GROUPS) {
      const options = [];
      for (const n of names) {
        const c = byName.get(n);
        if (!c) continue;
        used.add(n);
        options.push({ value: c.id, label: c.name });
      }
      if (options.length) groups.push({ label, options });
    }
    const others = cats.filter((c) => !used.has(c.name)).map((c) => ({ value: c.id, label: c.name }));
    if (others.length) groups.push({ label: groups.length ? "Altre categorie" : "Categorie", options: others });
    return groups;
  },

  totalBalance() {
    return state.transactions.reduce((sum, t) => sum + signedAmount(t), 0);
  },
  // Saldo per metodo di pagamento: movimenti del metodo ± trasferimenti.
  // La somma dei due saldi coincide con totalBalance().
  paymentMethodBalances() {
    const bal = { CARTA: 0, CONTANTI: 0 };
    for (const t of state.transactions) bal[methodOf(t)] += signedAmount(t);
    for (const tr of state.transfers) {
      if (bal[tr.from_method] != null) bal[tr.from_method] -= +tr.amount;
      if (bal[tr.to_method] != null) bal[tr.to_method] += +tr.amount;
    }
    return bal;
  },
  // Movimenti che incidono su un saldo. Con method = null (vista complessiva)
  // i trasferimenti hanno delta 0, perché non cambiano il patrimonio totale.
  methodMovements(method = null) {
    const lbl = (m) => (m === "CONTANTI" ? "Contanti" : "Carta");
    const out = [];
    for (const t of state.transactions) {
      const m = methodOf(t);
      if (method && m !== method) continue;
      const tag = t.subscription_id ? "abbonamento" : t.recurring_parent_id || t.is_recurring ? "ricorrente" : "";
      out.push({
        id: t.id,
        date: t.tx_date,
        method: m,
        kind: t.type === "ENTRATA" ? "in" : "out",
        title: t.title,
        sub: [t.category_name, tag].filter(Boolean).join(" · "),
        delta: signedAmount(t),
      });
    }
    for (const tr of state.transfers) {
      const base = { date: tr.transfer_date, kind: "transfer", title: "Trasferimento", note: tr.note || null };
      if (!method) {
        out.push({
          ...base,
          id: tr.id,
          method: null,
          sub: `${lbl(tr.from_method)} → ${lbl(tr.to_method)}`,
          delta: 0,
          amount: +tr.amount,
        });
        continue;
      }
      if (tr.from_method === method) {
        out.push({ ...base, id: `${tr.id}-o`, method, sub: `verso ${lbl(tr.to_method)}`, delta: -tr.amount });
      }
      if (tr.to_method === method) {
        out.push({ ...base, id: `${tr.id}-i`, method, sub: `da ${lbl(tr.from_method)}`, delta: +tr.amount });
      }
    }
    return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  },
  methodTrend(method, days = 30) {
    const cutoff = dateISO(new Date(Date.now() - days * 86400000));
    return selectors
      .methodMovements(method)
      .filter((m) => m.date >= cutoff)
      .reduce((s, m) => s + m.delta, 0);
  },

  monthIncome(ref = new Date()) {
    return state.transactions
      .filter((t) => t.type === "ENTRATA" && isSameMonth(t.tx_date, ref))
      .reduce((s, t) => s + +t.amount, 0);
  },
  monthExpense(ref = new Date()) {
    return state.transactions
      .filter((t) => t.type === "USCITA" && isSameMonth(t.tx_date, ref))
      .reduce((s, t) => s + +t.amount, 0);
  },
  spentByCategory(ref = new Date()) {
    const map = {};
    for (const t of state.transactions) {
      if (t.type !== "USCITA" || !isSameMonth(t.tx_date, ref)) continue;
      const name = t.category_name || selectors.categoryName(t.category_id);
      map[name] = (map[name] || 0) + +t.amount;
    }
    return map;
  },
  budgetRemaining(ref = new Date()) {
    const spent = selectors.spentByCategory(ref);
    return state.budgets.reduce((acc, b) => {
      const name = selectors.categoryName(b.category_id);
      return acc + Math.max(0, +b.monthly_limit - (spent[name] || 0));
    }, 0);
  },

  totalSavings() {
    return state.goalContributions.reduce((s, c) => s + +c.amount, 0);
  },
  goalSaved(goalId) {
    return state.goalContributions.filter((c) => c.savings_goal_id === goalId).reduce((s, c) => s + +c.amount, 0);
  },
  futureSaved(feId) {
    return state.futureContributions.filter((c) => c.future_expense_id === feId).reduce((s, c) => s + +c.amount, 0);
  },
  nextFutureExpense() {
    const today = todayISO();
    return (
      state.futureExpenses
        .filter((f) => !f.is_completed && f.due_date >= today)
        .sort((a, b) => a.due_date.localeCompare(b.due_date))[0] || null
    );
  },

  subIntervalMonths(sub) {
    if (sub.frequency === "MENSILE") return 1;
    if (sub.frequency === "ANNUALE") return 12;
    return Math.max(1, +sub.interval_months || 1);
  },
  // Importo effettivo in una data, tenendo conto della fine della promozione.
  subAmountOn(sub, date = new Date()) {
    const d = typeof date === "string" ? date : dateISO(date);
    if (sub.promo && sub.regular_amount && sub.promo_end_date && d >= sub.promo_end_date) {
      return +sub.regular_amount;
    }
    return +sub.amount;
  },
  subIsActive(sub, ref = new Date()) {
    if (sub.is_paused) return false;
    return !(sub.end_date && sub.end_date < dateISO(ref));
  },
  activeSubscriptions(ref = new Date()) {
    return state.subscriptions.filter((s) => selectors.subIsActive(s, ref));
  },
  // Costo mensile normalizzato: al prezzo attuale e a prezzo pieno (dopo la promozione).
  subscriptionCostSummary(ref = new Date()) {
    const active = selectors.activeSubscriptions(ref);
    let monthlyNow = 0;
    let monthlyRegular = 0;
    for (const s of active) {
      const months = selectors.subIntervalMonths(s);
      monthlyNow += selectors.subAmountOn(s, ref) / months;
      const regular = s.promo && s.regular_amount ? +s.regular_amount : +s.amount;
      monthlyRegular += regular / months;
    }
    return {
      count: active.length,
      monthly: monthlyNow,
      yearly: monthlyNow * 12,
      monthlyRegular,
      yearlyRegular: monthlyRegular * 12,
    };
  },
  subscriptionPromoAlerts(days = 7, ref = new Date()) {
    const from = dateISO(ref);
    const limit = dateISO(new Date(ref.getTime() + days * 86400000));
    return state.subscriptions
      .filter(
        (s) =>
          !s.is_paused &&
          s.promo &&
          s.regular_amount &&
          s.promo_end_date &&
          s.promo_end_date >= from &&
          s.promo_end_date <= limit
      )
      .map((s) => {
        const months = selectors.subIntervalMonths(s);
        return {
          sub: s,
          from: +s.amount,
          to: +s.regular_amount,
          monthlyDelta: (+s.regular_amount - +s.amount) / months,
        };
      });
  },
  // Addebiti di abbonamenti attesi nel mese `ref` e non ancora registrati, per categoria:
  // servono a proiettare l'impatto sui budget.
  projectedSubscriptionByCategory(ref = new Date()) {
    const key = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}`;
    const today = todayISO();
    const map = {};
    for (const s of state.subscriptions) {
      if (!selectors.subIsActive(s, ref)) continue;
      const months = selectors.subIntervalMonths(s);
      let d = parseDate(s.next_payment_date);
      let guard = 0;
      while (guard++ < 240) {
        const iso = dateISO(d);
        const dKey = iso.slice(0, 7);
        if (dKey > key) break;
        if (dKey === key && iso >= today) {
          const already = state.transactions.some((t) => t.subscription_id === s.id && t.tx_date === iso);
          if (!already) {
            const name = s.category_name || selectors.categoryName(s.category_id);
            map[name] = (map[name] || 0) + selectors.subAmountOn(s, iso);
          }
        }
        d = new Date(d);
        d.setMonth(d.getMonth() + months);
      }
    }
    return map;
  },
  upcomingSubscriptionCharges(count = 6, ref = new Date()) {
    const out = [];
    const horizon = new Date(ref.getFullYear() + 2, ref.getMonth(), ref.getDate());
    for (const s of state.subscriptions) {
      if (!selectors.subIsActive(s, ref)) continue;
      const months = selectors.subIntervalMonths(s);
      let d = parseDate(s.next_payment_date);
      let guard = 0;
      while (d < ref && guard++ < 240) d.setMonth(d.getMonth() + months);
      for (let i = 0; i < 6 && d <= horizon; i++) {
        if (s.end_date && dateISO(d) > s.end_date) break;
        out.push({
          id: `${s.id}-${i}`,
          name: s.name,
          date: dateISO(d),
          amount: selectors.subAmountOn(s, d),
          kind: "subscription",
        });
        d = new Date(d);
        d.setMonth(d.getMonth() + months);
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, count);
  },
};
