// Transactions: list, search/filters, CRUD.
import { state, selectors, touch } from "../store.js";
import { transactions as txApi, transfers as transferApi } from "../data.js";
import { buildForm } from "../form.js";
import { enhanceSelect } from "../select.js";
import {
  el, qs, formatMoney, formatDate, todayISO, toast, openModal, closeModal,
  emptyState, debounce,
} from "../utils.js";
import { icon, iconEl } from "../icons.js";

const filters = { q: "", type: "", category: "", from: "", to: "", method: "", amountMin: "", amountMax: "" };
const EMPTY = { q: "", type: "", category: "", from: "", to: "", method: "", amountMin: "", amountMax: "" };
let advancedOpen = false;

export function render(container) {
  container.innerHTML = "";
  const view = el("div", { class: "view view--tx" }, [
    el("header", { class: "view-head" }, [
      el("div", {}, [
        el("h2", { text: "Transazioni" }),
        el("p", { class: "muted", text: "Entrate, uscite e trasferimenti tra i metodi di pagamento" }),
      ]),
      el("div", { class: "view-head__actions" }, [
        el("button", { class: "btn btn--primary", onclick: () => openTxModal() }, [iconEl("plus", { size: 18 }), "Nuova transazione"]),
        el("button", { class: "btn btn--ghost", onclick: () => openTransferModal() }, [iconEl("swap", { size: 17 }), "Trasferimento"]),
      ]),
    ]),
    renderFilters(container),
    el("div", { id: "tx-list" }),
  ]);
  container.append(view);
  renderList();
}

// Filter bar: search + type + collapsible advanced panel.
const TYPE_OPTS = [
  ["", "Tutti"],
  ["ENTRATA", "Entrate"],
  ["USCITA", "Uscite"],
];
const ADV_KEYS = ["category", "method", "from", "to", "amountMin", "amountMax"];
const ADV_LABEL = {
  category: "Categoria", method: "Metodo", from: "Dal", to: "Al",
  amountMin: "Importo min.", amountMax: "Importo max.",
};

function renderFilters(container) {
  const cats = [...selectors.expenseCategories(), ...selectors.incomeCategories()];

  const seg = el(
    "div",
    { class: "tx-seg", "data-idx": String(TYPE_OPTS.findIndex((o) => o[0] === filters.type)) },
    TYPE_OPTS.map(([value, label]) =>
      el("button", {
        type: "button",
        class: `tx-seg__btn${value === filters.type ? " is-active" : ""}`,
        "data-val": value,
        onclick: () => {
          filters.type = value;
          [...seg.children].forEach((b) => b.classList.toggle("is-active", b.dataset.val === value));
          seg.dataset.idx = String(TYPE_OPTS.findIndex((o) => o[0] === value));
          renderList();
          syncChips();
        },
      }, label)
    )
  );

  const moreBtn = el("button", {
    type: "button",
    class: `tx-more${advancedOpen ? " is-open" : ""}`,
    onclick: () => {
      advancedOpen = !advancedOpen;
      moreBtn.classList.toggle("is-open", advancedOpen);
      qs("#tx-advanced")?.classList.toggle("is-open", advancedOpen);
    },
  }, [
    el("span", { class: "icn-wrap", html: icon("filter", { size: 15 }) }),
    el("span", { text: "Filtri" }),
    el("span", { class: "tx-more__badge", id: "tx-fcount" }),
    el("span", { class: "tx-more__chev icn-wrap", html: icon("chevronDown", { size: 14 }) }),
  ]);

  const advField = (key, control) =>
    el("label", { class: "tx-adv__field" }, [el("span", { text: ADV_LABEL[key] }), control]);

  const advanced = el("div", { class: `tx-advanced${advancedOpen ? " is-open" : ""}`, id: "tx-advanced" }, [
    el("div", { class: "tx-advanced__inner" }, [
      el("div", { class: "tx-adv__grid" }, [
        advField("category", selectCtl("category", [
          { value: "", label: "Tutte le categorie" },
          ...cats.map((c) => ({ value: c.name, label: c.name })),
        ])),
        advField("method", selectCtl("method", [
          { value: "", label: "Tutti i metodi" },
          { value: "CARTA", label: "Carta" },
          { value: "CONTANTI", label: "Contanti" },
        ])),
        advField("from", dateCtl("from")),
        advField("to", dateCtl("to")),
        advField("amountMin", amountCtl("amountMin")),
        advField("amountMax", amountCtl("amountMax")),
      ]),
      el("button", {
        type: "button", class: "btn btn--ghost btn--sm tx-reset",
        onclick: () => {
          Object.assign(filters, EMPTY);
          render(container);
        },
      }, "Azzera tutti i filtri"),
    ]),
  ]);

  return el("section", { class: "tx-filters card glass fade-in" }, [
    el("div", { class: "tx-toolbar" }, [
      el("div", { class: "tx-search" }, [
        el("span", { class: "icn-wrap", html: icon("search", { size: 16 }) }),
        el("input", {
          type: "search", placeholder: "Cerca per titolo o descrizione…", value: filters.q,
          oninput: debounce((e) => { filters.q = e.target.value.toLowerCase(); renderList(); syncChips(); }, 200),
        }),
      ]),
      seg,
      moreBtn,
    ]),
    el("div", { class: "tx-chips", id: "tx-chips" }),
    advanced,
  ]);
}

