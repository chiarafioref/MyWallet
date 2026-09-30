// Calcolo dei conti di un viaggio condiviso.

const EPSILON = 0.005;

export const payerOf = (expense) => expense.paid_by || expense.created_by;

// Le ENTRATA (rimborsi ricevuti dal gruppo) riducono il totale speso.
export const tripTotal = (expenses) => expenses.reduce((s, e) => s + (e.type === "ENTRATA" ? -e.amount : +e.amount), 0);

/**
 * Quanto ha pagato ogni partecipante e il suo saldo rispetto alla quota a testa
 * (positivo = deve ricevere, negativo = deve dare).
 * @returns {{ total: number, perHead: number, rows: Array<{ id, name, paid, balance }> }}
 */
export function computeBalances(expenses, members) {
  const total = tripTotal(expenses);
  const perHead = members.length ? total / members.length : 0;
  const paid = {};
  for (const e of expenses) {
    if (e.type !== "USCITA") continue;
    paid[payerOf(e)] = (paid[payerOf(e)] || 0) + +e.amount;
  }
  const rows = members
    .map((m) => ({ id: m.user_id, name: m.display_name, paid: paid[m.user_id] || 0 }))
    .map((r) => ({ ...r, balance: r.paid - perHead }))
    .sort((a, b) => b.paid - a.paid);
  return { total, perHead, rows };
}

/**
 * Riduce i saldi al numero minimo di rimborsi "da → a" (algoritmo greedy:
 * il debitore maggiore paga il creditore maggiore finché i saldi si azzerano).
 */
export function simplifyDebts(balances) {
  const pick = (sign) =>
    balances
      .filter((b) => sign * b.balance > EPSILON)
      .map((b) => ({ name: b.name, amount: sign * b.balance }))
      .sort((a, b) => b.amount - a.amount);
  const creditors = pick(1);
  const debtors = pick(-1);

  const out = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);
    out.push({ from: debtors[i].name, to: creditors[j].name, amount });
    debtors[i].amount -= amount;
    creditors[j].amount -= amount;
    if (debtors[i].amount < EPSILON) i++;
    if (creditors[j].amount < EPSILON) j++;
  }
  return out;
}
