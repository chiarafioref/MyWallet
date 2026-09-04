// Savings section: goals, contributions, suggestions from budgets.
//  - panel with total saved / this month / goals / reached
//  - goals with or without a target (open piggy bank)
//  - every contribution also creates a transaction (USCITA "RISPARMI") so it
//    shows up in history, dashboard, statistics and analysis
//  - savings suggestions are at the bottom of the page
import { state, selectors, touch } from "../store.js";
import { goals as goalApi, transactions as txApi } from "../data.js";
import { buildForm } from "../form.js";
import {
  el, formatMoney, formatDate, todayISO, isSameMonth, toast, openModal, closeModal, emptyState, animateCounter,
} from "../utils.js";
import { icon, iconEl } from "../icons.js";

export function render(container) {
  container.innerHTML = "";
  const goals = state.goals;
  const totalSaved = selectors.totalSavings();
  const monthSaved = state.goalContributions
    .filter((c) => isSameMonth(c.contributed_on, new Date()) && +c.amount > 0)
    .reduce((s, c) => s + +c.amount, 0);
  const completed = goals.filter((g) => g.target_amount && selectors.goalSaved(g.id) >= +g.target_amount).length;

  let i = 0;
  const step = () => ({ style: `--i:${i++}` });

  const view = el("div", { class: "view view--savings" }, [
    el("header", { class: "view-head" }, [
      el("div", {}, [
        el("h2", { text: "Risparmi" }),
        el("p", { class: "muted", text: "I tuoi obiettivi e quanto hai messo da parte" }),
      ]),
      el("button", { class: "btn btn--primary", onclick: () => openGoalModal() }, [iconEl("plus", { size: 18 }), "Nuovo obiettivo"]),
    ]),

    goals.length ? overviewPanel(step(), { totalSaved, monthSaved, count: goals.length, completed }) : null,

    goals.length
      ? el("div", { class: "goal-grid" }, goals.map((g, k) => goalCard(g, k)))
      : el("div", { ...step() }, [emptyState("savings", "Nessun obiettivo di risparmio. Creane uno per iniziare a mettere da parte.")]),

    savingsTips(step()),
  ].filter(Boolean));

  container.append(view);
  view.querySelectorAll("[data-counter]").forEach((n) => animateCounter(n, Number(n.dataset.counter)));
}

function overviewPanel(attrs, { totalSaved, monthSaved, count, completed }) {
  return el("section", { class: "card glass savings-panel", ...attrs }, [
    el("div", { class: "savings-panel__glow" }),
    el("div", { class: "savings-panel__hero" }, [
      el("span", { class: "savings-panel__label" }, [iconEl("savings", { size: 15 }), "Totale accantonato"]),
      el("strong", { class: "savings-panel__value", "data-counter": totalSaved, "data-value": 0, text: formatMoney(0) }),
    ]),
    el("div", { class: "savings-panel__grid" }, [
      miniStat("Questo mese", formatMoney(monthSaved)),
      miniStat("Obiettivi", String(count)),
      miniStat("Raggiunti", String(completed)),
    ]),
  ]);
}

function miniStat(label, value) {
  return el("div", { class: "savings-mini" }, [
    el("span", { class: "savings-mini__v", text: value }),
    el("span", { class: "savings-mini__l muted", text: label }),
  ]);
}