function selectCtl(key, options) {
  const sel = el(
    "select",
    { onchange: (e) => { filters[key] = e.target.value; renderList(); syncChips(); } },
    options.map((o) => el("option", { value: o.value, selected: o.value === filters[key] || null }, o.label))
  );
  requestAnimationFrame(() => enhanceSelect(sel));
  return sel;
}
function dateCtl(key) {
  return el("input", {
    type: "date", value: filters[key],
    onchange: (e) => { filters[key] = e.target.value; renderList(); syncChips(); },
  });
}
function amountCtl(key) {
  return el("input", {
    type: "number", step: "0.01", min: "0", inputmode: "decimal", placeholder: "€", value: filters[key],
    oninput: debounce((e) => { filters[key] = e.target.value; renderList(); syncChips(); }, 250),
  });
}

function chipText(key) {
  const v = filters[key];
  if (key === "from") return `Dal ${formatDate(v)}`;
  if (key === "to") return `Al ${formatDate(v)}`;
  if (key === "amountMin") return `≥ ${formatMoney(Number(v))}`;
  if (key === "amountMax") return `≤ ${formatMoney(Number(v))}`;
  if (key === "method") return v === "CARTA" ? "Carta" : "Contanti";
  return v;
}

function syncChips() {
  const holder = qs("#tx-chips");
  const badge = qs("#tx-fcount");
  if (!holder) return;
  const active = ADV_KEYS.filter((k) => filters[k] !== "");
  if (badge) {
    badge.textContent = active.length ? String(active.length) : "";
    badge.classList.toggle("is-visible", active.length > 0);
  }
  holder.innerHTML = "";
  holder.classList.toggle("is-empty", active.length === 0);
  active.forEach((k) => {
    holder.append(
      el("button", {
        type: "button", class: "tx-chip",
        onclick: () => { filters[k] = ""; syncAdvancedInputs(); renderList(); syncChips(); },
      }, [
        el("span", { text: chipText(k) }),
        el("span", { class: "icn-wrap", html: icon("close", { size: 12 }) }),
      ])
    );
  });
}

// Re-sync the advanced panel inputs with `filters` (after a chip is removed).
function syncAdvancedInputs() {
  const adv = qs("#tx-advanced");
  if (!adv) return;
  adv.querySelectorAll(".tx-adv__field").forEach((f, i) => {
    const key = ADV_KEYS[i];
    const ctl = f.querySelector("select, input");
    if (ctl) { ctl.value = filters[key]; ctl.dispatchEvent(new Event("sel:sync")); }
  });
}

function applyFilters(list) {
  const min = filters.amountMin === "" ? null : Number(filters.amountMin);
  const max = filters.amountMax === "" ? null : Number(filters.amountMax);
  return list.filter((t) => {
    if (filters.q) {
      const hay = `${t.title} ${t.description || ""}`.toLowerCase();
      if (!hay.includes(filters.q)) return false;
    }
    if (filters.type && t.type !== filters.type) return false;
    if (filters.category && (t.category_name || "") !== filters.category) return false;
    if (filters.method && t.payment_method !== filters.method) return false;
    if (filters.from && t.tx_date < filters.from) return false;
    if (filters.to && t.tx_date > filters.to) return false;
    if (min !== null && +t.amount < min) return false;
    if (max !== null && +t.amount > max) return false;
    return true;
  });
}

const methodLabel = (m) => (m === "CONTANTI" ? "Contanti" : "Carta");

