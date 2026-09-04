// Central store: application state, data loading, realtime via channel.
import { supabaseClient } from "./supabaseClient.js";
import { createEmitter, setCurrency, isSameMonth, dateISO, todayISO } from "./utils.js";

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

// Force a UI refresh after optimistic state changes, without waiting for the
// realtime event.
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
    supabaseClient.from("transfers").select("*").order("transfer_date", { ascending: false }).then((r) => (r.error ? { data: [], error: null } : r)),
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

// Realtime: a single channel with several listeners filtered by user.
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
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table, filter: `user_id=eq.${userId}` },
      (payload) => applyRealtime(key, payload)
    );
  }

  // Trips are reloaded in full (nested relations).
  channel.on(
    "postgres_changes",
    { event: "*", schema: "public", table: "trips" },
    () => reloadTrips()
  );
  channel.on(
    "postgres_changes",
    { event: "*", schema: "public", table: "trip_expenses" },
    () => notify("trips")
  );

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

async function reloadTrips() {
  const { data } = await supabaseClient
    .from("trips")
    .select("*, trip_members(*)")
    .order("created_at", { ascending: false });
  state.trips = data || [];
  notify("trips");
}

// Selectors / derived calculations.
// Themed grouping of the default expense categories, to speed up the choice
// in dropdown menus.
const EXPENSE_CATEGORY_GROUPS = [
  ["Casa e utenze", ["CASA", "UTENZE"]],
  ["Spesa e cibo", ["SPESA", "RISTORANTI", "BAR"]],
  ["Trasporti", ["TRASPORTI", "CARBURANTE", "SPESE AUTO"]],
  ["Tempo libero", ["INTRATTENIMENTO", "SPORT", "VIAGGI", "SHOPPING"]],
  ["Persona e famiglia", ["SALUTE", "ISTRUZIONE", "REGALI"]],
  ["Finanze e tasse", ["TASSE", "RATE FINANZIAMENTI"]],
];

