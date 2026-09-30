// Accesso ai dati: CRUD su Supabase. L'isolamento per utente è garantito dalle policy RLS;
// qui viene solo valorizzato user_id sugli insert.
import { supabaseClient } from "./supabaseClient.js";
import { state } from "./store.js";
import { normalizeTitle } from "./utils.js";

const uid = () => state.user.id;

const withNormalizedTitle = (obj) => (obj?.title != null ? { ...obj, title: normalizeTitle(obj.title) } : obj);

async function run(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// CRUD standard per le tabelle con colonna user_id.
function ownedTable(table) {
  return {
    create: (row) =>
      run(
        supabaseClient
          .from(table)
          .insert({ ...row, user_id: uid() })
          .select()
          .single()
      ),
    update: (id, patch) => run(supabaseClient.from(table).update(patch).eq("id", id).select().single()),
    remove: (id) => run(supabaseClient.from(table).delete().eq("id", id)),
  };
}

const insertOwned = (table, row) =>
  run(
    supabaseClient
      .from(table)
      .insert({ ...row, user_id: uid() })
      .select()
      .single()
  );

const txTable = ownedTable("transactions");

export const transactions = {
  create: (t) => txTable.create(withNormalizedTitle(t)),
  update: (id, patch) => txTable.update(id, withNormalizedTitle(patch)),
  remove: txTable.remove,
  removeByGoal: (goalId) => run(supabaseClient.from("transactions").delete().eq("savings_goal_id", goalId)),
  removeByFuture: (feId) => run(supabaseClient.from("transactions").delete().eq("future_expense_id", feId)),
};

export const categories = {
  create: (c) => insertOwned("categories", { ...c, is_default: false }),
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
  ...ownedTable("savings_goals"),
  addContribution: (c) => insertOwned("savings_contributions", c),
};

export const futureExpenses = {
  ...ownedTable("future_expenses"),
  addContribution: (c) => insertOwned("future_expense_contributions", c),
};

export const transfers = ownedTable("transfers");

export const subscriptions = ownedTable("subscriptions");

export const profile = {
  update: (patch) => run(supabaseClient.from("profiles").update(patch).eq("id", uid()).select().single()),
  updatePassword: (password) => run(supabaseClient.auth.updateUser({ password })),
  deleteData: () => run(supabaseClient.rpc("delete_my_data")),
};

export const trips = {
  create: async (name) => {
    const trip = await run(supabaseClient.from("trips").insert({ name, owner_id: uid() }).select().single());
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
  setStatus: (id, status) => run(supabaseClient.from("trips").update({ status }).eq("id", id).select().single()),
  remove: (id) => run(supabaseClient.from("trips").delete().eq("id", id)),
  listExpenses: (tripId) =>
    run(
      supabaseClient.from("trip_expenses").select("*").eq("trip_id", tripId).order("expense_date", { ascending: false })
    ),
  members: (tripId) => run(supabaseClient.from("trip_members").select("*").eq("trip_id", tripId)),
  listCategories: (tripId) =>
    run(supabaseClient.from("trip_categories").select("*").eq("trip_id", tripId).order("name")),
  addCategory: (tripId, name) =>
    run(supabaseClient.from("trip_categories").insert({ trip_id: tripId, name, created_by: uid() }).select().single()),
  addExpense: (e) =>
    run(
      supabaseClient
        .from("trip_expenses")
        .insert({ ...e, created_by: uid() })
        .select()
        .single()
    ),
  // RLS consente la cancellazione solo a chi ha creato la spesa: `select()` permette di
  // distinguere una cancellazione riuscita da una ignorata (0 righe).
  removeExpense: async (id) => {
    const rows = await run(supabaseClient.from("trip_expenses").delete().eq("id", id).select("id"));
    if (!rows?.length) throw new Error("Puoi eliminare solo le spese che hai inserito tu");
  },
};
