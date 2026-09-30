import { test } from "node:test";
import assert from "node:assert/strict";
import { isDemoUser, demoTimeLeft, formatTimeLeft, DEMO_MINUTES } from "../assets/js/demo.js";

test("isDemoUser riconosce solo gli utenti anonimi", () => {
  assert.equal(isDemoUser({ is_anonymous: true }), true);
  assert.equal(isDemoUser({ is_anonymous: false }), false);
  assert.equal(isDemoUser(null), false);
});

test("demoTimeLeft parte da DEMO_MINUTES e non va sotto zero", () => {
  const created = new Date("2026-09-30T10:00:00Z");
  const user = { created_at: created.toISOString() };
  assert.equal(demoTimeLeft(user, created.getTime()), DEMO_MINUTES * 60_000);
  assert.equal(demoTimeLeft(user, created.getTime() + 10 * 60_000), (DEMO_MINUTES - 10) * 60_000);
  assert.equal(demoTimeLeft(user, created.getTime() + 2 * DEMO_MINUTES * 60_000), 0);
});

test("formatTimeLeft arrotonda per eccesso ai minuti", () => {
  assert.equal(formatTimeLeft(29.2 * 60_000), "30 minuti");
  assert.equal(formatTimeLeft(2 * 60_000), "2 minuti");
  assert.equal(formatTimeLeft(40_000), "meno di un minuto");
});
