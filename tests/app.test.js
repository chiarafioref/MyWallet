// Test d'integrazione del bootstrap (app.js) in un DOM simulato con jsdom.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM(`<!doctype html><html><body><div id="app"></div></body></html>`, {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const { window } = dom;
for (const key of [
  "window",
  "document",
  "location",
  "localStorage",
  "Event",
  "KeyboardEvent",
  "requestAnimationFrame",
]) {
  Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
}

// renderRoute() chiama window.scrollTo una volta per ogni rendering della vista.
let renders = 0;
window.scrollTo = () => renders++;
window.HTMLElement.prototype.scrollTo = () => {};

const flush = () => new Promise((r) => setTimeout(r, 30));
// Nel browser il target di un tasto è l'elemento attivo, di default <body>.
const pressKey = (key) => document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));

let authMock;
let touch;
before(async () => {
  ({ authMock } = await import("./helpers/supabase-stub.js"));
  ({ touch } = await import("../assets/js/store.js"));
  await import("../assets/js/app.js");
  await flush();
});
after(() => window.close());

const user = { user: { id: "u1", email: "test@example.com" } };

test("senza sessione viene mostrata la schermata di accesso", () => {
  assert.ok(document.querySelector(".auth-screen"));
});

test("dopo il login l'app viene disegnata", async () => {
  authMock.emit(user);
  await flush();
  assert.ok(document.querySelector("#route-outlet"));
  assert.equal(document.querySelector(".auth-screen"), null);
});

test("dopo logout e nuovo login ogni evento produce un solo rendering", async () => {
  authMock.emit(null);
  await flush();
  assert.ok(document.querySelector(".auth-screen"));

  authMock.emit(user);
  await flush();
  document.querySelector("#onboarding-overlay")?.remove();

  renders = 0;
  pressKey("2");
  assert.equal(location.hash, "#transazioni");
  assert.equal(renders, 1, "la scorciatoia da tastiera non deve essere gestita due volte");

  renders = 0;
  touch();
  assert.equal(renders, 1, "un cambio di stato non deve ridisegnare la vista due volte");
});

test("le scorciatoie sono ignorate mentre si scrive in un campo", () => {
  const input = document.createElement("input");
  document.body.append(input);
  renders = 0;
  input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "3", bubbles: true }));
  assert.equal(renders, 0);
  input.remove();
});

test('"Prova la demo" carica i dati di esempio e mostra il banner', async () => {
  authMock.emit(null);
  await flush();
  authMock.rpcCalls.length = 0;

  document.querySelector("#auth-demo-btn").click();
  await flush();

  assert.deepEqual(authMock.rpcCalls, ["start_demo"]);
  assert.match(document.querySelector(".demo-banner").textContent, /30 minuti/);

  pressKey("1");
  assert.ok(document.querySelector("#route-outlet .demo-banner"), "il banner resta dopo il cambio di vista");
});

test("nell'account demo mancano cambio password ed eliminazione account, e l'AI è spenta", async () => {
  const { aiEnabled } = await import("../assets/js/assistant/ai-client.js");
  assert.equal(aiEnabled(), false);

  location.hash = "impostazioni";
  await flush();
  const text = document.querySelector("#route-outlet").textContent;
  assert.doesNotMatch(text, /Aggiorna password/);
  assert.doesNotMatch(text, /Elimina account/);
  assert.match(text, /Esci dalla demo/);

  // Il logout ferma il timer del banner.
  authMock.emit(null);
  await flush();
  assert.equal(document.querySelector(".demo-banner"), null);
});
