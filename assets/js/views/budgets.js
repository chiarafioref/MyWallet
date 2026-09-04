// Budgets: monthly limit per category, usage and alerts.
//  - month summary (spent / limit / remaining)
//  - assistant-guided creation (50/30/20 wizard)
//  - per-category cards with subscription projection
import { state, selectors } from "../store.js";
import { budgets as budgetApi } from "../data.js";
import { buildForm } from "../form.js";
import { el, qs, formatMoney, toast, openModal, closeModal, emptyState, animateCounter } from "../utils.js";
import { icon, iconEl } from "../icons.js";
import { renderBudgetPlanner } from "../assistant/budget-planner.js";

export function render(container) {
  container.innerHTML = "";
  const spent = selectors.spentByCategory();
  const projected = selectors.projectedSubscriptionByCategory();
  const hasBudgets = state.budgets.length > 0;

  const view = el("div", { class: "view view--budget" }, [
    el("header", { class: "view-head" }, [
      el("div", {}, [
        el("h2", { text: "Budget" }),
        el("p", { class: "muted", text: "Un limite mensile per ogni categoria di spesa" }),
      ]),
      el("div", { class: "view-head__actions" }, [
        el("button", { class: "btn btn--primary", onclick: openPlanner }, [iconEl("sparkles", { size: 17 }), "Crea con l'assistente"]),
        el("button", { class: "btn btn--ghost", onclick: () => openBudgetModal() }, [iconEl("plus", { size: 18 }), "Aggiungi"]),
      ]),
    ]),
    hasBudgets ? overview(spent) : null,
    hasBudgets
      ? el("div", { class: "budget-grid" }, cards(spent, projected))
      : plannerCta(),
  ].filter(Boolean));

  container.append(view);
  view.querySelectorAll("[data-counter]").forEach((n) => animateCounter(n, Number(n.dataset.counter)));
}

function overview(spent) {
  const used = (b) => spent[selectors.categoryName(b.category_id)] || 0;
  const totalLimit = state.budgets.reduce((s, b) => s + +b.monthly_limit, 0);
  const totalUsed = state.budgets.reduce((s, b) => s + used(b), 0);
  const pct = totalLimit ? Math.min(100, Math.round((totalUsed / totalLimit) * 100)) : 0;
  const over = state.budgets.filter((b) => used(b) > +b.monthly_limit).length;
  const level = pct >= 100 || over ? "danger" : pct >= 85 ? "warn" : "ok";

  return el("section", { class: `card glass budget-overview budget-overview--${level}` }, [
    el("div", { class: "budget-overview__top" }, [
      el("div", { class: "budget-overview__figures" }, [
        el("span", { class: "budget-overview__label muted", text: `Speso questo mese · ${state.budgets.length} budget attivi` }),
        el("strong", { class: "budget-overview__value", "data-counter": totalUsed, "data-value": 0, text: formatMoney(0) }),
        el("span", { class: "budget-overview__of muted", text: `su ${formatMoney(totalLimit)} di budget` }),
      ]),
      el("div", { class: "budget-overview__ring", style: `--pct:${pct}` }, [
        el("span", { class: "budget-overview__ring-in", text: `${pct}%` }),
      ]),
    ]),
    el("div", { class: "progress" }, [el("div", { class: "progress__bar", style: `--pct:${pct}%` })]),
    el("div", { class: "budget-overview__foot" }, [
      el("span", { class: "muted", text: `Rimanente ${formatMoney(Math.max(0, totalLimit - totalUsed))}` }),
      over
        ? el("span", { class: "budget-overview__flag budget-overview__flag--bad" }, [
            el("span", { class: "icn-wrap", html: icon("alert", { size: 14 }) }),
            over === 1 ? "1 budget oltre il limite" : `${over} budget oltre il limite`,
          ])
        : el("span", { class: "budget-overview__flag budget-overview__flag--ok" }, [
            el("span", { class: "icn-wrap", html: icon("check", { size: 14 }) }),
            "Tutto sotto controllo",
          ]),
    ]),
  ]);
}

