import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDate,
  dateISO,
  isSameMonth,
  monthsBetween,
  normalizeTitle,
  sameText,
  escapeHtml,
} from "../assets/js/utils.js";

test("parseDate interpreta YYYY-MM-DD in ora locale", () => {
  const d = parseDate("2026-03-01");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 2);
  assert.equal(d.getDate(), 1);
  assert.equal(d.getHours(), 0);
});

test("dateISO è l'inverso di parseDate", () => {
  for (const iso of ["2026-01-01", "2026-02-28", "2024-02-29", "2026-12-31"]) {
    assert.equal(dateISO(parseDate(iso)), iso);
  }
});

test("isSameMonth non sposta al mese precedente il primo del mese", () => {
  assert.ok(isSameMonth("2026-03-01", new Date(2026, 2, 15)));
  assert.ok(!isSameMonth("2026-02-28", new Date(2026, 2, 15)));
});

test("monthsBetween conta solo i mesi interi", () => {
  assert.equal(monthsBetween(new Date(2026, 0, 15), new Date(2026, 3, 15)), 3);
  assert.equal(monthsBetween(new Date(2026, 0, 15), new Date(2026, 3, 14)), 2);
  assert.equal(monthsBetween(new Date(2026, 0, 31), new Date(2026, 1, 28)), 0);
});

test("normalizeTitle applica il sentence case e compatta gli spazi", () => {
  assert.equal(normalizeTitle("  SPESA   ESSELUNGA "), "Spesa esselunga");
  assert.equal(normalizeTitle("àffitto"), "Àffitto");
  assert.equal(normalizeTitle(""), "");
  assert.equal(normalizeTitle(null), null);
});

test("sameText ignora maiuscole e minuscole", () => {
  assert.ok(sameText("RATE FINANZIAMENTI", "Rate finanziamenti"));
  assert.ok(!sameText("Spesa", "Spese auto"));
  assert.ok(sameText(null, ""));
});

test("escapeHtml neutralizza il markup", () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="alert('x')">`),
    "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;"
  );
  assert.equal(escapeHtml(undefined), "");
});