export const selectors = {
  categoryName(id) {
    return state.categories.find((c) => c.id === id)?.name || "—";
  },
  expenseCategories() {
    return state.categories.filter((c) => c.kind === "expense");
  },
  // Expense categories split into themed groups (for a <select> with optgroups).
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
    const others = cats
      .filter((c) => !used.has(c.name))
      .map((c) => ({ value: c.id, label: c.name }));
    if (others.length) groups.push({ label: groups.length ? "Altre categorie" : "Categorie", options: others });
    return groups;
  },
  incomeCategories() {
    return state.categories.filter((c) => c.kind === "income");
  },
  totalBalance() {
    return state.transactions.reduce(
      (sum, t) => sum + (t.type === "ENTRATA" ? +t.amount : -t.amount),
      0
    );
  },
  // Balance of each payment method: income − expenses of that method
  // ± transfers to/from it (the sum still equals totalBalance).
  paymentMethodBalances() {
    const bal = { CARTA: 0, CONTANTI: 0 };
    for (const t of state.transactions) {
      const m = t.payment_method === "CONTANTI" ? "CONTANTI" : "CARTA";
      bal[m] += t.type === "ENTRATA" ? +t.amount : -t.amount;
    }
    for (const tr of state.transfers) {
      if (bal[tr.from_method] != null) bal[tr.from_method] -= +tr.amount;
      if (bal[tr.to_method] != null) bal[tr.to_method] += +tr.amount;
    }
    return bal;
  },
  // Unified list of movements affecting a balance.
  //   method = "CARTA" | "CONTANTI"  ->  effect on that method's balance (delta)
  //   method = null                  ->  overall view (transfers are neutral)
  methodMovements(method = null) {
    const lbl = (m) => (m === "CONTANTI" ? "Contanti" : "Carta");
    const out = [];
    for (const t of state.transactions) {
      const m = t.payment_method === "CONTANTI" ? "CONTANTI" : "CARTA";
      if (method && m !== method) continue;
      out.push({
        id: t.id, date: t.tx_date, method: m,
        kind: t.type === "ENTRATA" ? "in" : "out",
        title: t.title,
        sub: [t.category_name, t.subscription_id ? "abbonamento" : t.recurring_parent_id || t.is_recurring ? "ricorrente" : ""].filter(Boolean).join(" · "),
        delta: t.type === "ENTRATA" ? +t.amount : -t.amount,
      });
    }
    for (const tr of state.transfers) {
      if (!method) {
        out.push({ id: tr.id, date: tr.transfer_date, method: null, kind: "transfer", title: "Trasferimento", sub: `${lbl(tr.from_method)} → ${lbl(tr.to_method)}`, delta: 0, amount: +tr.amount, note: tr.note || null });
        continue;
      }
      if (tr.from_method === method) out.push({ id: `${tr.id}-o`, date: tr.transfer_date, method, kind: "transfer", title: "Trasferimento", sub: `verso ${lbl(tr.to_method)}`, delta: -tr.amount, note: tr.note || null });
      if (tr.to_method === method) out.push({ id: `${tr.id}-i`, date: tr.transfer_date, method, kind: "transfer", title: "Trasferimento", sub: `da ${lbl(tr.from_method)}`, delta: +tr.amount, note: tr.note || null });
    }
    return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  },
  // Change in a method's balance over the last `days` days.
  methodTrend(method, days = 30) {
    const cutoff = dateISO(new Date(Date.now() - days * 86400000));
    return selectors.methodMovements(method)
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
  totalSavings() {
    return state.goalContributions.reduce((s, c) => s + +c.amount, 0);
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
  nextFutureExpense() {
    const today = todayISO();
    return state.futureExpenses
      .filter((f) => !f.is_completed && f.due_date >= today)
      .sort((a, b) => a.due_date.localeCompare(b.due_date))[0] || null;
  },
  goalSaved(goalId) {
    return state.goalContributions
      .filter((c) => c.savings_goal_id === goalId)
      .reduce((s, c) => s + +c.amount, 0);
  },
  futureSaved(feId) {
    return state.futureContributions
      .filter((c) => c.future_expense_id === feId)
      .reduce((s, c) => s + +c.amount, 0);
  },

  subIntervalMonths(sub) {
    if (sub.frequency === "MENSILE") return 1;
    if (sub.frequency === "ANNUALE") return 12;
    return Math.max(1, +sub.interval_months || 1);
  },
  // Effective subscription amount on a given date (accounts for the promo).
  subAmountOn(sub, date = new Date()) {
    const d = typeof date === "string" ? date : dateISO(date);
    if (sub.promo && sub.regular_amount && sub.promo_end_date && d >= sub.promo_end_date) {
      return +sub.regular_amount;
    }
    return +sub.amount;
  },
  subIsActive(sub, ref = new Date()) {
    const today = dateISO(ref);
    if (sub.is_paused) return false;
    if (sub.end_date && sub.end_date < today) return false;
    return true;
  },
  activeSubscriptions(ref = new Date()) {
    return state.subscriptions.filter((s) => selectors.subIsActive(s, ref));
  },
  // Normalised monthly cost (current promo) and "full-price" monthly cost.
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
  // Promo subscriptions whose price changes within `days` days.
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
  // Subscription charges expected in month `ref` but not yet recorded,
  // grouped by category (to project the impact on budgets).
  projectedSubscriptionByCategory(ref = new Date()) {
    const key = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}`;
    const today = todayISO();
    const map = {};
    for (const s of state.subscriptions) {
      if (!selectors.subIsActive(s, ref)) continue;
      const months = selectors.subIntervalMonths(s);
      let d = new Date(s.next_payment_date);
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
  // Next expected subscription charges (for the future-expenses calendar).
  upcomingSubscriptionCharges(count = 6, ref = new Date()) {
    const out = [];
    const horizon = new Date(ref.getFullYear() + 2, ref.getMonth(), ref.getDate());
    for (const s of state.subscriptions) {
      if (!selectors.subIsActive(s, ref)) continue;
      const months = selectors.subIntervalMonths(s);
      let d = new Date(s.next_payment_date);
      // Advance the date to the first future charge.
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
