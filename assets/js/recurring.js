// Automatic generation of recurring transactions.
// Every transaction with is_recurring = true is a "template": on app start, the
// missing copies are created for each elapsed month up to the current one
// (recurring_parent_id -> template id, is_recurring = false on the copies).
import { supabaseClient } from "./supabaseClient.js";
import { state } from "./store.js";
import { monthKey, dateISO, normalizeTitle } from "./utils.js";

export async function generateRecurring() {
  const templates = state.transactions.filter((t) => t.is_recurring && !t.recurring_parent_id);
  if (!templates.length) return 0;

  const now = new Date();
  const currentKey = monthKey(now);
  const toInsert = [];

  for (const tpl of templates) {
    // Months already covered by this template (including the template itself).
    const covered = new Set(
      state.transactions
        .filter((t) => t.id === tpl.id || t.recurring_parent_id === tpl.id)
        .map((t) => monthKey(new Date(t.tx_date)))
    );

    // The recurrence stops after the month of the expected end date.
    const endKey = tpl.recurring_end ? monthKey(new Date(tpl.recurring_end)) : null;

    const cursor = new Date(tpl.tx_date);
    cursor.setDate(1);
    // Step month by month from the template date to the current month.
    while (monthKey(cursor) <= currentKey) {
      const key = monthKey(cursor);
      if (endKey && key > endKey) break;
      if (!covered.has(key)) {
        const day = Math.min(
          tpl.recurring_day || new Date(tpl.tx_date).getDate(),
          daysInMonth(cursor)
        );
        const d = new Date(cursor.getFullYear(), cursor.getMonth(), day);
        toInsert.push({
          user_id: state.user.id,
          title: normalizeTitle(tpl.title),
          amount: tpl.amount,
          category_id: tpl.category_id,
          category_name: tpl.category_name,
          type: tpl.type,
          tx_date: dateISO(d),
          description: tpl.description,
          payment_method: tpl.payment_method,
          is_recurring: false,
          recurring_parent_id: tpl.id,
        });
        covered.add(key);
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  if (!toInsert.length) return 0;
  const { data, error } = await supabaseClient.from("transactions").insert(toInsert).select();
  if (error) {
    console.warn("[recurring] generation failed:", error.message);
    return 0;
  }
  // Update local state (realtime may not be active yet).
  for (const row of data || []) {
    if (!state.transactions.some((t) => t.id === row.id)) state.transactions.unshift(row);
  }
  return (data || []).length;
}

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}
