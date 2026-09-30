// Consulente di budget: procedura guidata in 4 passi basata sulla regola 50/30/20
// (reddito e risparmio → situazione personale → categorie → importi proposti).
import { state, selectors } from "../store.js";
import { budgets as budgetApi } from "../data.js";
import { el, formatMoney, toast, monthKey, parseDate, sameText } from "../utils.js";
import { icon } from "../icons.js";
import { CATEGORY, categoryKey } from "../categories.js";

// Categorie essenziali ("bisogni"): tutte le altre sono "desideri".
const NEEDS = new Set(
  [
    CATEGORY.CASA,
    CATEGORY.SPESA,
    CATEGORY.UTENZE,
    CATEGORY.TRASPORTI,
    CATEGORY.CARBURANTE,
    CATEGORY.SPESE_AUTO,
    CATEGORY.SALUTE,
    CATEGORY.ISTRUZIONE,
    CATEGORY.RATE_FINANZIAMENTI,
  ].map(categoryKey)
);
const isNeed = (name) => NEEDS.has(categoryKey(name));

// Valori di riferimento mensili (adulto single, Italia):
//  - floor   = minimo sensato se la categoria è a budget
//  - typical = valore di partenza in assenza di storico
const BASELINES = new Map(
  [
    [CATEGORY.CASA, 300, 550],
    [CATEGORY.SPESA, 150, 280],
    [CATEGORY.UTENZE, 60, 130],
    [CATEGORY.TRASPORTI, 25, 55],
    [CATEGORY.CARBURANTE, 40, 110],
    [CATEGORY.SPESE_AUTO, 25, 70],
    [CATEGORY.SALUTE, 15, 45],
    [CATEGORY.ISTRUZIONE, 15, 60],
    [CATEGORY.RATE_FINANZIAMENTI, 0, 0],
    [CATEGORY.TASSE, 0, 0],
    [CATEGORY.RISTORANTI, 25, 90],
    [CATEGORY.BAR, 15, 45],
    [CATEGORY.SHOPPING, 20, 70],
    [CATEGORY.SPORT, 20, 45],
    [CATEGORY.INTRATTENIMENTO, 15, 45],
    [CATEGORY.VIAGGI, 20, 90],
    [CATEGORY.REGALI, 10, 30],
    [CATEGORY.ALTRO, 15, 50],
  ].map(([name, floor, typical]) => [categoryKey(name), { floor, typical }])
);
const DEFAULT_BASELINE = { floor: 15, typical: 50 };

const round5 = (n) => Math.max(0, Math.round(n / 5) * 5);

// Mesi della finestra che contengono davvero spese: evita di diluire la media
// su mesi vuoti (es. un solo mese reale diviso per 3).
function monthsWithExpenseData(windowMonths = 3) {
  const now = new Date();
  const keys = new Set(
    Array.from({ length: windowMonths }, (_, i) => monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)))
  );
  const present = new Set();
  for (const t of state.transactions) {
    if (t.type !== "USCITA") continue;
    const k = monthKey(parseDate(t.tx_date));
    if (keys.has(k)) present.add(k);
  }
  return Math.max(1, present.size);
}

