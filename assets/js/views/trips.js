// "In viaggio" section: shared group wallets (split-the-bill style).
//  - trip cards with participant avatars and total spent
//  - trip sheet: total, per-head quota, live group balance, expenses by
//    category (chart), payer ranking, movements
//  - every expense records "paid by" for a correct reimbursement count
import { state } from "../store.js";
import { trips as tripApi } from "../data.js";
import { buildForm } from "../form.js";
import { supabaseClient } from "../supabaseClient.js";
import {
  el, qs, formatMoney, formatDate, todayISO, toast, openModal, closeModal, emptyState, animateCounter,
} from "../utils.js";
import { icon, iconEl } from "../icons.js";
import { donutChart, catColor, PALETTE } from "../chart.js";

const TRIP_CATEGORIES = [
  "ALLOGGIO", "CIBO E RISTORANTI", "TRASPORTI", "CARBURANTE",
  "PARCHEGGI E PEDAGGI", "ATTIVITÀ", "MUSEI", "ALTRO",
];

let tripChannel = null;
const totalsCache = new Map(); // trip.id -> { total, count }

function hashIdx(str, mod) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) h = (h * 31 + String(str).charCodeAt(i)) >>> 0;
  return h % mod;
}

function avatar(name, id, size = 30) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return el("span", {
    class: "trip-avatar",
    style: `--c:${PALETTE[hashIdx(id || name, PALETTE.length)]}; --sz:${size}px`,
    title: name || "",
    text: initial,
  });
}

function payerOf(e) {
  return e.paid_by || e.created_by;
}

// Reduce the balances to a minimal set of "X -> Y" transfers.
function simplifyDebts(balances) {
  const creditors = balances.filter((b) => b.balance > 0.005).map((b) => ({ name: b.name, amount: b.balance })).sort((a, b) => b.amount - a.amount);
  const debtors = balances.filter((b) => b.balance < -0.005).map((b) => ({ name: b.name, amount: -b.balance })).sort((a, b) => b.amount - a.amount);
  const out = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amt = Math.min(debtors[i].amount, creditors[j].amount);
    out.push({ from: debtors[i].name, to: creditors[j].name, amount: amt });
    debtors[i].amount -= amt;
    creditors[j].amount -= amt;
    if (debtors[i].amount < 0.005) i++;
    if (creditors[j].amount < 0.005) j++;
  }
  return out;
}

export function render(container) {
  container.innerHTML = "";
  const view = el("div", { class: "view view--trips" }, [
    el("header", { class: "view-head" }, [
      el("div", {}, [
        el("h2", { text: "In viaggio" }),
        el("p", { class: "muted", text: "Portafogli condivisi: registra le spese di gruppo e dividi i conti" }),
      ]),
      el("div", { class: "view-head__actions" }, [
        el("button", { class: "btn btn--ghost", onclick: joinModal }, [iconEl("key", { size: 18 }), "Unisciti"]),
        el("button", { class: "btn btn--primary", onclick: createModal }, [iconEl("plus", { size: 18 }), "Nuovo viaggio"]),
      ]),
    ]),
    state.trips.length
      ? el("div", { class: "trip-grid" }, state.trips.map(tripCard))
      : tripsEmpty(),
  ]);
  container.append(view);

  if (state.trips.length) refreshTotals(state.trips);
}

function tripsEmpty() {
  return el("section", { class: "card glass trip-empty" }, [
    el("span", { class: "trip-empty__icon", html: icon("plane", { size: 30 }) }),
    el("h3", { text: "Organizza le spese del prossimo viaggio" }),
    el("p", { class: "muted", text: "Crea un portafoglio di gruppo, condividi la chiave con i compagni di viaggio e registrate insieme ogni spesa. A fine viaggio l'app calcola chi deve dare quanto a chi." }),
    el("div", { class: "trip-empty__actions" }, [
      el("button", { class: "btn btn--primary", onclick: createModal }, [iconEl("plus", { size: 18 }), "Nuovo viaggio"]),
      el("button", { class: "btn btn--ghost", onclick: joinModal }, [iconEl("key", { size: 18 }), "Ho una chiave"]),
    ]),
  ]);
}