function goalCard(g, k) {
  const saved = selectors.goalSaved(g.id);
  const contribs = state.goalContributions.filter((c) => c.savings_goal_id === g.id);
  const lastContrib = contribs.map((c) => c.contributed_on).sort().at(-1);
  const hasTarget = !!g.target_amount;
  const target = hasTarget ? +g.target_amount : 0;
  const pct = hasTarget ? Math.min(100, Math.round((saved / target) * 100)) : 0;
  const missing = hasTarget ? Math.max(0, target - saved) : 0;
  const done = hasTarget && saved >= target;

  return el("div", {
    class: `card glass goal-card${done ? " goal-card--done" : ""}${hasTarget ? "" : " goal-card--open"}`,
    style: `--i:${k}`,
  }, [
    el("div", { class: "goal-card__head" }, [
      el("div", { class: "goal-card__id" }, [
        el("span", { class: "goal-card__ic", html: icon(done ? "trophy" : "target", { size: 16 }) }),
        el("div", { class: "goal-card__idtext" }, [
          el("strong", { text: g.name }),
          el("span", { class: "muted", text: g.target_date ? `Scadenza ${formatDate(g.target_date)}` : hasTarget ? "Senza scadenza" : "Salvadanaio libero" }),
        ]),
      ]),
      el("button", { class: "icon-btn icon-btn--danger", html: icon("trash", { size: 16 }), title: "Elimina", "aria-label": "Elimina", onclick: () => remove(g) }),
    ]),

    hasTarget
      ? el("div", { class: "goal-card__progress" }, [
          el("div", { class: "progress" }, [el("div", { class: "progress__bar progress__bar--green", style: `--pct:${pct}%` })]),
          el("div", { class: "goal-card__meta" }, [
            el("span", { text: `${formatMoney(saved)} / ${formatMoney(target)}` }),
            el("strong", { text: `${pct}%` }),
          ]),
        ])
      : el("div", { class: "goal-card__saved" }, [
          el("strong", { text: formatMoney(saved) }),
          el("span", { class: "muted", text: "accantonati" }),
        ]),

    done
      ? el("p", { class: "goal-card__hint goal-card__hint--ok" }, [el("span", { class: "icn-wrap", html: icon("check", { size: 14 }) }), "Obiettivo raggiunto!"])
      : hasTarget
        ? el("p", { class: "muted", text: `Mancano ${formatMoney(missing)}` })
        : contribs.length
          ? el("p", { class: "muted", text: `${contribs.length} versament${contribs.length === 1 ? "o" : "i"} · ultimo ${formatDate(lastContrib)}` })
          : el("p", { class: "muted", text: "Ancora nessun versamento" }),

    !done && hasTarget && missing > 0 ? el("p", { class: "goal-card__tip", text: monthlySuggestion(g, missing) }) : null,

    el("button", { class: "btn btn--primary btn--block btn--sm", onclick: () => contribute(g) }, [iconEl("plus", { size: 15 }), "Aggiungi risparmio"]),
  ].filter(Boolean));
}

function monthlySuggestion(goal, missing) {
  if (missing <= 0) return "";
  if (!goal.target_date) return `Con ${formatMoney(missing / 12)} al mese lo raggiungi in un anno.`;
  const months = Math.max(1, monthsBetween(new Date(), new Date(goal.target_date)));
  return `Metti da parte ${formatMoney(missing / months)}/mese per arrivarci entro il ${formatDate(goal.target_date)} (${months} mesi).`;
}