function avgMonthly(catName, months = 3) {
  const now = new Date();
  const keys = Array.from({ length: months }, (_, i) => monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  let total = 0;
  for (const t of state.transactions) {
    if (t.type !== "USCITA") continue;
    const n = t.category_name || selectors.categoryName(t.category_id);
    if (n !== catName || !keys.includes(monthKey(parseDate(t.tx_date)))) continue;
    total += +t.amount;
  }
  return total / monthsWithExpenseData(months);
}

function avgIncomeMonthly(months = 4) {
  const now = new Date();
  const keys = Array.from({ length: months }, (_, i) => monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  const byM = {};
  for (const t of state.transactions) {
    if (t.type !== "ENTRATA") continue;
    const k = monthKey(parseDate(t.tx_date));
    if (keys.includes(k)) byM[k] = (byM[k] || 0) + +t.amount;
  }
  const vals = Object.values(byM);
  if (!vals.length) return Math.round(selectors.monthIncome() || 0);
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export function renderBudgetPlanner(mount, { onDone } = {}) {
  const expenseCats = [...new Map(selectors.expenseCategories().map((c) => [c.name, c])).values()];
  const history = Object.fromEntries(expenseCats.map((c) => [c.name, avgMonthly(c.name)]));
  const guessIncome = avgIncomeMonthly();

  const S = {
    step: 1,
    income: guessIncome || "",
    savePct: 20,
    housing: "affitto", // affitto | mutuo | proprieta
    debt: "", // rate mensili di prestiti/finanziamenti (€)
    emergencyFund: null, // true | false
    goal: "risparmio", // risparmio | emergenza | debiti | spese
    selected: new Set(expenseCats.filter((c) => history[c.name] > 3).map((c) => c.name)),
    amounts: {},
  };
  if (!S.selected.size) expenseCats.slice(0, 5).forEach((c) => S.selected.add(c.name));

  /* Calcolo della proposta:
      - si parte dalla spesa reale (storico) o, in assenza, da un valore tipico;
      - ogni categoria ha un minimo sensato;
      - le voci fisse (casa, rate, tasse) non scendono sotto il reale;
      - se il totale supera il disponibile si comprimono prima i desideri, poi gli
        essenziali, sempre sopra i minimi. */
  function catFloorTarget(name) {
    const b = BASELINES.get(categoryKey(name)) || DEFAULT_BASELINE;
    const h = Math.max(0, history[name] || 0);
    const essential = isNeed(name);
    const hasHist = h > 8;

    if (sameText(name, CATEGORY.RATE_FINANZIAMENTI)) {
      const v = Math.max(Number(S.debt) || 0, h);
      return { target: round5(v) || round5(h) || 0, floor: round5(v) || round5(h) || 0, fixed: true };
    }
    if (sameText(name, CATEGORY.TASSE)) return { target: round5(h), floor: round5(h * 0.9), fixed: true };
    if (sameText(name, CATEGORY.CASA)) {
      const owned = S.housing === "proprieta";
      const base = hasHist ? h * 1.03 : owned ? 200 : b.typical;
      const floor = hasHist ? round5(h * 0.95) : owned ? 100 : b.floor;
      return { target: round5(base), floor, fixed: true };
    }

    let target = hasHist ? h * 1.05 : b.typical || b.floor;
    // Con obiettivi di risparmio o controllo i desideri con storico vengono ridotti del 10%.
    if (
      !essential &&
      hasHist &&
      (S.goal === "risparmio" || S.goal === "spese" || S.goal === "emergenza" || S.emergencyFund === false)
    ) {
      target = h * 0.9;
    }
    // Per gli essenziali con storico il minimo è l'85% della spesa reale.
    const floor = essential && hasHist ? Math.max(b.floor, h * 0.85) : b.floor;
    return { target: round5(Math.max(target, floor)), floor: round5(floor), fixed: false };
  }

  function computeProposal() {
    const income = Number(S.income) || 0;
    const debt = Number(S.debt) || 0;
    const savings = income * (S.savePct / 100);
    const sel = [...S.selected];
    const needs = sel.filter(isNeed);
    const wants = sel.filter((n) => !isNeed(n));

    // Se le rate sono già una categoria a budget non vanno sottratte una seconda volta.
    const rateInBudget = sel.some((n) => sameText(n, CATEGORY.RATE_FINANZIAMENTI));
    const spendable = Math.max(0, income - savings - (rateInBudget ? 0 : debt));

    const T = {},
      FL = {};
    for (const n of sel) {
      const { target, floor } = catFloorTarget(n);
      T[n] = target;
      FL[n] = Math.min(floor, target);
    }

    const sumOf = (g) => g.reduce((s, n) => s + (T[n] || 0), 0);
    const floorTotal = sel.reduce((s, n) => s + FL[n], 0);
    let overflow = sumOf(needs) + sumOf(wants) - spendable;

    if (overflow > 0.5 && spendable > 0) {
      // 1) desideri compressi fino ai minimi
      const wSlack = wants.reduce((s, n) => s + (T[n] - FL[n]), 0);
      const cutW = Math.min(overflow, wSlack);
      if (cutW > 0 && wSlack > 0) {
        const k = cutW / wSlack;
        for (const n of wants) T[n] = round5(T[n] - (T[n] - FL[n]) * k);
        overflow -= cutW;
      }
      // 2) se non basta, essenziali comprimibili
      if (overflow > 0.5) {
        const nSlack = needs.reduce((s, n) => s + (T[n] - FL[n]), 0);
        const cutN = Math.min(overflow, nSlack);
        if (cutN > 0 && nSlack > 0) {
          const k = cutN / nSlack;
          for (const n of needs) T[n] = round5(T[n] - (T[n] - FL[n]) * k);
          overflow -= cutN;
        }
      }
    }

    return {
      ...T,
      _savings: savings,
      _needs: needs,
      _wants: wants,
      _needsSum: sumOf(needs),
      _wantsSum: sumOf(wants),
      _spendable: spendable,
      _floorTotal: floorTotal,
      _tight: overflow > 1, // doesn't fit even at the realistic minimums
    };
  }

  function ensureAmounts() {
    const p = computeProposal();
    for (const n of S.selected) if (S.amounts[n] == null) S.amounts[n] = p[n] ?? 0;
    S._p = p;
  }

  const draw = () => {
    mount.innerHTML = "";
    mount.append(shell());
    if (S.step === 4) refreshTotals();
  };

  function shell() {
    const steps = [step1, step2, step3, step4];
    return el("section", { class: "bp card glass" }, [
      el("header", { class: "bp__head" }, [
        el("span", { class: "bp__avatar", html: icon("sparkles", { size: 16 }) }),
        el("div", {}, [
          el("strong", { text: "Consulente di budget" }),
          el("span", { class: "muted", text: "Regola 50/30/20 · su misura per te" }),
        ]),
        el("button", {
          class: "icon-btn",
          "aria-label": "Chiudi",
          html: icon("close", { size: 18 }),
          onclick: () => onDone?.(),
        }),
      ]),
      el(
        "div",
        { class: "bp__steps" },
        [1, 2, 3, 4].map((n) =>
          el("span", { class: `bp__dot${n === S.step ? " is-active" : ""}${n < S.step ? " is-done" : ""}` })
        )
      ),
      el("div", { class: "bp__body" }, steps[S.step - 1]()),
    ]);
  }

  /* ---- Passo 1: reddito e risparmio ---- */
  function step1() {
    const income = Number(S.income) || 0;
    const saveEuro = income * (S.savePct / 100);
    const valid = income >= 100;

    return el("div", { class: "bp-step" }, [
      el("p", {
        class: "bp-say",
        text: "Ciao! Ti aiuto a costruire un budget mensile realistico. Partiamo dal tuo reddito netto mensile.",
      }),
      el("label", { class: "bp-field" }, [
        el("span", { text: "Reddito netto mensile" }),
        moneyField(
          S.income,
          (v) => {
            S.income = v;
            refreshStep1();
          },
          "es. 1800"
        ),
      ]),
      el("label", { class: "bp-field" }, [
        el("span", {}, [
          `Quanto vuoi mettere da parte ogni mese: `,
          el("strong", { id: "bp-save", text: `${S.savePct}% · ${formatMoney(saveEuro)}` }),
        ]),
        el("input", {
          type: "range",
          min: "5",
          max: "40",
          step: "5",
          value: S.savePct,
          class: "bp-range",
          oninput: (e) => {
            S.savePct = Number(e.target.value);
            refreshStep1();
          },
        }),
      ]),
      tip(
        "La regola 50/30/20: 50% del reddito alle spese essenziali, 30% agli sfizi, 20% al risparmio. È un ottimo punto di partenza."
      ),
      el("div", { class: "bp-actions" }, [
        el(
          "button",
          {
            class: "btn btn--primary btn--block",
            disabled: !valid || null,
            onclick: () => {
              S.step = 2;
              draw();
            },
          },
          "Continua"
        ),
      ]),
    ]);
  }
  function refreshStep1() {
    const income = Number(S.income) || 0;
    const saveEuro = income * (S.savePct / 100);
    const s = mount.querySelector("#bp-save");
    if (s) s.textContent = `${S.savePct}% · ${formatMoney(saveEuro)}`;
    const btn = mount.querySelector(".bp-step .btn--primary");
    if (btn) btn.disabled = income < 100;
  }

  /* ---- Passo 2: situazione personale ---- */
  function step2() {
    return el("div", { class: "bp-step" }, [
      el("p", {
        class: "bp-say",
        text: "Ora qualche domanda sulla tua situazione: mi serve per calibrare il budget come farebbe un consulente.",
      }),
      el("div", { class: "bp-field" }, [
        el("span", { text: "La tua situazione abitativa" }),
        seg("housing", [
          ["affitto", "In affitto"],
          ["mutuo", "Mutuo in corso"],
          ["proprieta", "Casa di proprietà"],
        ]),
      ]),
      el("label", { class: "bp-field" }, [
        el("span", { text: "Rate o prestiti che paghi ogni mese (finanziamenti, cessioni…)" }),
        moneyField(
          S.debt,
          (v) => {
            S.debt = v;
          },
          "0"
        ),
      ]),
      el("div", { class: "bp-field" }, [
        el("span", { text: "Hai già un fondo di emergenza (3–6 mesi di spese)?" }),
        boolSeg("emergencyFund", "Sì, ce l'ho", "Non ancora"),
      ]),
      el("div", { class: "bp-field" }, [
        el("span", { text: "Qual è il tuo obiettivo principale?" }),
        seg("goal", [
          ["risparmio", "Risparmiare di più"],
          ["emergenza", "Creare un fondo emergenza"],
          ["debiti", "Estinguere i debiti"],
          ["spese", "Controllare le spese"],
        ]),
      ]),
      dynTip(),
      el("div", { class: "bp-actions" }, [
        el(
          "button",
          {
            class: "btn btn--ghost",
            onclick: () => {
              S.step = 1;
              draw();
            },
          },
          "Indietro"
        ),
        el(
          "button",
          {
            class: "btn btn--primary",
            onclick: () => {
              S.step = 3;
              draw();
            },
          },
          "Continua"
        ),
      ]),
    ]);
  }

  function seg(key, options) {
    return el(
      "div",
      { class: "bp-seg" },
      options.map(([val, label]) =>
        el("button", {
          type: "button",
          class: `bp-seg__opt${S[key] === val ? " is-on" : ""}`,
          text: label,
          onclick: (e) => {
            S[key] = val;
            e.currentTarget.parentElement.querySelectorAll(".bp-seg__opt").forEach((b) => b.classList.remove("is-on"));
            e.currentTarget.classList.add("is-on");
            const t = mount.querySelector("#bp-dyntip");
            if (t) t.replaceWith(dynTip());
          },
        })
      )
    );
  }

  function boolSeg(key, yes, no) {
    const opt = (label, val) =>
      el("button", {
        type: "button",
        class: `bp-seg__opt${S[key] === val ? " is-on" : ""}`,
        text: label,
        onclick: (e) => {
          S[key] = val;
          e.currentTarget.parentElement.querySelectorAll(".bp-seg__opt").forEach((b) => b.classList.remove("is-on"));
          e.currentTarget.classList.add("is-on");
          const t = mount.querySelector("#bp-dyntip");
          if (t) t.replaceWith(dynTip());
        },
      });
    return el("div", { class: "bp-seg" }, [opt(yes, true), opt(no, false)]);
  }

  function dynTip() {
    const debt = Number(S.debt) || 0;
    let msg;
    if (S.goal === "debiti" && debt > 0) {
      msg =
        "Priorità ai debiti: tratterò le rate come spesa fissa e comprimerò gli sfizi per liberare liquidità da destinare all'estinzione.";
    } else if (S.goal === "emergenza" || S.emergencyFund === false) {
      msg =
        "Senza un fondo di emergenza conviene tenere la quota di risparmio ad almeno il 15–20%: costruiscilo prima di ogni altro obiettivo.";
    } else if (S.housing === "affitto") {
      msg =
        "L'affitto è di solito la voce fissa più pesante: controlleremo che resti entro il 30–35% del reddito netto.";
    } else if (S.housing === "mutuo") {
      msg =
        "Con un mutuo in corso la rata è una spesa essenziale fissa: il resto del budget si costruisce attorno a quella.";
    } else {
      msg = "Senza affitto né mutuo puoi destinare una quota maggiore del reddito agli obiettivi di risparmio.";
    }
    return el("div", { class: "bp-tip", id: "bp-dyntip" }, [
      el("span", { class: "icn-wrap", html: icon("lightbulb", { size: 15 }) }),
      el("span", { text: msg }),
    ]);
  }

  /* ---- Passo 3: categorie ---- */
  function step3() {
    const sorted = expenseCats.slice().sort((a, b) => (history[b.name] || 0) - (history[a.name] || 0));
    return el("div", { class: "bp-step" }, [
      el("p", {
        class: "bp-say",
        text: "Su quali categorie vuoi tenere un budget? Ho già selezionato quelle su cui spendi di più.",
      }),
      el(
        "div",
        { class: "bp-cats" },
        sorted.map((c) => {
          const on = S.selected.has(c.name);
          const h = history[c.name];
          return el(
            "button",
            {
              class: `bp-cat${on ? " is-on" : ""}`,
              onclick: (e) => {
                on ? S.selected.delete(c.name) : S.selected.add(c.name);
                delete S.amounts[c.name];
                e.currentTarget.classList.toggle("is-on");
                const n = mount.querySelector("#bp-selcount");
                if (n) n.textContent = String(S.selected.size);
                const btn = mount.querySelector(".bp-step .btn--primary");
                if (btn) btn.disabled = S.selected.size === 0;
              },
            },
            [
              el("span", { class: "bp-cat__check", html: icon("check", { size: 13 }) }),
              el("span", { class: "bp-cat__name", text: c.name }),
              h > 3
                ? el("span", { class: "bp-cat__hist", text: `~${formatMoney(h)}/mese` })
                : el("span", { class: "bp-cat__hist muted", text: "nuova" }),
            ]
          );
        })
      ),
      el("p", {
        class: "muted bp-selinfo",
        html: `<strong id="bp-selcount">${S.selected.size}</strong> categorie selezionate`,
      }),
      el("div", { class: "bp-actions" }, [
        el(
          "button",
          {
            class: "btn btn--ghost",
            onclick: () => {
              S.step = 2;
              draw();
            },
          },
          "Indietro"
        ),
        el(
          "button",
          {
            class: "btn btn--primary",
            disabled: S.selected.size === 0 || null,
            onclick: () => {
              S.amounts = {};
              S.step = 4;
              draw();
            },
          },
          "Continua"
        ),
      ]),
    ]);
  }

  /* ---- Passo 4: importi ---- */
  function step4() {
    ensureAmounts();

    const rows = [...S.selected]
      .sort((a, b) => isNeed(b) - isNeed(a) || a.localeCompare(b))
      .map((name) =>
        el("div", { class: "bp-row" }, [
          el("div", { class: "bp-row__l" }, [
            el("strong", { text: name }),
            el("span", {
              class: `bp-badge bp-badge--${isNeed(name) ? "need" : "want"}`,
              text: isNeed(name) ? "Essenziale" : "Sfizio",
            }),
          ]),
          el("div", { class: "bp-row__r" }, [
            el("div", { class: "bp-money bp-money--sm" }, [
              el("input", {
                type: "number",
                inputmode: "decimal",
                min: "0",
                step: "5",
                value: S.amounts[name],
                "data-cat": name,
                oninput: (e) => {
                  S.amounts[name] = Number(e.target.value) || 0;
                  refreshTotals();
                },
              }),
              el("span", { class: "bp-money__cur", text: "€" }),
            ]),
            history[name] > 3
              ? el("span", { class: "bp-hint muted", text: deltaLabel(S.amounts[name], history[name]) })
              : null,
          ]),
        ])
      );

    const intro = S._p?._tight
      ? "Ho proposto gli importi minimi realistici per ogni categoria, ma con questo reddito non ci stanno tutti: qui sotto vedi dove intervenire."
      : "Ecco la mia proposta: importi basati sulle tue spese reali e su valori minimi sensati per ogni categoria (niente cifre impossibili). Regola pure ogni voce.";
    return el("div", { class: "bp-step" }, [
      el("p", { class: "bp-say", text: intro }),
      el("div", { class: "bp-rows" }, rows),
      el("div", { class: "bp-summary", id: "bp-summary" }),
      el("div", { class: "bp-actions" }, [
        el(
          "button",
          {
            class: "btn btn--ghost",
            onclick: () => {
              S.step = 3;
              draw();
            },
          },
          "Indietro"
        ),
        el("button", { class: "btn btn--primary", id: "bp-create", onclick: create }, `Crea ${S.selected.size} budget`),
      ]),
    ]);
  }

  function deltaLabel(amount, hist) {
    const d = amount - hist;
    if (Math.abs(d) < 3) return `in linea con la media (${formatMoney(hist)})`;
    return d < 0 ? `−${formatMoney(-d)} rispetto alla media` : `+${formatMoney(d)} rispetto alla media`;
  }

  function refreshTotals() {
    const holder = mount.querySelector("#bp-summary");
    if (!holder) return;
    const income = Number(S.income) || 0;
    const debt = Number(S.debt) || 0;
    const savings = income * (S.savePct / 100);
    let needs = 0,
      wants = 0;
    for (const n of S.selected) isNeed(n) ? (needs += S.amounts[n] || 0) : (wants += S.amounts[n] || 0);
    const totalBudget = needs + wants;
    const left = income - totalBudget - savings - debt;

    const bar = (label, val, cap, cls) => {
      const pct = income ? Math.min(100, (val / income) * 100) : 0;
      const capPct = income ? (cap / income) * 100 : 0;
      return el("div", { class: "bp-bar-row" }, [
        el("span", { class: "bp-bar-row__lab", text: `${label} · ${formatMoney(val)}` }),
        el(
          "div",
          { class: "bp-bar" },
          [
            el("div", { class: `bp-bar__fill bp-bar__fill--${cls}`, style: `--w:${pct}%` }),
            cap ? el("span", { class: "bp-bar__cap", style: `--l:${Math.min(100, capPct)}%` }) : null,
          ].filter(Boolean)
        ),
      ]);
    };

    holder.innerHTML = "";
    holder.append(bar("Essenziali", needs, income * 0.5, "need"));
    holder.append(bar("Sfizi", wants, income * 0.3, "want"));
    if (debt > 0) holder.append(bar("Rate e debiti", debt, 0, "debt"));
    holder.append(bar("Risparmio", savings, income * 0.2, "save"));
    holder.append(
      el(
        "div",
        {
          class: `bp-verdict bp-verdict--${left < -1 ? "bad" : left > income * 0.05 ? "warn" : "good"}`,
        },
        [
          el("span", {
            class: "icn-wrap",
            html: icon(left < -1 ? "alert" : left > income * 0.05 ? "info" : "check", { size: 15 }),
          }),
          el("span", { text: verdictText(left, income, totalBudget, savings) }),
        ]
      )
    );
    const btn = mount.querySelector("#bp-create");
    if (btn) btn.disabled = totalBudget <= 0;
  }

  function verdictText(left, income, totalBudget, savings) {
    if (left < -1) {
      if (S._p?._tight) {
        return `Con ${formatMoney(income)} di reddito, anche riducendo tutto ai minimi realistici il budget sfora di ${formatMoney(-left)}. Le strade da esperto: aumentare le entrate, ridurre una spesa fissa pesante (affitto/rata) o abbassare la quota di risparmio.`;
      }
      return `Sfori il reddito di ${formatMoney(-left)}. Comprimi prima gli sfizi, poi eventualmente la quota di risparmio; le voci fisse (affitto, rate, bollette) lasciale sul valore reale.`;
    }
    if (left > income * 0.05) {
      const extra =
        S.goal === "debiti"
          ? "puoi destinarli a versamenti extra sui debiti"
          : S.goal === "emergenza" || S.emergencyFund === false
            ? "mettili nel fondo di emergenza finché non copre 3–6 mesi di spese"
            : "puoi aumentare il risparmio o un budget";
      return `Ti restano ${formatMoney(left)} non assegnati: ${extra}.`;
    }
    return `Budget equilibrato: ${formatMoney(totalBudget)} di spese + ${formatMoney(savings)} di risparmio.`;
  }

  async function create() {
    const btn = mount.querySelector("#bp-create");
    if (btn) {
      btn.disabled = true;
      btn.classList.add("is-loading");
    }
    const byName = new Map(expenseCats.map((c) => [c.name, c.id]));
    let ok = 0;
    try {
      for (const name of S.selected) {
        const amount = S.amounts[name] || 0;
        if (amount <= 0) continue;
        const row = await budgetApi.upsert({ category_id: byName.get(name), monthly_limit: amount });
        // Aggiornamento ottimistico: il realtime confermerà.
        if (row && row.id) {
          const i = state.budgets.findIndex((b) => b.id === row.id || b.category_id === row.category_id);
          if (i > -1) state.budgets[i] = row;
          else state.budgets.push(row);
        }
        ok++;
      }
      toast(ok === 1 ? "1 budget creato" : `${ok} budget creati`, "success");
      onDone?.({ created: ok });
    } catch (err) {
      toast(err.message || "Errore nella creazione dei budget", "error");
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("is-loading");
      }
    }
  }

  function moneyField(value, onInput, placeholder) {
    return el("div", { class: "bp-money" }, [
      el("input", {
        type: "number",
        inputmode: "decimal",
        min: "0",
        step: "10",
        value,
        placeholder: placeholder || "",
        oninput: (e) => onInput(e.target.value),
      }),
      el("span", { class: "bp-money__cur", text: "€" }),
    ]);
  }

  function tip(text) {
    return el("div", { class: "bp-tip" }, [
      el("span", { class: "icn-wrap", html: icon("lightbulb", { size: 15 }) }),
      el("span", { text }),
    ]);
  }

  draw();
}