function tripCard(trip, k) {
  const members = trip.trip_members || [];
  const mine = trip.owner_id === state.user.id;
  const active = trip.status === "ATTIVO";
  const cached = totalsCache.get(trip.id);

  return el("div", { class: `card glass trip-card${active ? "" : " trip-card--ended"}`, style: `--i:${k}` }, [
    el("div", { class: "trip-card__top" }, [
      el("div", { class: "trip-card__title" }, [
        el("strong", { text: trip.name }),
        el("span", { class: "muted", text: mine ? "Creato da te" : "Condiviso con te" }),
      ]),
      el("span", { class: `badge badge--${active ? "ok" : "muted"}`, text: active ? "In corso" : "Concluso" }),
    ]),

    el("div", { class: "trip-card__people" }, [
      el("div", { class: "trip-avatars" },
        members.slice(0, 5).map((m) => avatar(m.display_name, m.user_id, 28))
          .concat(members.length > 5 ? [el("span", { class: "trip-avatar trip-avatar--more", style: "--sz:28px", text: `+${members.length - 5}` })] : [])
      ),
      el("span", { class: "muted", text: `${members.length} partecipant${members.length === 1 ? "e" : "i"}` }),
    ]),

    el("div", { class: "trip-card__stat", id: `trip-stat-${trip.id}` },
      cached ? statInner(cached) : [el("span", { class: "trip-card__stat-load muted", text: "Calcolo spese…" })]
    ),

    el("div", { class: "trip-card__key" }, [
      el("span", { class: "trip-card__key-label muted", text: "Chiave" }),
      el("code", { text: trip.join_key }),
      el("button", {
        class: "icon-btn", title: "Copia chiave", "aria-label": "Copia chiave", html: icon("copy", { size: 15 }),
        onclick: () => { navigator.clipboard?.writeText(trip.join_key); toast("Chiave copiata", "success"); },
      }),
    ]),

    el("div", { class: "trip-card__actions" }, [
      el("button", { class: "btn btn--primary btn--sm", onclick: () => openTrip(trip) }, "Apri portafoglio"),
      mine ? el("button", { class: "btn btn--ghost btn--sm", onclick: () => toggleStatus(trip) }, active ? "Concludi" : "Riapri") : null,
      mine ? el("button", { class: "icon-btn icon-btn--danger", html: icon("trash", { size: 16 }), title: "Elimina", "aria-label": "Elimina", onclick: () => removeTrip(trip) }) : null,
    ].filter(Boolean)),
  ]);
}

function statInner({ total, count }) {
  return [
    el("span", { class: "trip-card__stat-v", text: formatMoney(total) }),
    el("span", { class: "trip-card__stat-l muted", text: count ? `${count} spes${count === 1 ? "a" : "e"} registrate` : "Ancora nessuna spesa" }),
  ];
}

async function refreshTotals(trips) {
  await Promise.all(trips.map(async (t) => {
    try {
      const exps = await tripApi.listExpenses(t.id);
      const total = exps.reduce((s, e) => s + (e.type === "ENTRATA" ? -e.amount : +e.amount), 0);
      totalsCache.set(t.id, { total, count: exps.length });
      const node = qs(`#trip-stat-${t.id}`);
      if (node) { node.innerHTML = ""; node.append(...statInner({ total, count: exps.length })); }
    } catch { /* silent */ }
  }));
}

function createModal() {
  const body = buildForm([{ name: "name", label: "Nome del viaggio", required: true, placeholder: "Es. Weekend a Barcellona" }], {
    submitLabel: "Crea viaggio",
    onSubmit: async (v) => {
      try {
        const trip = await tripApi.create(v.name);
        closeModal();
        toast(`Viaggio creato · chiave ${trip.join_key}`, "success");
      } catch (err) {
        toast(err.message, "error");
      }
    },
  });
  openModal({ title: "Nuovo viaggio", body });
}

