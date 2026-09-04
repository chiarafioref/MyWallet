// Data access layer: CRUD wrappers over Supabase.
// RLS policies enforce per-user isolation; user_id is added here.
import { supabaseClient } from "./supabaseClient.js";
import { state } from "./store.js";
import { normalizeTitle } from "./utils.js";

const uid = () => state.user.id;

// Force the title to UPPERCASE on every saved transaction.
const withUpperTitle = (obj) =>
  obj && obj.title != null ? { ...obj, title: normalizeTitle(obj.title) } : obj;

async function run(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

// Columns added in later schema versions: they may not exist on databases that
// have not been migrated. If an insert/update fails because one of these
// columns is missing, retry without it (avoids the PostgREST 400 error).
const OPTIONAL_TX_COLS = ["recurring_end", "savings_goal_id", "future_expense_id", "subscription_id"];

const isMissingColumnError = (err) => {
  const m = `${err?.code || ""} ${err?.message || ""} ${err?.details || ""}`.toLowerCase();
  return (
    m.includes("pgrst204") ||
    /could not find the '.*' column/.test(m) ||
    /column .* does not exist/.test(m) ||
    (m.includes("schema cache") && m.includes("column"))
  );
};

// Remove keys with an undefined value (they must not be sent to PostgREST).
const pruneUndefined = (obj) => {
  const out = {};
  for (const k in obj) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
};

// Insert that retries without the optional columns if one is missing.
async function insertResilient(table, row, optionalCols = []) {
  try {
    return await run(supabaseClient.from(table).insert(row).select().single());
  } catch (err) {
    if (!isMissingColumnError(err) || !optionalCols.length) throw err;
    const stripped = { ...row };
    for (const c of optionalCols) delete stripped[c];
    console.warn(`[${table}] schema not migrated, retrying without: ${optionalCols.join(", ")}`);
    return run(supabaseClient.from(table).insert(stripped).select().single());
  }
}

async function txWrite(builderFor) {
  try {
    return await run(builderFor(null));
  } catch (err) {
    if (!isMissingColumnError(err)) throw err;
    console.warn("[transactions] schema not migrated, retrying without optional columns:", err.message);
    return run(builderFor(OPTIONAL_TX_COLS));
  }
}

const stripCols = (obj, cols) => {
  if (!cols) return obj;
  const out = { ...obj };
  for (const c of cols) delete out[c];
  return out;
};

export const transactions = {
  create: (t) => {
    const row = pruneUndefined({ ...withUpperTitle(t), user_id: uid() });
    // On insert, an empty optional column is equivalent to not sending it,
    // so the insert also succeeds on schemas that have not been migrated.
    for (const c of OPTIONAL_TX_COLS) if (row[c] == null) delete row[c];
    return txWrite((strip) => supabaseClient.from("transactions").insert(stripCols(row, strip)).select().single());
  },
  update: (id, patch) => {
    const row = pruneUndefined(withUpperTitle(patch));
    return txWrite((strip) => supabaseClient.from("transactions").update(stripCols(row, strip)).eq("id", id).select().single());
  },
  remove: (id) => run(supabaseClient.from("transactions").delete().eq("id", id)),
  removeByGoal: async (goalId) => {
    try { return await run(supabaseClient.from("transactions").delete().eq("savings_goal_id", goalId)); }
    catch (e) { console.warn("[transactions] removeByGoal:", e.message); return null; }
  },
  removeByFuture: async (feId) => {
    try { return await run(supabaseClient.from("transactions").delete().eq("future_expense_id", feId)); }
    catch (e) { console.warn("[transactions] removeByFuture:", e.message); return null; }
  },
};

export const categories = {
  create: (c) => run(supabaseClient.from("categories").insert({ ...c, user_id: uid(), is_default: false }).select().single()),
  remove: (id) => run(supabaseClient.from("categories").delete().eq("id", id)),
};

export const budgets = {
  upsert: (b) =>
    run(
      supabaseClient
        .from("budgets")
        .upsert({ ...b, user_id: uid() }, { onConflict: "user_id,category_id" })
        .select()
        .single()
    ),
  remove: (id) => run(supabaseClient.from("budgets").delete().eq("id", id)),
};

export const goals = {
  create: (g) => run(supabaseClient.from("savings_goals").insert({ ...g, user_id: uid() }).select().single()),
  update: (id, patch) => run(supabaseClient.from("savings_goals").update(patch).eq("id", id).select().single()),
  remove: (id) => run(supabaseClient.from("savings_goals").delete().eq("id", id)),
  addContribution: (c) =>
    run(supabaseClient.from("savings_contributions").insert({ ...c, user_id: uid() }).select().single()),
};

export const futureExpenses = {
  create: (f) => run(supabaseClient.from("future_expenses").insert({ ...f, user_id: uid() }).select().single()),
  update: (id, patch) => run(supabaseClient.from("future_expenses").update(patch).eq("id", id).select().single()),
  remove: (id) => run(supabaseClient.from("future_expenses").delete().eq("id", id)),
  addContribution: (c) =>
    run(supabaseClient.from("future_expense_contributions").insert({ ...c, user_id: uid() }).select().single()),
};

export const transfers = {
  create: (t) => run(supabaseClient.from("transfers").insert({ ...t, user_id: uid() }).select().single()),
  update: (id, patch) => run(supabaseClient.from("transfers").update(patch).eq("id", id).select().single()),
  remove: (id) => run(supabaseClient.from("transfers").delete().eq("id", id)),
};

export const subscriptions = {
  create: (s) => run(supabaseClient.from("subscriptions").insert({ ...s, user_id: uid() }).select().single()),
  update: (id, patch) => run(supabaseClient.from("subscriptions").update(patch).eq("id", id).select().single()),
  remove: (id) => run(supabaseClient.from("subscriptions").delete().eq("id", id)),
};

export const profile = {
  update: (patch) =>
    run(supabaseClient.from("profiles").update(patch).eq("id", uid()).select().single()),
  updatePassword: (password) => run(supabaseClient.auth.updateUser({ password })),
  deleteData: () => run(supabaseClient.rpc("delete_my_data")),
};

export const trips = {
  create: async (name) => {
    const trip = await run(
      supabaseClient.from("trips").insert({ name, owner_id: uid() }).select().single()
    );
    const p = state.profile;
    await run(
      supabaseClient.from("trip_members").insert({
        trip_id: trip.id,
        user_id: uid(),
        display_name: [p.first_name, p.last_name].filter(Boolean).join(" ") || "Utente",
      })
    );
    return trip;
  },
  join: (key) => run(supabaseClient.rpc("join_trip", { p_key: key })),
  setStatus: (id, status) =>
    run(supabaseClient.from("trips").update({ status }).eq("id", id).select().single()),
  remove: (id) => run(supabaseClient.from("trips").delete().eq("id", id)),
  listExpenses: (tripId) =>
    run(supabaseClient.from("trip_expenses").select("*").eq("trip_id", tripId).order("expense_date", { ascending: false })),
  members: (tripId) =>
    run(supabaseClient.from("trip_members").select("*").eq("trip_id", tripId)),
  listCategories: (tripId) =>
    run(supabaseClient.from("trip_categories").select("*").eq("trip_id", tripId).order("name")),
  addCategory: (tripId, name) =>
    run(
      supabaseClient
        .from("trip_categories")
        .insert({ trip_id: tripId, name, created_by: uid() })
        .select()
        .single()
    ),
  addExpense: (e) =>
    insertResilient("trip_expenses", { ...e, created_by: uid() }, ["paid_by"]),
  removeExpense: (id) => run(supabaseClient.from("trip_expenses").delete().eq("id", id)),
};