function cards(spent, projected) {
  return state.budgets
    .slice()
    .sort((a, b) => {
      const ua = (spent[selectors.categoryName(a.category_id)] || 0) / +a.monthly_limit;
      const ub = (spent[selectors.categoryName(b.category_id)] || 0) / +b.monthly_limit;
      return ub - ua;
    })
    .map((b, i) => {
      const name = selectors.categoryName(b.category_id);
      const used = spent[name] || 0;
      const upcoming = projected[name] || 0;
      const limit = +b.monthly_limit;
      const pct = Math.min(100, Math.round((used / limit) * 100));
      const forecastPct = Math.min(100, Math.round(((used + upcoming) / limit) * 100));
      const level = pct >= 100 ? "danger" : pct >= 80 || used + upcoming > limit ? "warn" : "ok";
      return el("div", { class: `budget-card card glass budget-card--${level}`, style: `--i:${i}` }, [
        el("div", { class: "budget-card__head" }, [
          el("strong", { text: name }),
          el("div", { class: "budget-card__actions" }, [
            el("button", { class: "icon-btn", html: icon("pencil", { size: 17 }), title: "Modifica", "aria-label": "Modifica", onclick: () => openBudgetModal(b) }),
            el("button", { class: "icon-btn icon-btn--danger", html: icon("trash", { size: 17 }), title: "Elimina", "aria-label": "Elimina", onclick: () => remove(b) }),
          ]),
        ]),
        el("div", { class: "progress" }, [
          el("div", { class: "progress__bar", style: `--pct:${pct}%` }),
          upcoming > 0 ? el("span", { class: "progress__tick", style: `--l:${forecastPct}%`, title: `Proiezione con abbonamenti: ${forecastPct}%` }) : null,
        ].filter(Boolean)),
        el("div", { class: "budget-card__meta" }, [
          el("span", { text: `${formatMoney(used)} / ${formatMoney(limit)}` }),
          el("span", { class: "budget-card__pct", text: `${pct}%` }),
        ]),
        upcoming > 0
          ? el("p", { class: "muted", text: `+ ${formatMoney(upcoming)} previsti da abbonamenti (proiezione ${forecastPct}%)` })
          : null,
        level !== "ok"
          ? el("p", { class: "budget-card__alert" }, [
              el("span", { class: "icn-wrap", html: icon("alert", { size: 15 }) }),
              level === "danger" ? "Budget superato" : "Ti stai avvicinando al limite",
            ])
          : el("span", { class: "muted", text: `Rimanente: ${formatMoney(Math.max(0, limit - used))}` }),
      ].filter(Boolean));
    });
}

function plannerCta() {
  return el("section", { class: "card glass budget-cta" }, [
    el("span", { class: "budget-cta__icon", html: icon("sparkles", { size: 30 }) }),
    el("h3", { text: "Costruiamo il tuo budget su misura" }),
    el("p", { class: "muted", text: "Rispondi a poche domande mirate: l'assistente analizza le tue spese degli ultimi mesi e ti propone un budget realistico categoria per categoria, seguendo la regola 50/30/20." }),
    el("div", { class: "budget-cta__actions" }, [
      el("button", { class: "btn btn--primary", onclick: openPlanner }, [iconEl("sparkles", { size: 18 }), "Crea con l'assistente"]),
      el("button", { class: "btn btn--ghost", onclick: () => openBudgetModal() }, "Imposta manualmente"),
    ]),
  ]);
}

function openPlanner() {
  const mount = el("div", { class: "budget-planner-mount" });
  const { close } = openModal({ title: "Assistente budget", body: mount });
  renderBudgetPlanner(mount, {
    onDone: () => {
      close();
      const outlet = qs("#route-outlet");
      if (outlet) render(outlet);
    },
  });
}

function openBudgetModal(budget = null) {
  const editing = !!budget;
  const usedCats = new Set(state.budgets.map((b) => b.category_id));
  const available = selectors
    .expenseCategories()
    .filter((c) => editing || !usedCats.has(c.id))
    .map((c) => ({ value: c.id, label: c.name }));

  const body = buildForm(
    [
      {
        name: "category_id", label: "Categoria di spesa", type: "select", required: true,
        value: budget?.category_id,
        options: editing
          ? [{ value: budget.category_id, label: selectors.categoryName(budget.category_id) }]
          : available,
      },
      { name: "monthly_limit", label: "Importo massimo mensile (€)", type: "number", step: "0.01", min: "0.01", required: true, value: budget?.monthly_limit },
    ],
    {
      submitLabel: editing ? "Salva" : "Crea budget",
      onSubmit: async (v) => {
        try {
          await budgetApi.upsert({
            id: budget?.id,
            category_id: v.category_id,
            monthly_limit: v.monthly_limit,
          });
          closeModal();
          toast("Budget salvato", "success");
        } catch (err) {
          toast(err.message, "error");
        }
      },
    }
  );

  openModal({ title: editing ? "Modifica budget" : "Nuovo budget", body });
}

async function remove(b) {
  if (!confirm("Eliminare questo budget?")) return;
  try {
    await budgetApi.remove(b.id);
    toast("Budget eliminato", "success");
  } catch (err) {
    toast(err.message, "error");
  }
}
