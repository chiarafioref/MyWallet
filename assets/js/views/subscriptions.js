// Subscriptions / recurring expenses.
//  - control panel: active · monthly cost · yearly cost
//  - subscription CRUD (add, edit, delete, pause/resume)
//  - cost estimate (promo-aware) + end-of-promo alert
//  - generated expenses flow into history / budgets / statistics
import { state, selectors } from "../store.js";
import { subscriptions as subApi } from "../data.js";
import { buildForm } from "../form.js";
import {
  el, formatMoney, formatDate, todayISO, toast, openModal, closeModal, emptyState, animateCounter,
} from "../utils.js";
import { icon, iconEl } from "../icons.js";
import { generateSubscriptions } from "../subscriptions.js";

const FREQ = [
  { value: "MENSILE", label: "Mensile" },
  { value: "ANNUALE", label: "Annuale" },
  { value: "PERSONALIZZATA", label: "Personalizzata" },
];

function freqLabel(sub) {
  if (sub.frequency === "MENSILE") return "al mese";
  if (sub.frequency === "ANNUALE") return "all'anno";
  const n = Math.max(1, +sub.interval_months || 1);
  return n === 1 ? "al mese" : `ogni ${n} mesi`;
}

const initial = (name) => (name || "?").trim().charAt(0).toUpperCase() || "?";

export function render(container) {
  container.innerHTML = "";
  const summary = selectors.subscriptionCostSummary();
  const promo = selectors.subscriptionPromoAlerts(7);
  const nextCharge = selectors.upcomingSubscriptionCharges(1)[0] || null;
  const total = state.subscriptions.length;
  const aRegime = summary.monthlyRegular - summary.monthly > 0.01;

  let i = 0;
  const step = () => ({ style: `--i:${i++}` });

  const view = el("div", { class: "view view--subs" }, [
    el("header", { class: "view-head" }, [
      el("div", {}, [
        el("h2", { text: "Abbonamenti" }),
        el("p", { class: "muted", text: "Il pannello di controllo delle tue spese ricorrenti" }),
      ]),
      el("button", { class: "btn btn--primary", onclick: () => openSubModal() }, [iconEl("plus", { size: 18 }), "Nuovo abbonamento"]),
    ]),

    // control panel
    el("section", { class: "card glass subs-panel", ...step() }, [
      el("div", { class: "subs-panel__glow" }),
      el("div", { class: "subs-panel__grid" }, [
        counter("Attivi", summary.count, "repeat", { int: true, sub: total ? `su ${total} totali` : "nessuno" }),
        counter("Al mese", summary.monthly, "trendingDown", { sub: aRegime ? `poi ${formatMoney(summary.monthlyRegular)}` : "spesa ricorrente" }),
        counter("All'anno", summary.yearly, "calendar", { sub: aRegime ? `poi ${formatMoney(summary.yearlyRegular)}` : "stima 12 mesi" }),
      ]),
      nextCharge
        ? el("div", { class: "subs-panel__next" }, [
            el("span", { class: "icn-wrap", html: icon("clock", { size: 15 }) }),
            el("span", {}, [
              "Prossimo addebito · ",
              el("strong", { text: nextCharge.name }),
              ` ${formatDate(nextCharge.date)} · ${formatMoney(nextCharge.amount)}`,
            ]),
          ])
        : null,
    ]),

    ...promo.map((p) =>
      el("section", { class: "card glass promo-alert", ...step() }, [
        el("strong", {}, [el("span", { class: "icn-wrap", html: icon("alert", { size: 16 }) }), "Promozione in scadenza"]),
        el("p", {
          text: `${p.sub.name} passerà da ${formatMoney(p.from)} a ${formatMoney(p.to)} il ${formatDate(p.sub.promo_end_date)}. Il costo mensile aumenterà di ${formatMoney(p.monthlyDelta)}.`,
        }),
      ])
    ),

    state.subscriptions.length
      ? el("div", { class: "sub-grid" }, state.subscriptions.map((s, k) => subCard(s, k)))
      : el("div", { ...step() }, [emptyState("repeat", "Nessun abbonamento. Aggiungi Netflix, palestra, assicurazione…")]),
  ]);

  container.append(view);
  view.querySelectorAll("[data-counter]").forEach((n) =>
    animateCounter(n, Number(n.dataset.counter), n.dataset.int ? { format: (x) => String(Math.round(x)) } : {})
  );
}

function counter(label, value, iconName, { int = false, sub = null } = {}) {
  return el("div", { class: "subs-counter" }, [
    el("span", { class: "subs-counter__ic", html: icon(iconName, { size: 16 }) }),
    el("span", { class: "subs-counter__label", text: label }),
    el("strong", {
      class: "subs-counter__value",
      "data-counter": value,
      "data-value": 0,
      ...(int ? { "data-int": "1" } : {}),
      text: int ? "0" : formatMoney(0),
    }),
    sub ? el("span", { class: "subs-counter__sub muted", text: sub }) : null,
  ]);
}