function joinModal() {
  const body = buildForm([{ name: "key", label: "Chiave del viaggio", required: true, placeholder: "Es. A1B2C3D4", hint: "Fattela dare da chi ha creato il viaggio" }], {
    submitLabel: "Unisciti",
    onSubmit: async (v) => {
      try {
        await tripApi.join(v.key.trim().toUpperCase());
        closeModal();
        toast("Ti sei unito al viaggio", "success");
      } catch (err) {
        toast(err.message, "error");
      }
    },
  });
  openModal({ title: "Unisciti a un viaggio", body });
}

async function openTrip(trip) {
  const wrap = el("div", { class: "trip-sheet" }, [el("p", { class: "muted", text: "Caricamento…" })]);
  openModal({ title: trip.name, body: wrap, onClose: () => stopTripRealtime() });

  const [expenses, members, customCats] = await Promise.all([
    tripApi.listExpenses(trip.id),
    tripApi.members(trip.id),
    tripApi.listCategories(trip.id),
  ]);

  const categories = () => [...TRIP_CATEGORIES, ...customCats.map((c) => c.name)];
  const nameOf = (id) => members.find((m) => m.user_id === id)?.display_name || "—";

  let current = expenses;

  const draw = (exps) => {
    const active = trip.status === "ATTIVO";
    const total = exps.reduce((s, e) => s + (e.type === "ENTRATA" ? -e.amount : +e.amount), 0);
    const perHead = members.length ? total / members.length : 0;

    const paid = {};
    const byCat = {};
    for (const e of exps) {
      if (e.type !== "USCITA") continue;
      paid[payerOf(e)] = (paid[payerOf(e)] || 0) + +e.amount;
      byCat[e.category_name || "ALTRO"] = (byCat[e.category_name || "ALTRO"] || 0) + +e.amount;
    }
    const settlement = members
      .map((m) => ({ name: m.display_name, id: m.user_id, paid: paid[m.user_id] || 0, balance: (paid[m.user_id] || 0) - perHead }))
      .sort((a, b) => b.paid - a.paid);
    const transfers = simplifyDebts(settlement);
    const myBalance = (paid[state.user.id] || 0) - perHead;
    const byCatEntries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const maxPaid = Math.max(1, ...settlement.map((s) => s.paid));

    wrap.innerHTML = "";
    wrap.append(...[
      // hero
      el("div", { class: "trip-sheet__hero" }, [
        el("div", { class: "trip-sheet__hero-glow" }),
        el("span", { class: "trip-sheet__hero-label" }, [
          el("span", { class: `badge badge--${active ? "ok" : "muted"}`, text: active ? "In corso" : "Concluso" }),
          "Spesa totale del gruppo",
        ]),
        el("strong", { class: "trip-sheet__hero-value", "data-counter": total, "data-value": 0, text: formatMoney(0) }),
        el("div", { class: "trip-sheet__hero-meta" }, [
          `${exps.length} spese`,
          el("span", { class: "dot-sep" }),
          `${members.length} persone`,
          el("span", { class: "dot-sep" }),
          `${formatMoney(perHead)} a testa`,
        ]),
      ]),

      // my balance
      el("div", { class: `trip-sheet__me trip-sheet__me--${myBalance >= -0.005 ? "in" : "out"}` }, [
        el("span", { class: "icn-wrap", html: icon(myBalance >= -0.005 ? "trendingUp" : "trendingDown", { size: 15 }) }),
        el("span", {}, [
          `Hai pagato ${formatMoney(paid[state.user.id] || 0)} · il tuo saldo è `,
          el("strong", { text: myBalance >= -0.005 ? `+${formatMoney(myBalance)}` : `−${formatMoney(-myBalance)}` }),
        ]),
      ]),

      active
        ? el("div", { class: "trip-sheet__actions" }, [
            el("button", { class: "btn btn--primary", onclick: () => addExpenseModal(trip, categories(), members, () => refresh()) }, [iconEl("plus", { size: 18 }), "Aggiungi spesa"]),
            el("button", { class: "btn btn--ghost", onclick: addCategory }, [iconEl("plus", { size: 18 }), "Categoria"]),
          ])
        : el("p", { class: "trip-sheet__ended muted", text: "Viaggio concluso: le spese non sono più modificabili, ma il resoconto resta consultabile." }),

      // group balance
      members.length > 1
        ? el("section", { class: "trip-block" }, [
            el("h4", {}, [el("span", { class: "icn-wrap", html: icon("users", { size: 15 }) }), active ? "Bilancio provvisorio" : "Chi deve dare a chi"]),
            transfers.length
              ? el("ul", { class: "trip-settle" }, transfers.map((t) =>
                  el("li", {}, [
                    avatar(t.from, t.from, 26),
                    el("span", { class: "trip-settle__names" }, [el("strong", { text: t.from }), " → ", el("strong", { text: t.to })]),
                    avatar(t.to, t.to, 26),
                    el("span", { class: "trip-settle__amt", text: formatMoney(t.amount) }),
                  ])
                ))
              : el("p", { class: "muted", text: "Conti in pari, nessun rimborso necessario." }),
          ])
        : null,

      // expenses by category
      byCatEntries.length
        ? el("section", { class: "trip-block" }, [
            el("h4", {}, [el("span", { class: "icn-wrap", html: icon("chart", { size: 15 }) }), "Dove sono andati i soldi"]),
            el("div", { class: "trip-dist" }, [
              donutChart(byCatEntries, { showLegend: false, size: 150, centerLabel: "spesa totale" }),
              el("ul", { class: "trip-catlist" }, byCatEntries.slice(0, 8).map(([name, v], idx) =>
                el("li", {}, [
                  el("span", { class: "trip-catlist__dot", style: `background:${catColor(idx)}` }),
                  el("span", { class: "trip-catlist__name", text: name }),
                  el("strong", { text: formatMoney(v) }),
                ])
              )),
            ]),
          ])
        : null,

      // payer ranking
      members.length > 1 && total > 0
        ? el("section", { class: "trip-block" }, [
            el("h4", {}, [el("span", { class: "icn-wrap", html: icon("trophy", { size: 15 }) }), "Chi ha anticipato di più"]),
            el("ul", { class: "trip-payers" }, settlement.map((s) =>
              el("li", {}, [
                avatar(s.name, s.id, 30),
                el("div", { class: "trip-payers__body" }, [
                  el("div", { class: "trip-payers__row" }, [
                    el("strong", { text: s.name }),
                    el("span", { text: formatMoney(s.paid) }),
                  ]),
                  el("span", { class: "trip-payers__bar" }, [
                    el("span", { class: "trip-payers__fill", style: `--w:${(s.paid / maxPaid) * 100}%` }),
                  ]),
                ]),
              ])
            )),
          ])
        : null,

      // movements
      el("section", { class: "trip-block" }, [
        el("h4", {}, [el("span", { class: "icn-wrap", html: icon("receipt", { size: 15 }) }), `Movimenti (${exps.length})`]),
        exps.length
          ? el("ul", { class: "trip-exp-list" }, exps.map((e) => {
              const canDelete = active && payerOf(e) === state.user.id;
              return el("li", { class: "trip-exp" }, [
                avatar(nameOf(payerOf(e)), payerOf(e), 32),
                el("div", { class: "trip-exp__body" }, [
                  el("strong", { text: e.title }),
                  el("span", { class: "muted", text: `${e.category_name} · ${formatDate(e.expense_date)} · ${nameOf(payerOf(e))}` }),
                ]),
                el("span", { class: `tx-amount tx-amount--${e.type === "ENTRATA" ? "in" : "out"}`, text: formatMoney(e.type === "ENTRATA" ? +e.amount : -e.amount, { sign: true }) }),
                canDelete
                  ? el("button", { class: "icon-btn icon-btn--danger", html: icon("trash", { size: 15 }), "aria-label": "Elimina", onclick: () => tripApi.removeExpense(e.id) })
                  : null,
              ].filter(Boolean));
            }))
          : emptyState("receipt", "Nessuna spesa registrata"),
      ]),
    ].filter(Boolean));

    wrap.querySelectorAll("[data-counter]").forEach((n) => animateCounter(n, Number(n.dataset.counter)));
  };

  const refresh = async () => {
    current = await tripApi.listExpenses(trip.id);
    totalsCache.set(trip.id, {
      total: current.reduce((s, e) => s + (e.type === "ENTRATA" ? -e.amount : +e.amount), 0),
      count: current.length,
    });
    draw(current);
  };

  const addCategory = () => {
    const body = buildForm([{ name: "name", label: "Nome categoria", required: true }], {
      submitLabel: "Aggiungi",
      onSubmit: async (v) => {
        try {
          const c = await tripApi.addCategory(trip.id, v.name.toUpperCase());
          customCats.push(c);
          closeModal();
          toast("Categoria aggiunta", "success");
          draw(current);
        } catch (err) {
          toast(err.message, "error");
        }
      },
    });
    openModal({ title: "Nuova categoria di viaggio", body });
  };

  draw(current);

  stopTripRealtime();
  tripChannel = supabaseClient
    .channel(`trip-${trip.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "trip_expenses", filter: `trip_id=eq.${trip.id}` }, refresh)
    .subscribe();
}

function stopTripRealtime() {
  if (tripChannel) {
    supabaseClient.removeChannel(tripChannel);
    tripChannel = null;
  }
}

function addExpenseModal(trip, categoryList, members, done) {
  const body = buildForm(
    [
      { name: "title", label: "Titolo", required: true, placeholder: "Es. Cena al ristorante" },
      { name: "amount", label: "Importo (€)", type: "number", step: "0.01", min: "0.01", required: true },
      { name: "paid_by", label: "Pagato da", type: "select", value: state.user.id, options: members.map((m) => ({ value: m.user_id, label: m.display_name })) },
      { name: "category_name", label: "Categoria", type: "select", value: "ALTRO", options: categoryList.map((c) => ({ value: c, label: c })) },
      { name: "type", label: "Tipo", type: "select", value: "USCITA", options: [
        { value: "USCITA", label: "Spesa" }, { value: "ENTRATA", label: "Rimborso" },
      ]},
      { name: "expense_date", label: "Data", type: "date", value: todayISO(), required: true },
      { name: "description", label: "Descrizione (facoltativa)", type: "textarea" },
    ],
    {
      submitLabel: "Aggiungi spesa",
      onSubmit: async (v) => {
        try {
          await tripApi.addExpense({
            trip_id: trip.id,
            title: v.title,
            amount: v.amount,
            paid_by: v.paid_by || state.user.id,
            category_name: v.category_name,
            type: v.type,
            expense_date: v.expense_date,
            description: v.description || null,
          });
          closeModal();
          toast("Spesa aggiunta", "success");
          done?.();
        } catch (err) {
          toast(err.message, "error");
        }
      },
    }
  );
  openModal({ title: "Nuova spesa di viaggio", body });
}

async function toggleStatus(trip) {
  const next = trip.status === "ATTIVO" ? "TERMINATO" : "ATTIVO";
  if (!confirm(next === "TERMINATO" ? `Concludere il viaggio "${trip.name}"? Potrai comunque consultare il resoconto.` : `Riaprire il viaggio "${trip.name}"?`)) return;
  try {
    await tripApi.setStatus(trip.id, next);
    toast(next === "TERMINATO" ? "Viaggio concluso" : "Viaggio riaperto", "success");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function removeTrip(trip) {
  if (!confirm(`Eliminare il viaggio "${trip.name}"? L'operazione non è reversibile.`)) return;
  try {
    await tripApi.remove(trip.id);
    toast("Viaggio eliminato", "success");
  } catch (err) {
    toast(err.message, "error");
  }
}
