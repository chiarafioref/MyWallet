// Onboarding: slideshow introduttivo al primo accesso, saltabile e sempre
// riapribile dal menu. Lo stato "visto" è persistito su profiles.onboarding_completed.
import { el, qs, toast } from "./utils.js";
import { icon } from "./icons.js";
import { state } from "./store.js";
import { profile as profileApi } from "./data.js";

const SLIDES = [
  {
    icon: "sparkles",
    title: "Benvenuto in MyWallet",
    text: "Il tuo assistente per tenere sotto controllo entrate, uscite e obiettivi di risparmio, tutto in un unico posto.",
  },
  {
    icon: "dashboard",
    title: "Dashboard e Transazioni",
    text: "La Dashboard ti mostra il saldo e l'andamento del mese a colpo d'occhio. In Transazioni registri e consulti ogni movimento, in carta o contanti.",
  },
  {
    icon: "wallet",
    title: "Budget, Risparmi e Spese future",
    text: "Imposta un budget per categoria, crea obiettivi di risparmio e pianifica le spese future: MyWallet ti avvisa quando serve.",
  },
  {
    icon: "sparkles",
    title: "Assistente AI",
    text: "Fai domande in linguaggio naturale sulle tue finanze, ad esempio quanto hai speso in ristoranti questo mese: l'Assistente risponde analizzando i tuoi dati.",
  },
  {
    icon: "creditCard",
    title: "Disponibilità, Abbonamenti e Viaggi",
    text: "Controlla quanto hai davvero disponibile su carta e contanti, tieni traccia degli abbonamenti ricorrenti e gestisci le spese di gruppo In viaggio.",
  },
  {
    icon: "settings",
    title: "Impostazioni e tema",
    text: "Personalizza valuta, tema chiaro/scuro e i tuoi dati da Impostazioni. Puoi riaprire questa guida in qualsiasi momento dal menu laterale.",
  },
];

let idx = 0;

export function openOnboarding({ onFinish } = {}) {
  idx = 0;
  closeOnboarding();

  const overlay = el("div", { class: "onboarding-overlay", id: "onboarding-overlay" });
  const panel = el("div", { class: "onboarding-modal glass" });
  overlay.append(panel);

  const finish = async (completed) => {
    overlay.classList.remove("is-open");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => overlay.remove(), 250);
    if (completed && !state.profile?.onboarding_completed) {
      try {
        const updated = await profileApi.update({ onboarding_completed: true });
        state.profile = updated;
      } catch {
        // Offline: l'esperienza locale continua, si riproverà al prossimo salvataggio.
        state.profile = { ...state.profile, onboarding_completed: true };
      }
    }
    onFinish?.();
  };

  function renderSlide() {
    panel.innerHTML = "";
    const s = SLIDES[idx];
    const isFirst = idx === 0;
    const isLast = idx === SLIDES.length - 1;

    panel.append(
      el("button", {
        class: "onboarding-skip",
        onclick: () => { toast("Tutorial saltato", "info"); finish(true); },
        text: "Salta",
      }),
      el("div", { class: "onboarding-icon", html: icon(s.icon, { size: 40, stroke: 1.6 }) }),
      el("h3", { class: "onboarding-title", text: s.title }),
      el("p", { class: "onboarding-text", text: s.text }),
      el(
        "div",
        { class: "onboarding-dots" },
        SLIDES.map((_, i) => el("span", { class: `onboarding-dot${i === idx ? " is-active" : ""}` }))
      ),
      el("div", { class: "onboarding-actions" }, [
        el("button", {
          class: "btn btn--ghost",
          style: isFirst ? "visibility:hidden" : "",
          onclick: () => { idx--; renderSlide(); },
          text: "Indietro",
        }),
        el("button", {
          class: "btn btn--primary",
          onclick: () => {
            if (isLast) finish(true);
            else { idx++; renderSlide(); }
          },
          text: isLast ? "Inizia" : "Avanti",
        }),
      ])
    );
  }

  function onKey(e) {
    if (e.key === "Escape") finish(true);
  }
  document.addEventListener("keydown", onKey);

  renderSlide();
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add("is-open"));
}

export function closeOnboarding() {
  qs("#onboarding-overlay")?.remove();
}
