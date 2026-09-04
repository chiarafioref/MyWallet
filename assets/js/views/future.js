// Future expenses section: set-asides, monthly quota, calendar.
import { state, selectors, touch } from "../store.js";
import { futureExpenses as feApi, transactions as txApi } from "../data.js";
import { buildForm } from "../form.js";
import {
  el, formatMoney, formatDate, todayISO, toast, openModal, closeModal, emptyState,
} from "../utils.js";
import { icon, iconEl } from "../icons.js";

export function render(container) {
  container.innerHTML = "";

  const cards = state.futureExpenses.map((f) => {
    const saved = selectors.futureSaved(f.id);
    const remaining = Math.max(0, +f.total_amount - saved);
    const pct = Math.min(100, Math.round((saved / +f.total_amount) * 100));
    const monthsLeft = Math.max(1, monthsBetween(new Date(), new Date(f.due_date)));
    const quota = remaining / monthsLeft;

    return el("div", { class: "card glass fe-card fade-in" }, [
      el("div", { class: "fe-card__head" }, [
        el("strong", { text: f.name }),
        el("div", {}, [
          el("button", { class: "icon-btn icon-btn--danger", html: icon("trash", { size: 17 }), title: "Elimina", "aria-label": "Elimina", onclick: () => remove(f) }),
        ]),
      ]),
      el("div", { class: "progress" }, [el("div", { class: "progress__bar", style: `--pct:${pct}%` })]),
      el("ul", { class: "fe-card__stats" }, [
        li("Importo totale", formatMoney(f.total_amount)),
        li("Già accantonato", formatMoney(saved)),
        li("Quota mensile consigliata", formatMoney(quota)),
        li("Rimanente", formatMoney(remaining)),
        li("Scadenza", formatDate(f.due_date)),
      ]),
      f.note ? el("p", { class: "muted", text: f.note }) : null,
      remaining > 0
        ? el("button", {
            class: "btn btn--primary btn--block",
            onclick: () => accantona(f, quota),
          }, `Accantona quota mensile (${formatMoney(quota)})`)
        : el("p", { class: "goal-card__hint" }, [el("span", { class: "icn-wrap", html: icon("check", { size: 15 }) }), "Obiettivo raggiunto"]),
    ]);
  });

  const view = el("div", { class: "view" }, [
    el("header", { class: "view-head" }, [
      el("h2", { text: "Spese future" }),
      el("button", { class: "btn btn--primary", onclick: () => openModalForm() }, [iconEl("plus", { size: 18 }), "Nuovo accantonamento"]),
    ]),
    calendar(),
    cards.length ? el("div", { class: "fe-grid" }, cards) : emptyState("calendar", "Nessuna spesa futura pianificata"),
  ]);
  container.append(view);
}

const li = (k, v) => el("li", {}, [el("span", { class: "muted", text: k }), el("strong", { text: v })]);

function monthsBetween(a, b) {
  const m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  return b.getDate() >= a.getDate() ? m : m - 1;
}

function calendar() {
  const items = [
    ...state.futureExpenses
      .filter((f) => f.due_date >= todayISO())
      .map((f) => ({ date: f.due_date, name: f.name, amount: +f.total_amount, kind: "future" })),
    ...selectors.upcomingSubscriptionCharges(6),
  ]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8);

  if (!items.length) return el("div");
  return el("section", { class: "card glass" }, [
    el("h3", { text: "Prossime scadenze" }),
    el("p", { class: "muted", text: "Accantonamenti pianificati e addebiti degli abbonamenti attivi" }),
    el(
      "div",
      { class: "cal-strip" },
      items.map((it) => {
        const d = new Date(it.date);
        return el("div", { class: `cal-chip${it.kind === "subscription" ? " cal-chip--sub" : ""}` }, [
          el("span", { class: "cal-chip__day", text: String(d.getDate()).padStart(2, "0") }),
          el("span", { class: "cal-chip__month", text: d.toLocaleDateString("it-IT", { month: "short" }) }),
          el("span", { class: "cal-chip__name", text: it.name }),
          el("span", { class: "cal-chip__amt", text: formatMoney(it.amount) }),
        ]);
      })
    ),
  ]);
}

function openModalForm() {
  const body = buildForm(
    [
      { name: "name", label: "Nome della spesa", required: true, placeholder: "Es. Assicurazione auto" },
      { name: "total_amount", label: "Importo totale previsto (€)", type: "number", step: "0.01", min: "1", required: true },
      { name: "due_date", label: "Data di scadenza", type: "date", required: true },
      { name: "note", label: "Note (facoltative)", type: "textarea" },
    ],
    {
      submitLabel: "Crea accantonamento",
      onSubmit: async (v) => {
        try {
          await feApi.create({
            name: v.name,
            total_amount: v.total_amount,
            due_date: v.due_date,
            note: v.note || null,
          });
          closeModal();
          toast("Accantonamento creato", "success");
        } catch (err) {
          toast(err.message, "error");
        }
      },
    }
  );
  openModal({ title: "Nuova spesa futura", body });
}

async function accantona(f, quota) {
  const amount = Number(quota.toFixed(2));
  if (!(amount > 0)) return;
  try {
    const contribRow = await feApi.addContribution({ future_expense_id: f.id, amount });
    // Also record the quota in history (expense toward the set-aside).
    const txRow = await txApi.create({
      title: `Accantonamento · ${f.name}`,
      amount,
      category_id: null,
      category_name: "SPESE FUTURE",
      type: "USCITA",
      tx_date: todayISO(),
      description: `Quota mensile per "${f.name}" (scadenza ${formatDate(f.due_date)})`,
      payment_method: "CARTA",
      future_expense_id: f.id,
    });
    // Update local state right away: balance, dashboard and statistics.
    if (txRow?.id && !state.transactions.some((t) => t.id === txRow.id)) state.transactions.unshift(txRow);
    if (contribRow?.id && !state.futureContributions.some((c) => c.id === contribRow.id)) state.futureContributions.unshift(contribRow);
    if (selectors.futureSaved(f.id) >= +f.total_amount && !f.is_completed) {
      await feApi.update(f.id, { is_completed: true });
      f.is_completed = true;
    }
    touch();
    toast("Quota accantonata e aggiunta ai movimenti", "success");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function remove(f) {
  if (!confirm(`Eliminare "${f.name}"? Verranno rimossi anche i movimenti di accantonamento collegati.`)) return;
  try {
    await txApi.removeByFuture(f.id);
    await feApi.remove(f.id);
    state.futureExpenses = state.futureExpenses.filter((x) => x.id !== f.id);
    state.futureContributions = state.futureContributions.filter((c) => c.future_expense_id !== f.id);
    state.transactions = state.transactions.filter((t) => t.future_expense_id !== f.id);
    touch();
    toast("Eliminato", "success");
  } catch (err) {
    toast(err.message, "error");
  }
}
