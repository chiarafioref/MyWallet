import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, selectors } from "../assets/js/store.js";
import { dateISO } from "../assets/js/utils.js";

const thisMonth = (day) => dateISO(new Date(new Date().getFullYear(), new Date().getMonth(), day));

beforeEach(() => {
  state.categories = [{ id: "c1", name: "Ristoranti", kind: "expense" }];
  state.transactions = [
    { id: "1", type: "ENTRATA", amount: "1000", payment_method: "CARTA", tx_date: thisMonth(1) },
    { id: "2", type: "USCITA", amount: "40", payment_method: "CONTANTI", tx_date: thisMonth(2), category_name: "Bar" },
    { id: "3", type: "USCITA", amount: "60", payment_method: "CARTA", tx_date: thisMonth(3), category_id: "c1" },
  ];
  state.transfers = [{ id: "t1", from_method: "CARTA", to_method: "CONTANTI", amount: "100" }];
  state.subscriptions = [];
  state.budgets = [];
});

test("totalBalance somma entrate e uscite", () => {
  assert.equal(selectors.totalBalance(), 900);
});

test("i trasferimenti spostano il saldo tra i metodi senza cambiare il totale", () => {
  const bal = selectors.paymentMethodBalances();
  assert.deepEqual(bal, { CARTA: 840, CONTANTI: 60 });
  assert.equal(bal.CARTA + bal.CONTANTI, selectors.totalBalance());
});

test("spentByCategory usa lo snapshot o, in mancanza, il nome della categoria", () => {
  assert.deepEqual(selectors.spentByCategory(), { Bar: 40, Ristoranti: 60 });
});

test("subAmountOn applica il prezzo pieno dalla fine della promozione", () => {
  const sub = { amount: "4.99", promo: true, regular_amount: "9.99", promo_end_date: "2026-06-01" };
  assert.equal(selectors.subAmountOn(sub, "2026-05-31"), 4.99);
  assert.equal(selectors.subAmountOn(sub, "2026-06-01"), 9.99);
});

test("subIntervalMonths gestisce le frequenze", () => {
  assert.equal(selectors.subIntervalMonths({ frequency: "MENSILE" }), 1);
  assert.equal(selectors.subIntervalMonths({ frequency: "ANNUALE" }), 12);
  assert.equal(selectors.subIntervalMonths({ frequency: "PERSONALIZZATA", interval_months: 3 }), 3);
});

test("subscriptionCostSummary normalizza i costi su base mensile", () => {
  state.subscriptions = [
    { amount: "10", frequency: "MENSILE" },
    { amount: "120", frequency: "ANNUALE" },
    { amount: "50", frequency: "MENSILE", is_paused: true },
  ];
  const s = selectors.subscriptionCostSummary();
  assert.equal(s.count, 2);
  assert.equal(s.monthly, 20);
  assert.equal(s.yearly, 240);
});