function subCard(sub, k) {
  const paused = sub.is_paused;
  const now = selectors.subAmountOn(sub, new Date());
  const inPromo = sub.promo && sub.regular_amount && sub.promo_end_date && todayISO() < sub.promo_end_date;

  return el("div", { class: `card glass sub-card${paused ? " sub-card--paused" : ""}`, style: `--i:${k}` }, [
    el("div", { class: "sub-card__top" }, [
      el("span", { class: "sub-card__avatar", text: initial(sub.name) }),
      el("div", { class: "sub-card__id" }, [
        el("strong", { text: sub.name }),
        el("span", { class: "muted", text: sub.category_name || "Senza categoria" }),
      ]),
      el("span", { class: `badge badge--${paused ? "muted" : "ok"}`, text: paused ? "In pausa" : "Attivo" }),
    ]),
    el("div", { class: "sub-card__price" }, [
      el("span", { class: "sub-card__amount", text: formatMoney(now) }),
      el("span", { class: "muted", text: freqLabel(sub) }),
    ]),
    el("div", { class: "sub-card__foot" }, [
      el("span", {}, [
        el("span", { class: "icn-wrap", html: icon("clock", { size: 14 }) }),
        paused ? "Sospeso" : `Rinnovo ${formatDate(sub.next_payment_date)}`,
      ]),
      el("span", {}, [
        el("span", { class: "icn-wrap", html: icon(sub.payment_method === "CONTANTI" ? "banknote" : "creditCard", { size: 14 }) }),
        sub.payment_method === "CONTANTI" ? "Contanti" : "Carta",
      ]),
    ]),
    inPromo
      ? el("p", { class: "sub-card__promo" }, [
          el("span", { class: "icn-wrap", html: icon("alert", { size: 13 }) }),
          `In promo fino al ${formatDate(sub.promo_end_date)}, poi ${formatMoney(sub.regular_amount)}`,
        ])
      : null,
    el("div", { class: "sub-card__actions" }, [
      el("button", { class: "btn btn--ghost btn--sm", onclick: () => openSubModal(sub) }, "Modifica"),
      el("button", { class: "btn btn--ghost btn--sm", onclick: () => togglePause(sub) }, paused ? "Riattiva" : "Sospendi"),
      el("button", { class: "icon-btn icon-btn--danger", html: icon("trash", { size: 17 }), title: "Elimina", "aria-label": "Elimina", onclick: () => remove(sub) }),
    ]),
  ]);
}

function openSubModal(sub = null) {
  const editing = !!sub;
  const body = buildForm(
    [
      { name: "name", label: "Nome dell'abbonamento", required: true, value: sub?.name, placeholder: "Es. Netflix, palestra, assicurazione" },
      { name: "amount", label: "Importo attuale (€)", type: "number", step: "0.01", min: "0.01", required: true, value: sub?.amount, placeholder: "9,99" },
      { name: "category_id", label: "Categoria", type: "select", required: true, value: sub?.category_id, options: selectors.groupedExpenseCategories() },
      { name: "payment_method", label: "Metodo di pagamento", type: "select", value: sub?.payment_method || "CARTA", options: [
        { value: "CARTA", label: "Carta" }, { value: "CONTANTI", label: "Contanti" },
      ]},
      { name: "frequency", label: "Frequenza di addebito", type: "select", value: sub?.frequency || "MENSILE", options: FREQ },
      {
        name: "interval_months", label: "Ogni quanti mesi", type: "number", min: "1", step: "1",
        value: sub?.interval_months || 1, showIf: { field: "frequency", value: "PERSONALIZZATA" },
        hint: "Es. 3 per un addebito trimestrale",
      },
      { name: "next_payment_date", label: "Prossimo pagamento", type: "date", required: true, value: sub?.next_payment_date || todayISO() },
      { name: "promo", label: "È in offerta / prezzo promozionale", type: "checkbox", value: sub?.promo, hint: "Attiva se ora paghi meno del prezzo pieno" },
      {
        name: "promo_end_date", label: "Quando finisce la promozione", type: "date",
        value: sub?.promo_end_date || "", showIf: "promo",
      },
      {
        name: "regular_amount", label: "Prezzo pieno dopo la promozione (€)", type: "number", step: "0.01", min: "0.01",
        value: sub?.regular_amount || "", showIf: "promo",
      },
    ],
    {
      submitLabel: editing ? "Salva modifiche" : "Aggiungi abbonamento",
      onSubmit: async (v) => {
        if (v.promo && (!v.promo_end_date || !v.regular_amount)) {
          return toast("Per la promozione servono la data di fine e il prezzo pieno", "error");
        }
        const payload = {
          name: v.name,
          amount: v.amount,
          category_id: v.category_id,
          category_name: selectors.categoryName(v.category_id),
          payment_method: v.payment_method,
          frequency: v.frequency,
          interval_months: v.frequency === "PERSONALIZZATA" ? Math.max(1, v.interval_months || 1) : v.frequency === "ANNUALE" ? 12 : 1,
          next_payment_date: v.next_payment_date,
          start_date: v.next_payment_date,
          end_date: null,
          promo: !!v.promo,
          promo_end_date: v.promo ? v.promo_end_date : null,
          regular_amount: v.promo ? v.regular_amount : null,
        };
        try {
          if (editing) await subApi.update(sub.id, payload);
          else await subApi.create(payload);
          closeModal();
          toast(editing ? "Abbonamento aggiornato" : "Abbonamento aggiunto", "success");
          try {
            const n = await generateSubscriptions();
            if (n) toast(n === 1 ? "1 spesa da abbonamento registrata" : `${n} spese da abbonamento registrate`, "success");
          } catch (err) { console.warn(err); }
        } catch (err) {
          toast(err.message, "error");
        }
      },
    }
  );
  openModal({ title: editing ? "Modifica abbonamento" : "Nuovo abbonamento", body });
}

async function togglePause(sub) {
  try {
    await subApi.update(sub.id, { is_paused: !sub.is_paused });
    toast(sub.is_paused ? "Abbonamento riattivato" : "Abbonamento sospeso", "success");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function remove(sub) {
  if (!confirm(`Eliminare l'abbonamento "${sub.name}"? Le spese già registrate restano nello storico.`)) return;
  try {
    await subApi.remove(sub.id);
    toast("Abbonamento eliminato", "success");
  } catch (err) {
    toast(err.message, "error");
  }
}
