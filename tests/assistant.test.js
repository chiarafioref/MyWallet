import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { state } from "../assets/js/store.js";
import { interpret } from "../assets/js/assistant/interpreter.js";
import { ask } from "../assets/js/assistant/engine.js";
import { dateISO } from "../assets/js/utils.js";

// Lo stub della Edge Function fallisce sempre: l'assistente segnala il ripiego con console.warn.
const originalWarn = console.warn;
before(() => {
  console.warn = () => {};
});
after(() => {
  console.warn = originalWarn;
});

const day = (d) => dateISO(new Date(new Date().getFullYear(), new Date().getMonth(), d));

beforeEach(() => {
  state.categories = ["Spesa", "Ristoranti", "Bar", "Shopping", "Altro"].map((name, i) => ({
    id: `e${i}`,
    name,
    kind: "expense",
  }));
  state.categories.push({ id: "i0", name: "Stipendio", kind: "income" });
  state.transactions = [
    { id: "1", type: "USCITA", amount: "120", category_name: "Ristoranti", tx_date: day(2), title: "Cena" },
    { id: "2", type: "USCITA", amount: "80", category_name: "Shopping", tx_date: day(3), title: "Scarpe" },
    { id: "3", type: "USCITA", amount: "300", category_name: "Spesa", tx_date: day(4), title: "Supermercato" },
    { id: "4", type: "ENTRATA", amount: "1800", category_name: "Stipendio", tx_date: day(1), title: "Stipendio" },
  ];
  state.subscriptions = [];
  state.budgets = [];
  state.goals = [];
  state.futureExpenses = [];
  state.trips = [];
});

test("un sinonimo restituisce il nome reale della categoria", async () => {
  const spec = await interpret("quanto ho speso al ristorante questo mese?");
  assert.deepEqual(spec.categories, ["Ristoranti"]);
  assert.equal(spec.source, "local");
});

test('"spesa" da sola non viene letta come categoria', async () => {
  const spec = await interpret("qual è la mia spesa più alta?");
  assert.deepEqual(spec.categories, []);
  assert.equal(spec.aggregate, "max");
});

test("le categorie di entrata impostano il tipo ENTRATA", async () => {
  const spec = await interpret("quanto ho preso di stipendio quest'anno?");
  assert.deepEqual(spec.categories, ["Stipendio"]);
  assert.equal(spec.type, "ENTRATA");
});

test("una domanda su una rata resta una verifica di sostenibilità", async () => {
  const spec = await interpret("posso permettermi una rata di 70€ al mese?");
  assert.equal(spec.intent, "affordability");
  assert.equal(spec.affordMonthly, 70);
});

test("il piano di risparmio individua le categorie comprimibili", async () => {
  const result = await ask("come posso risparmiare 50 euro al mese?");
  assert.equal(result.title, "Piano di risparmio");
  assert.match(result.answer, /Ristoranti/);
  assert.match(result.answer, /Shopping/);
});
