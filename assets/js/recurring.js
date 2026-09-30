// Transazioni ricorrenti: ogni transazione con is_recurring = true fa da modello.
// All'avvio vengono create le copie mancanti per ogni mese trascorso fino a quello corrente
// (copie con recurring_parent_id = id del modello e is_recurring = false).
import { supabaseClient } from "./supabaseClient.js";
import { state } from "./store.js";
import { monthKey, dateISO, normalizeTitle, parseDate } from "./utils.js";

export async function generateRecurring() {
  const templates = state.transactions.filter((t) => t.is_recurring && !t.recurring_parent_id);
  if (!templates.length) return 0;

  const currentKey = monthKey(new Date());
  const toInsert = [];

  for (const tpl of templates) {
    const covered = new Set(
      state.transactions
        .filter((t) => t.id === tpl.id || t.recurring_parent_id === tpl.id)
        .map((t) => monthKey(parseDate(t.tx_date)))
    );
    const endKey = tpl.recurring_end ? monthKey(parseDate(tpl.recurring_end)) : null;

    const cursor = parseDate(tpl.tx_date);
    cursor.setDate(1);
    while (monthKey(cursor) <= currentKey) {
      const key = monthKey(cursor);
      if (endKey && key > endKey) break;
      if (!covered.has(key)) {
        const day = Math.min(tpl.recurring_day || parseDate(tpl.tx_date).getDate(), daysInMonth(cursor));
        toInsert.push({
          user_id: state.user.id,
          title: normalizeTitle(tpl.title),
          amount: tpl.amount,
          category_id: tpl.category_id,
          category_name: tpl.category_name,
          type: tpl.type,
          tx_date: dateISO(new Date(cursor.getFullYear(), cursor.getMonth(), day)),
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
  if (error) throw error;
  // Aggiornamento immediato: il realtime potrebbe non essere ancora attivo.
  for (const row of data || []) {
    if (!state.transactions.some((t) => t.id === row.id)) state.transactions.unshift(row);
  }
  return (data || []).length;
}

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}
