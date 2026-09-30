// Addebiti automatici degli abbonamenti: per ogni scadenza passata di un abbonamento attivo
// viene registrata una transazione USCITA (collegata tramite subscription_id) e
// next_payment_date avanza alla prima scadenza futura.
import { supabaseClient } from "./supabaseClient.js";
import { state, selectors } from "./store.js";
import { dateISO, normalizeTitle, parseDate } from "./utils.js";

export async function generateSubscriptions() {
  if (!state.subscriptions.length) return 0;

  const today = dateISO(new Date());
  const toInsert = [];
  const advance = [];

  for (const sub of state.subscriptions) {
    if (sub.is_paused) continue;
    const months = selectors.subIntervalMonths(sub);
    const covered = new Set(state.transactions.filter((t) => t.subscription_id === sub.id).map((t) => t.tx_date));

    let cursor = parseDate(sub.next_payment_date);
    let guard = 0;
    let lastPaid = null;

    while (dateISO(cursor) <= today && guard++ < 600) {
      const iso = dateISO(cursor);
      const beforeStart = sub.start_date && iso < sub.start_date;
      const afterEnd = sub.end_date && iso > sub.end_date;

      if (!beforeStart && !afterEnd && !covered.has(iso)) {
        toInsert.push({
          user_id: state.user.id,
          title: normalizeTitle(sub.name),
          amount: selectors.subAmountOn(sub, iso),
          category_id: sub.category_id,
          category_name: sub.category_name,
          type: "USCITA",
          tx_date: iso,
          description: "Abbonamento",
          payment_method: sub.payment_method,
          is_recurring: false,
          subscription_id: sub.id,
        });
        covered.add(iso);
      }
      lastPaid = iso;
      cursor = new Date(cursor);
      cursor.setMonth(cursor.getMonth() + months);
      if (sub.end_date && dateISO(cursor) > sub.end_date) break;
    }

    const nextISO = dateISO(cursor);
    if (lastPaid && nextISO !== sub.next_payment_date) {
      advance.push({ id: sub.id, next_payment_date: nextISO });
    }
  }

  let inserted = 0;
  if (toInsert.length) {
    // In caso di errore le scadenze non devono avanzare, altrimenti gli addebiti andrebbero persi.
    const { data, error } = await supabaseClient.from("transactions").insert(toInsert).select();
    if (error) throw error;
    for (const row of data || []) {
      if (!state.transactions.some((t) => t.id === row.id)) state.transactions.unshift(row);
    }
    inserted = (data || []).length;
  }

  for (const a of advance) {
    const { data, error } = await supabaseClient
      .from("subscriptions")
      .update({ next_payment_date: a.next_payment_date })
      .eq("id", a.id)
      .select()
      .single();
    if (!error && data) {
      const i = state.subscriptions.findIndex((s) => s.id === a.id);
      if (i > -1) state.subscriptions[i] = data;
    }
  }

  return inserted;
}
