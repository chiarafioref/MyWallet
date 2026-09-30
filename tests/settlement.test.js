import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBalances, simplifyDebts, tripTotal, payerOf } from "../assets/js/settlement.js";

const members = [
  { user_id: "a", display_name: "Anna" },
  { user_id: "b", display_name: "Bruno" },
  { user_id: "c", display_name: "Carla" },
];

test("payerOf usa paid_by e ripiega su created_by", () => {
  assert.equal(payerOf({ paid_by: "b", created_by: "a" }), "b");
  assert.equal(payerOf({ paid_by: null, created_by: "a" }), "a");
});

test("tripTotal sottrae i rimborsi ricevuti", () => {
  const total = tripTotal([
    { type: "USCITA", amount: "100" },
    { type: "ENTRATA", amount: "20" },
  ]);
  assert.equal(total, 80);
});

test("computeBalances calcola quota a testa e saldi", () => {
  const { total, perHead, rows } = computeBalances(
    [
      { type: "USCITA", amount: 90, created_by: "a" },
      { type: "USCITA", amount: 30, created_by: "c", paid_by: "b" },
    ],
    members
  );
  assert.equal(total, 120);
  assert.equal(perHead, 40);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.a.balance, 50);
  assert.equal(byId.b.balance, -10);
  assert.equal(byId.c.balance, -40);
  assert.equal(rows[0].id, "a", "ordinati per importo pagato");
});

test("simplifyDebts azzera i saldi con il minimo di rimborsi", () => {
  const { rows } = computeBalances([{ type: "USCITA", amount: 90, created_by: "a" }], members);
  const transfers = simplifyDebts(rows);
  assert.deepEqual(
    transfers.map((t) => [t.from, t.to, t.amount]),
    [
      ["Bruno", "Anna", 30],
      ["Carla", "Anna", 30],
    ]
  );
});

test("simplifyDebts non genera rimborsi se i conti sono in pari", () => {
  const { rows } = computeBalances(
    members.map((m) => ({ type: "USCITA", amount: 25, created_by: m.user_id })),
    members
  );
  assert.deepEqual(simplifyDebts(rows), []);
});

test("simplifyDebts conserva il totale dovuto con importi decimali", () => {
  const balances = [
    { name: "A", balance: 33.34 },
    { name: "B", balance: -16.67 },
    { name: "C", balance: -16.67 },
  ];
  const paid = simplifyDebts(balances).reduce((s, t) => s + t.amount, 0);
  assert.ok(Math.abs(paid - 33.34) < 0.01);
});
