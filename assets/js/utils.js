import { icon } from "./icons.js";

/* ---------- DOM ---------- */
export const qs = (sel, root = document) => root.querySelector(sel);

/**
 * Crea un elemento DOM.
 * Attributi speciali: `class`, `text` (textContent), `html` (innerHTML: solo markup
 * fidato, mai dati dell'utente), `onXxx` (listener). I valori null/false sono ignorati.
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v !== null && v !== undefined && v !== false) {
      node.setAttribute(k, v);
    }
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/* ---------- Testo ---------- */

// Titoli e nomi vengono salvati in sentence case con gli spazi compattati.
export const normalizeTitle = (s) => {
  if (s == null) return s;
  const t = String(s).trim().replace(/\s+/g, " ");
  if (!t) return t;
  return t.charAt(0).toLocaleUpperCase("it-IT") + t.slice(1).toLocaleLowerCase("it-IT");
};

// Confronto case-insensitive (es. nomi di categoria).
export const sameText = (a, b) =>
  String(a ?? "").toLocaleLowerCase("it-IT") === String(b ?? "").toLocaleLowerCase("it-IT");

/* ---------- Formattazione ---------- */
let currency = "EUR";
export const setCurrency = (c) => (currency = c || "EUR");

export function formatMoney(value, { sign = false } = {}) {
  const n = Number(value) || 0;
  const formatted = new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(Math.abs(n));
  if (sign) return (n >= 0 ? "+ " : "− ") + formatted;
  return (n < 0 ? "− " : "") + formatted;
}

export function formatDate(value) {
  if (!value) return "";
  return parseDate(value).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/* ---------- Date ---------- */

/**
 * Converte una data in `Date`. Le stringhe "YYYY-MM-DD" (colonne `date` di Postgres)
 * sono interpretate in ora locale: `new Date("2026-03-01")` userebbe UTC e, nei fusi
 * a ovest di Greenwich, restituirebbe il giorno precedente.
 */
export function parseDate(value) {
  if (value instanceof Date) return new Date(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(value);
}

export const dateISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayISO = () => dateISO(new Date());
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export const isSameMonth = (dateStr, ref = new Date()) => monthKey(parseDate(dateStr)) === monthKey(ref);

// Mesi interi compresi tra due date (negativo se b precede a).
export function monthsBetween(a, b) {
  const m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  return b.getDate() >= a.getDate() ? m : m - 1;
}

/* ---------- Toast ---------- */
export function toast(message, type = "info") {
  let holder = qs("#toast-holder");
  if (!holder) {
    holder = el("div", { id: "toast-holder", class: "toast-holder" });
    document.body.append(holder);
  }
  const node = el("div", { class: `toast toast--${type}`, text: message });
  holder.append(node);
  requestAnimationFrame(() => node.classList.add("is-visible"));
  setTimeout(() => {
    node.classList.remove("is-visible");
    setTimeout(() => node.remove(), 300);
  }, 3200);
}

/* ---------- Modale ---------- */
export function openModal({ title, body, onClose }) {
  closeModal();
  const overlay = el("div", { class: "modal-overlay", id: "app-modal" });
  const modal = el("div", { class: "modal glass" }, [
    el("div", { class: "modal__head" }, [
      el("h3", { text: title || "" }),
      el("button", {
        class: "icon-btn",
        "aria-label": "Chiudi",
        html: icon("close", { size: 20 }),
        onclick: () => closeModal(onClose),
      }),
    ]),
    el("div", { class: "modal__body" }, [body]),
  ]);
  overlay.append(modal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal(onClose);
  });
  document.addEventListener("keydown", escToClose);
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add("is-open"));
  return { overlay, modal, close: () => closeModal(onClose) };
}

function escToClose(e) {
  if (e.key === "Escape") closeModal();
}

// Sostituisce window.confirm(), che nelle web app installate su iOS viene soppresso.
export function confirmDialog(
  message,
  { title = "Conferma", confirmLabel = "Elimina", cancelLabel = "Annulla", danger = true } = {}
) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey);
      closeModal();
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === "Escape") finish(false);
    };
    document.addEventListener("keydown", onKey);

    const body = el("div", { class: "confirm-dialog" }, [
      el("p", { class: "confirm-dialog__text", text: message }),
      el("div", { class: "confirm-dialog__actions" }, [
        el("button", { type: "button", class: "btn btn--ghost", onclick: () => finish(false) }, cancelLabel),
        el(
          "button",
          { type: "button", class: `btn ${danger ? "btn--danger" : "btn--primary"}`, onclick: () => finish(true) },
          confirmLabel
        ),
      ]),
    ]);
    openModal({ title, body, onClose: () => finish(false) });
  });
}

export function closeModal(onClose) {
  const overlay = qs("#app-modal");
  if (!overlay) return;
  document.removeEventListener("keydown", escToClose);
  document.dispatchEvent(new Event("app:closepopups"));
  overlay.classList.remove("is-open");
  setTimeout(() => overlay.remove(), 250);
  if (typeof onClose === "function") onClose();
}

/* ---------- Contatore animato ---------- */
export function animateCounter(node, to, { format = formatMoney, duration = 700 } = {}) {
  const from = Number(node.dataset.value || 0);
  const start = performance.now();
  node.dataset.value = to;
  function tick(now) {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    node.textContent = format(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ---------- Event emitter ---------- */
export function createEmitter() {
  const map = new Map();
  return {
    on(evt, cb) {
      if (!map.has(evt)) map.set(evt, new Set());
      map.get(evt).add(cb);
      return () => map.get(evt)?.delete(cb);
    },
    emit(evt, payload) {
      map.get(evt)?.forEach((cb) => cb(payload));
    },
  };
}

/* ---------- Varie ---------- */
export const emptyState = (iconName, text) =>
  el("div", { class: "empty-state" }, [
    el("div", { class: "empty-state__icon", html: icon(iconName, { size: 34, stroke: 1.6 }) }),
    el("p", { text }),
  ]);

export function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}
