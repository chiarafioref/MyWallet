// Shared utilities: DOM, formatting, toasts, modals, animations.
import { icon } from "./icons.js";

/* ---------- DOM ---------- */
export const qs = (sel, root = document) => root.querySelector(sel);

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

/* ---------- Formatting ---------- */
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

// Normalised transaction title: always UPPERCASE, whitespace collapsed.
// Applied on save so every transaction looks uniform across the app.
export const normalizeTitle = (s) =>
  s == null ? s : String(s).trim().replace(/\s+/g, " ").toLocaleUpperCase("it-IT");

export function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// Local date (not UTC) in YYYY-MM-DD format.
export const dateISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayISO = () => dateISO(new Date());
export const monthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export const isSameMonth = (dateStr, ref = new Date()) =>
  monthKey(new Date(dateStr)) === monthKey(ref);

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

/* ---------- Modal ---------- */
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

export function closeModal(onClose) {
  const overlay = qs("#app-modal");
  if (!overlay) return;
  document.removeEventListener("keydown", escToClose);
  document.dispatchEvent(new Event("app:closepopups"));
  overlay.classList.remove("is-open");
  setTimeout(() => overlay.remove(), 250);
  if (typeof onClose === "function") onClose();
}

/* ---------- Animated counter ---------- */
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

/* ---------- Minimal emitter ---------- */
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

/* ---------- Empty state ---------- */
// `name` is the name of an icon (see icons.js).
export const emptyState = (name, text) =>
  el("div", { class: "empty-state" }, [
    el("div", { class: "empty-state__icon", html: icon(name, { size: 34, stroke: 1.6 }) }),
    el("p", { text }),
  ]);

/* ---------- Debounce ---------- */
export function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}
