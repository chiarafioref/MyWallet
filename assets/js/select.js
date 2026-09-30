// Select personalizzata: sostituisce l'aspetto del menu nativo mantenendo il vero <select>
// nel DOM, così serializzazione del form, validazione ed eventi change/input restano invariati.
import { el } from "./utils.js";
import { icon } from "./icons.js";

let current = null;

function closeCurrent() {
  if (current) {
    current.close();
    current = null;
  }
}

document.addEventListener("click", (e) => {
  if (current && !current.root.contains(e.target) && !current.menu.contains(e.target)) closeCurrent();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && current) {
    const t = current.trigger;
    closeCurrent();
    t?.focus();
  }
});
document.addEventListener("app:closepopups", closeCurrent);

export function enhanceSelect(select) {
  if (!select || select.dataset.enhanced === "1") return;
  select.dataset.enhanced = "1";

  const root = el("div", { class: "sel" });
  select.parentNode.insertBefore(root, select);
  root.appendChild(select);
  select.classList.add("sel__native");
  select.setAttribute("tabindex", "-1");
  select.setAttribute("aria-hidden", "true");

  const valueEl = el("span", { class: "sel__value" });
  const trigger = el(
    "button",
    {
      type: "button",
      class: "sel__trigger",
      "aria-haspopup": "listbox",
      "aria-expanded": "false",
    },
    [valueEl, el("span", { class: "sel__chevron", html: icon("chevronDown", { size: 16 }) })]
  );
  const menu = el("div", { class: "sel__menu", role: "listbox" });
  root.append(trigger, menu);

  let opts = [];
  let active = -1;
  let openedAt = 0;

  function buildMenu() {
    menu.innerHTML = "";
    opts = [];
    for (const node of select.children) {
      if (node.tagName === "OPTGROUP") {
        menu.appendChild(el("div", { class: "sel__group", text: node.label }));
        [...node.children].forEach(addOpt);
      } else if (node.tagName === "OPTION") {
        addOpt(node);
      }
    }
  }
  function addOpt(optionEl) {
    const item = el("div", { class: "sel__opt", role: "option", "data-v": optionEl.value }, [
      el("span", { class: "sel__opt-label", text: optionEl.textContent }),
      el("span", { class: "sel__opt-check", html: icon("check", { size: 14 }) }),
    ]);
    item.addEventListener("click", () => choose(optionEl.value));
    menu.appendChild(item);
    opts.push({ el: item, value: optionEl.value });
  }

  function syncTrigger() {
    const o = select.options[select.selectedIndex];
    valueEl.textContent = o ? o.textContent : "";
    trigger.classList.toggle("is-empty", !o || o.value === "");
    opts.forEach((x) => x.el.classList.toggle("is-selected", x.value === select.value));
  }

  function choose(value) {
    if (select.value !== value) {
      select.value = value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    syncTrigger();
    close();
    trigger.focus();
  }

  function highlight() {
    opts.forEach((o, i) => o.el.classList.toggle("is-active", i === active));
    opts[active]?.el.scrollIntoView({ block: "nearest" });
  }

  function position() {
    const r = trigger.getBoundingClientRect();
    const room = window.innerHeight - r.bottom;
    const h = Math.min(menu.scrollHeight + 2, 280);
    const up = room < h + 12 && r.top > room;
    menu.classList.toggle("sel__menu--up", up);
    menu.style.left = `${r.left}px`;
    menu.style.width = `${r.width}px`;
    if (up) {
      menu.style.top = "auto";
      menu.style.bottom = `${window.innerHeight - r.top + 6}px`;
    } else {
      menu.style.bottom = "auto";
      menu.style.top = `${r.bottom + 6}px`;
    }
  }

  function open() {
    if (select.disabled) return;
    closeCurrent();
    buildMenu();
    syncTrigger();
    root.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    // Il menu esce dalla modale (che ha un transform) per non essere tagliato.
    document.body.appendChild(menu);
    position();
    void menu.offsetWidth;
    menu.classList.add("is-open");
    active = Math.max(
      0,
      opts.findIndex((o) => o.value === select.value)
    );
    highlight();
    openedAt = Date.now();
    current = { root, menu, trigger, close };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
  }
  function close() {
    root.classList.remove("is-open");
    menu.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", close);
    if (menu.parentNode === document.body) root.appendChild(menu);
    if (current && current.root === root) current = null;
  }
  const onScroll = (e) => {
    // Ignora lo scroll causato dall'apertura e quello interno al menu.
    if (Date.now() - openedAt < 180) return;
    if (e.target && e.target.nodeType === 1 && menu.contains(e.target)) return;
    close();
  };

  trigger.addEventListener("click", () => (root.classList.contains("is-open") ? close() : open()));
  trigger.addEventListener("keydown", (e) => {
    const isOpen = root.classList.contains("is-open");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) return open();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length;
      highlight();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!isOpen) return open();
      if (opts[active]) choose(opts[active].value);
    } else if (e.key === "Tab" && isOpen) {
      close();
    } else if (/^[a-z0-9]$/i.test(e.key) && isOpen) {
      const i = opts.findIndex(
        (o, idx) => idx > active && o.el.textContent.trim().toLowerCase().startsWith(e.key.toLowerCase())
      );
      const j =
        i > -1 ? i : opts.findIndex((o) => o.el.textContent.trim().toLowerCase().startsWith(e.key.toLowerCase()));
      if (j > -1) {
        active = j;
        highlight();
      }
    }
  });
  menu.addEventListener("mousemove", (e) => {
    const opt = e.target.closest(".sel__opt");
    if (!opt) return;
    const i = opts.findIndex((o) => o.el === opt);
    if (i > -1 && i !== active) {
      active = i;
      highlight();
    }
  });

  // Aggiornamenti programmatici del <select> (reset filtri, campi condizionali).
  select.addEventListener("change", syncTrigger);
  select.addEventListener("sel:sync", syncTrigger);

  buildMenu();
  syncTrigger();
}