function filteredTransfers() {
  // Transfers are neither income/expense nor do they have a category.
  if (filters.type || filters.category) return [];
  const min = filters.amountMin === "" ? null : Number(filters.amountMin);
  const max = filters.amountMax === "" ? null : Number(filters.amountMax);
  return state.transfers.filter((tr) => {
    if (filters.q) {
      const hay = `trasferimento ${tr.note || ""} ${methodLabel(tr.from_method)} ${methodLabel(tr.to_method)}`.toLowerCase();
      if (!hay.includes(filters.q)) return false;
    }
    if (filters.method && tr.from_method !== filters.method && tr.to_method !== filters.method) return false;
    if (filters.from && tr.transfer_date < filters.from) return false;
    if (filters.to && tr.transfer_date > filters.to) return false;
    if (min !== null && +tr.amount < min) return false;
    if (max !== null && +tr.amount > max) return false;
    return true;
  });
}

function txRowEl(t, k) {
  const tag = t.subscription_id
    ? "abbonamento"
    : t.is_recurring
      ? (t.recurring_end ? `ricorrente · fino al ${formatDate(t.recurring_end)}` : "ricorrente")
      : t.recurring_parent_id ? "ricorrente" : "";
  return el("li", { class: "tx-row card", style: `--i:${Math.min(k, 14)}` }, [
    el("div", { class: `tx-row__icon tx-row__icon--${t.type === "ENTRATA" ? "in" : "out"}`, html: icon(t.type === "ENTRATA" ? "arrowUp" : "arrowDown", { size: 18 }) }),
    el("div", { class: "tx-row__main" }, [
      el("span", { class: "tx-row__title" }, [
        el("strong", { text: t.title }),
        tag ? el("span", { class: "tx-row__tag", title: tag }, [el("span", { class: "icn-wrap", html: icon("repeat", { size: 11 }) })]) : null,
      ]),
      el("span", { class: "tx-row__meta muted" }, [
        el("span", { class: "tx-row__meta-t", text: `${t.category_name || "—"} · ${formatDate(t.tx_date)}` }),
        el("span", {
          class: "icn-wrap tx-row__pay",
          title: t.payment_method === "CARTA" ? "Carta" : "Contanti",
          html: icon(t.payment_method === "CARTA" ? "creditCard" : "banknote", { size: 13 }),
        }),
      ]),
      t.description ? el("span", { class: "tx-row__desc muted", text: t.description }) : null,
    ]),
    el("span", {
      class: `tx-amount tx-amount--${t.type === "ENTRATA" ? "in" : "out"}`,
      text: formatMoney(t.type === "ENTRATA" ? +t.amount : -t.amount, { sign: true }),
    }),
    el("div", { class: "tx-row__actions" }, [
      el("button", { class: "icon-btn", title: "Modifica", "aria-label": "Modifica", html: icon("pencil", { size: 16 }), onclick: () => openTxModal(t) }),
      el("button", { class: "icon-btn icon-btn--danger", title: "Elimina", "aria-label": "Elimina", html: icon("trash", { size: 16 }), onclick: () => removeTx(t) }),
    ]),
  ]);
}

function trRowEl(tr, k) {
  return el("li", { class: "tx-row tx-row--transfer card", style: `--i:${Math.min(k, 14)}` }, [
    el("div", { class: "tx-row__icon tx-row__icon--transfer", html: icon("swap", { size: 18 }) }),
    el("div", { class: "tx-row__main" }, [
      el("span", { class: "tx-row__title" }, [el("strong", { text: "Trasferimento" })]),
      el("span", { class: "tx-row__meta muted" }, [
        el("span", { class: "tx-row__meta-t", text: `${methodLabel(tr.from_method)} → ${methodLabel(tr.to_method)} · ${formatDate(tr.transfer_date)}` }),
      ]),
      tr.note ? el("span", { class: "tx-row__desc muted", text: tr.note }) : null,
    ]),
    el("span", { class: "tx-amount tx-amount--transfer", text: formatMoney(+tr.amount) }),
    el("div", { class: "tx-row__actions" }, [
      el("button", { class: "icon-btn", title: "Modifica", "aria-label": "Modifica", html: icon("pencil", { size: 16 }), onclick: () => openTransferModal(tr) }),
      el("button", { class: "icon-btn icon-btn--danger", title: "Elimina", "aria-label": "Elimina", html: icon("trash", { size: 16 }), onclick: () => removeTransfer(tr) }),
    ]),
  ]);
}

