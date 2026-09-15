// Lightweight suggestions dropdown for a text <input>: shows a filterable
// list of candidate strings below the field as the user types, reusing the
// same look as the custom <select> menu (see select.js).
import { el } from "./utils.js";

let current = null; // { input, menu, close } of the currently open menu

function closeCurrent() {
  if (current) { current.close(); current = null; }
}
document.addEventListener("click", (e) => {
  if (current && !current.input.contains(e.target) && !current.menu.contains(e.target)) closeCurrent();
});
document.addEventListener("app:closepopups", closeCurrent);

// candidates: array of strings, already ranked (most relevant first).
export function enhanceAutocomplete(input, candidates) {
  if (!candidates || !candidates.length) return;
  input.setAttribute("autocomplete", "off");

  const menu = el("div", { class: "sel__menu ac-menu", role: "listbox" });
  let items = [];
  let active = -1;

  function matches() {
    const q = input.value.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => c.toLowerCase().includes(q));
  }

  function render(list) {
    menu.innerHTML = "";
    items = list.slice(0, 6).map((text) => {
      const opt = el("div", { class: "sel__opt", role: "option", text });
      opt.addEventListener("mousedown", (e) => { e.preventDefault(); choose(text); });
      menu.append(opt);
      return opt;
    });
    active = -1;
  }

  function position() {
    const r = input.getBoundingClientRect();
    menu.style.left = `${r.left}px`;
    menu.style.width = `${r.width}px`;
    menu.style.top = `${r.bottom + 6}px`;
  }

  function open() {
    const list = matches();
    if (!list.length) { close(); return; }
    if (!(current && current.input === input)) {
      closeCurrent();
      document.body.appendChild(menu);
      current = { input, menu, close };
      window.addEventListener("scroll", position, true);
      window.addEventListener("resize", position);
    }
    render(list);
    position();
    requestAnimationFrame(() => menu.classList.add("is-open"));
  }

  function close() {
    menu.classList.remove("is-open");
    window.removeEventListener("scroll", position, true);
    window.removeEventListener("resize", position);
    menu.remove();
    if (current && current.input === input) current = null;
  }

  function choose(text) {
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    close();
    input.focus();
  }

  function highlight() {
    items.forEach((it, i) => it.classList.toggle("is-active", i === active));
    items[active]?.scrollIntoView({ block: "nearest" });
  }

  input.addEventListener("focus", open);
  input.addEventListener("input", open);
  input.addEventListener("keydown", (e) => {
    const isOpen = menu.classList.contains("is-open");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!isOpen) return;
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      highlight();
    } else if (e.key === "Enter") {
      if (isOpen && active > -1) { e.preventDefault(); choose(items[active].textContent); }
    } else if (e.key === "Escape" || e.key === "Tab") {
      close();
    }
  });
}