function monthsBetween(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

// Savings suggestions (bottom of the page).
function savingsTips(attrs) {
  const spent = selectors.spentByCategory();
  const rows = state.budgets
    .map((b) => {
      const name = selectors.categoryName(b.category_id);
      const diff = +b.monthly_limit - (spent[name] || 0);
      return { name, limit: +b.monthly_limit, used: spent[name] || 0, diff };
    })
    .filter((r) => r.diff > 0)
    .sort((a, b) => b.diff - a.diff);

  if (!rows.length) return null;
  const totalSaveable = rows.reduce((s, r) => s + r.diff, 0);

  return el("section", { class: "card glass report savings-tips", ...attrs }, [
    el("h3", {}, [el("span", { class: "icn-wrap", html: icon("lightbulb", { size: 17 }) }), "Dove puoi ancora risparmiare questo mese"]),
    el("ul", { class: "report-list" }, rows.map((r) =>
      el("li", {}, [
        el("span", { text: r.name }),
        el("span", { class: "muted", text: `speso ${formatMoney(r.used)} / budget ${formatMoney(r.limit)}` }),
        el("strong", { class: "tx-amount--in", text: `+${formatMoney(r.diff)}` }),
      ])
    )),
    el("p", { class: "report__total", text: `Puoi mettere da parte fino a ${formatMoney(totalSaveable)} restando nei budget.` }),
  ]);
}

function openGoalModal() {
  const body = buildForm(
    [
      { name: "name", label: "Nome obiettivo", required: true, placeholder: "Es. Viaggio a New York" },
      { name: "target_amount", label: "Obiettivo da raggiungere (€) — facoltativo", type: "number", step: "0.01", min: "1", hint: "Lascia vuoto per un salvadanaio libero, senza traguardo" },
      { name: "target_date", label: "Data entro cui raggiungerlo (facoltativa)", type: "date" },
    ],
    {
      submitLabel: "Crea obiettivo",
      onSubmit: async (v) => {
        try {
          await goalApi.create({
            name: v.name,
            target_amount: v.target_amount || null,
            target_date: v.target_date || null,
          });
          closeModal();
          toast("Obiettivo creato", "success");
        } catch (err) {
          toast(err.message, "error");
        }
      },
    }
  );
  openModal({ title: "Nuovo obiettivo di risparmio", body });
}

function contribute(goal) {
  const body = buildForm(
    [
      { name: "amount", label: "Importo da mettere da parte (€)", type: "number", step: "0.01", min: "0.01", required: true },
      { name: "contributed_on", label: "Data", type: "date", value: todayISO(), required: true },
      { name: "note", label: "Nota (facoltativa)", type: "text", placeholder: "Es. bonus di fine mese" },
    ],
    {
      submitLabel: "Aggiungi ai risparmi",
      onSubmit: async (v) => {
        try {
          const contribRow = await goalApi.addContribution({
            savings_goal_id: goal.id,
            amount: v.amount,
            contributed_on: v.contributed_on,
            note: v.note || null,
          });
          // Also record the movement in history (expense toward savings).
          const txRow = await txApi.create({
            title: `Risparmio · ${goal.name}`,
            amount: v.amount,
            category_id: null,
            category_name: "RISPARMI",
            type: "USCITA",
            tx_date: v.contributed_on,
            description: v.note || "Versamento verso un obiettivo di risparmio",
            payment_method: "CARTA",
            savings_goal_id: goal.id,
          });
          // Update local state right away so balance, dashboard and statistics
          // refresh without waiting for the realtime event.
          if (txRow?.id && !state.transactions.some((t) => t.id === txRow.id)) state.transactions.unshift(txRow);
          if (contribRow?.id && !state.goalContributions.some((c) => c.id === contribRow.id)) state.goalContributions.unshift(contribRow);
          if (goal.target_amount && !goal.is_completed && selectors.goalSaved(goal.id) >= +goal.target_amount) {
            await goalApi.update(goal.id, { is_completed: true });
            goal.is_completed = true;
            toast(`Obiettivo "${goal.name}" raggiunto! 🎉`, "success");
          }
          closeModal();
          touch();
          toast("Risparmio aggiunto ai movimenti", "success");
        } catch (err) {
          toast(err.message, "error");
        }
      },
    }
  );
  openModal({ title: `Aggiungi a "${goal.name}"`, body });
}

async function remove(goal) {
  if (!confirm(`Eliminare l'obiettivo "${goal.name}"? Verranno rimossi anche i movimenti di risparmio collegati.`)) return;
  try {
    await txApi.removeByGoal(goal.id);
    await goalApi.remove(goal.id);
    state.goals = state.goals.filter((g) => g.id !== goal.id);
    state.goalContributions = state.goalContributions.filter((c) => c.savings_goal_id !== goal.id);
    state.transactions = state.transactions.filter((t) => t.savings_goal_id !== goal.id);
    touch();
    toast("Obiettivo eliminato", "success");
  } catch (err) {
    toast(err.message, "error");
  }
}