function renderList() {
  const holder = qs("#tx-list");
  if (!holder) return;
  syncChips();
  const txRows = applyFilters(state.transactions);
  const trRows = filteredTransfers();
  holder.innerHTML = "";

  if (!txRows.length && !trRows.length) {
    const anything = state.transactions.length || state.transfers.length;
    holder.append(emptyState("search", anything ? "Nessun movimento corrisponde ai filtri" : "Ancora nessuna transazione"));
    return;
  }

  const merged = [
    ...txRows.map((t) => ({ kind: "tx", d: t, date: t.tx_date })),
    ...trRows.map((t) => ({ kind: "tr", d: t, date: t.transfer_date })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const income = txRows.filter((t) => t.type === "ENTRATA").reduce((s, t) => s + +t.amount, 0);
  const expense = txRows.filter((t) => t.type === "USCITA").reduce((s, t) => s + +t.amount, 0);
  const countText = `${txRows.length} ${txRows.length === 1 ? "transazione" : "transazioni"}` +
    (trRows.length ? ` · ${trRows.length} trasferiment${trRows.length === 1 ? "o" : "i"}` : "");
  holder.append(
    el("div", { class: "list-summary" }, [
      el("span", { class: "list-summary__count", text: countText }),
      el("span", { class: "list-summary__totals" }, [
        income ? el("span", { class: "tx-amount--in", text: `+ ${formatMoney(income)}` }) : null,
        expense ? el("span", { class: "tx-amount--out", text: `− ${formatMoney(expense)}` }) : null,
      ]),
    ])
  );

  holder.append(el("ul", { class: "tx-list" }, merged.map((r, k) => (r.kind === "tx" ? txRowEl(r.d, k) : trRowEl(r.d, k)))));
}

function categoryOptions(type) {
  // Expenses: grouped by theme (tidier menu); income: flat list.
  if (type !== "ENTRATA") return selectors.groupedExpenseCategories();
  return selectors.incomeCategories().map((c) => ({ value: c.id, label: c.name }));
}

export function openTxModal(tx = null) {
  const editing = !!tx;
  let type = tx?.type || "USCITA";

  const bodyWrap = el("div");
  const modal = openModal({ title: editing ? "Modifica transazione" : "Nuova transazione", body: bodyWrap });

  const buildFields = () =>
    buildForm(
      [
        { name: "type", label: "Tipo di movimento", type: "select", value: type, options: [
          { value: "USCITA", label: "Uscita" }, { value: "ENTRATA", label: "Entrata" },
        ]},
        { name: "title", label: "Titolo", required: true, value: tx?.title },
        { name: "amount", label: "Importo (€)", type: "number", step: "0.01", min: "0.01", required: true, value: tx?.amount },
        { name: "category_id", label: "Categoria", type: "select", required: true, value: tx?.category_id, options: categoryOptions(type) },
        { name: "tx_date", label: "Data", type: "date", required: true, value: tx?.tx_date || todayISO() },
        { name: "payment_method", label: "Metodo di pagamento", type: "select", value: tx?.payment_method || "CARTA", options: [
          { value: "CARTA", label: "Carta" }, { value: "CONTANTI", label: "Contanti" },
        ]},
        { name: "description", label: "Descrizione (facoltativa)", type: "textarea", value: tx?.description },
        { name: "is_recurring", label: "Transazione ricorrente (ogni mese)", type: "checkbox", value: tx?.is_recurring },
        {
          name: "recurring_end", label: "Fine rate prevista (facoltativa)", type: "date",
          value: tx?.recurring_end || "", showIf: "is_recurring",
          hint: "Dopo questa data la ricorrenza si ferma automaticamente",
        },
      ],
      {
        submitLabel: editing ? "Salva modifiche" : "Aggiungi",
        onSubmit: async (v) => {
          const payload = {
            type: v.type,
            title: v.title,
            amount: v.amount,
            category_id: v.category_id,
            category_name: selectors.categoryName(v.category_id),
            tx_date: v.tx_date,
            payment_method: v.payment_method,
            description: v.description || null,
            is_recurring: v.is_recurring,
            recurring_day: v.is_recurring ? new Date(v.tx_date).getDate() : null,
            recurring_end: v.is_recurring && v.recurring_end ? v.recurring_end : null,
          };
          try {
            if (editing) await txApi.update(tx.id, payload);
            else await txApi.create(payload);
            closeModal();
            toast(editing ? "Transazione aggiornata" : "Transazione aggiunta", "success");
          } catch (err) {
            toast(err.message, "error");
          }
        },
      }
    );

  const mount = () => {
    const form = buildFields();
    // When the type changes, regenerate the category options.
    form.addEventListener("change", (e) => {
      if (e.target.name === "type" && e.target.value !== type) {
        type = e.target.value;
        current.replaceWith((current = mount()));
      }
    });
    return form;
  };

  let current = mount();
  bodyWrap.append(current);
}

async function removeTx(tx) {
  if (!confirm(`Eliminare "${tx.title}"?`)) return;
  try {
    await txApi.remove(tx.id);
    toast("Transazione eliminata", "success");
  } catch (err) {
    toast(err.message, "error");
  }
}

// Money transfer between payment methods.
export function openTransferModal(tr = null) {
  const editing = !!tr;
  const dir = tr ? `${tr.from_method}>${tr.to_method}` : "CARTA>CONTANTI";

  // Available balance per method. When editing, the transfer being modified is
  // already reflected in the balance, so add its amount back to the source.
  const balances = selectors.paymentMethodBalances();
  const methodLbl = (m) => (m === "CONTANTI" ? "contanti" : "carta");
  const availableFor = (method) =>
    balances[method] + (editing && tr.from_method === method ? +tr.amount : 0);
  const cents = (n) => Math.round((Number(n) || 0) * 100);

  const body = buildForm(
    [
      {
        name: "direction", label: "Spostamento", segmented: true, value: dir,
        options: [
          { value: "CARTA>CONTANTI", label: "Carta → Contanti" },
          { value: "CONTANTI>CARTA", label: "Contanti → Carta" },
        ],
      },
      { name: "amount", label: "Importo (€)", type: "number", step: "0.01", min: "0.01", required: true, value: tr?.amount, placeholder: "50,00" },
      { name: "transfer_date", label: "Data", type: "date", required: true, value: tr?.transfer_date || todayISO() },
      { name: "note", label: "Nota (facoltativa)", type: "text", value: tr?.note || "", placeholder: "Es. prelievo bancomat" },
    ],
    {
      submitLabel: editing ? "Salva modifiche" : "Registra trasferimento",
      onSubmit: async (v) => {
        const [from_method, to_method] = String(v.direction || "CARTA>CONTANTI").split(">");
        if (from_method === to_method) return toast("Origine e destinazione devono essere diverse", "error");
        const available = availableFor(from_method);
        if (cents(v.amount) > cents(available)) {
          return toast(`Saldo insufficiente: su ${methodLbl(from_method)} hai ${formatMoney(available)}`, "error");
        }
        const payload = { from_method, to_method, amount: v.amount, transfer_date: v.transfer_date, note: v.note || null };
        try {
          if (editing) {
            const row = await transferApi.update(tr.id, payload);
            const i = state.transfers.findIndex((x) => x.id === tr.id);
            if (i > -1) state.transfers[i] = row || { ...tr, ...payload };
          } else {
            const row = await transferApi.create(payload);
            if (row?.id && !state.transfers.some((x) => x.id === row.id)) state.transfers.unshift(row);
          }
          closeModal();
          touch();
          toast(editing ? "Trasferimento aggiornato" : "Trasferimento registrato", "success");
        } catch (err) {
          toast(/does not exist|schema cache|PGRST/i.test(err.message || "")
            ? "Aggiorna il database (tabella transfers) per usare i trasferimenti."
            : err.message, "error");
        }
      },
    }
  );

  // Live feedback: show the available balance and flag an over-limit amount.
  const dirInput = body.querySelector('[name="direction"]');
  const amountInput = body.querySelector('[name="amount"]');
  const amountField = amountInput?.closest(".field");
  if (dirInput && amountInput && amountField) {
    const hint = el("span", { class: "field-hint" });
    amountField.insertBefore(hint, amountField.querySelector(".field-error"));
    const sync = () => {
      const from = String(dirInput.value || "CARTA>CONTANTI").split(">")[0];
      const avail = availableFor(from);
      hint.textContent = `Disponibile su ${methodLbl(from)}: ${formatMoney(avail)}`;
      const over = amountInput.value !== "" && cents(amountInput.value) > cents(avail);
      amountField.classList.toggle("has-error", over);
      const errNode = amountField.querySelector(".field-error");
      if (errNode) errNode.textContent = over ? "Importo superiore al saldo disponibile" : "";
    };
    dirInput.addEventListener("change", sync);
    amountInput.addEventListener("input", sync);
    amountInput.addEventListener("blur", sync);
    sync();
  }

  openModal({ title: editing ? "Modifica trasferimento" : "Nuovo trasferimento", body });
}

async function removeTransfer(tr) {
  if (!confirm("Eliminare questo trasferimento?")) return;
  try {
    await transferApi.remove(tr.id);
    state.transfers = state.transfers.filter((x) => x.id !== tr.id);
    touch();
    toast("Trasferimento eliminato", "success");
  } catch (err) {
    toast(err.message, "error");
  }
}
