// Helper to build forms with real-time validation.
import { el } from "./utils.js";
import { enhanceSelect } from "./select.js";

// Two-option fields rendered as a segmented control instead of a dropdown.
const SEG_FIELDS = new Set(["type", "payment_method", "theme", "kind"]);

// fields: [{ name, label, type, required, value, options, min, step, placeholder, hint, showIf }]
//   showIf: "checkboxName"                       -> visible when that toggle is on
//   showIf: { field: "frequency", value: "X" }   -> visible when that field equals X
//                                                    (value may also be an array)
//   a select's options may be grouped: { label: "Group", options: [...] }
export function buildForm(fields, { submitLabel = "Salva", onSubmit }) {
  const form = el("form", { class: "app-form", novalidate: true });
  const conditional = [];

  fields.forEach((f, idx) => {
    // Toggle for boolean fields.
    if (f.type === "checkbox") {
      const node = switchField(f);
      node.style.setProperty("--i", idx);
      form.append(node);
      return;
    }

    // Binary choice: segmented control instead of a dropdown.
    const flatOpts = f.type === "select" && Array.isArray(f.options) && !f.options.some((o) => o && o.options) ? f.options : null;
    const autoSeg = f.type === "select" && flatOpts && flatOpts.length === 2 && !f.showIf
      && (f.segmented !== false) && SEG_FIELDS.has(f.name);
    if (f.type === "segmented" || f.segmented === true || autoSeg) {
      const node = segmentedField({ ...f, options: flatOpts || f.options });
      node.style.setProperty("--i", idx);
      form.append(node);
      return;
    }

    const controlAttrs = {
      name: f.name,
      type: f.type === "textarea" || f.type === "select" ? null : f.type || "text",
      required: f.required || null,
      value: f.value ?? null,
      min: f.min ?? null,
      step: f.step ?? null,
      placeholder: f.placeholder ?? null,
    };

    let control;
    if (f.type === "select") {
      control = el(
        "select",
        { name: f.name, required: f.required || null },
        selectChildren(f.options || [], f.value)
      );
    } else if (f.type === "textarea") {
      control = el("textarea", { name: f.name, rows: 3, placeholder: f.placeholder ?? null }, f.value ?? "");
    } else {
      control = el("input", controlAttrs);
    }

    const field = el("div", { class: `field${f.showIf ? " field--conditional" : ""}`, style: `--i:${idx}` }, [
      el("label", {}, f.label),
      control,
      f.hint ? el("span", { class: "field-hint", text: f.hint }) : null,
      el("span", { class: "field-error" }),
    ]);

    control.addEventListener("input", () => validate(control));
    control.addEventListener("blur", () => validate(control));
    form.append(field);
    if (f.showIf) conditional.push({ field, control, showIf: f.showIf });
  });

  const submit = el("button", { type: "submit", class: "btn btn--primary btn--block", style: `--i:${fields.length}` }, submitLabel);
  form.append(submit);

  // Conditional fields: show/hide based on a toggle or another field's value.
  for (const { field, control, showIf } of conditional) {
    const isToggle = typeof showIf === "string";
    const triggerName = isToggle ? showIf : showIf.field;
    const trigger = form.querySelector(`[name="${triggerName}"]`);
    const wanted = isToggle ? null : (Array.isArray(showIf.value) ? showIf.value : [showIf.value]);
    const matches = () => (isToggle ? !!trigger?.checked : wanted.includes(trigger?.value));
    const sync = () => {
      const on = matches();
      field.classList.toggle("is-visible", on);
      if (!on && control.type !== "checkbox") { control.value = ""; validate(control); }
    };
    trigger?.addEventListener("change", sync);
    trigger?.addEventListener("input", sync);
    sync();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const controls = [...form.querySelectorAll("input, select, textarea")];
    if (!controls.map(validate).every(Boolean)) return;

    const values = {};
    for (const c of controls) {
      if (c.type === "checkbox") values[c.name] = c.checked;
      else if (c.type === "number") values[c.name] = c.value === "" ? null : Number(c.value);
      else values[c.name] = c.value.trim?.() ?? c.value;
    }
    submit.disabled = true;
    submit.classList.add("is-loading");
    try {
      await onSubmit(values, form);
    } finally {
      submit.disabled = false;
      submit.classList.remove("is-loading");
    }
  });

  form.querySelectorAll("select").forEach(enhanceSelect);
  return form;
}

// <select> options, with group support ({ label, options: [...] }).
function selectChildren(options, value) {
  const opt = (o) =>
    el("option", { value: o.value, selected: String(o.value) === String(value) || null }, o.label);
  return options.map((o) =>
    o.options ? el("optgroup", { label: o.label }, o.options.map(opt)) : opt(o)
  );
}

// Segmented control for a few-option choice (e.g. Uscita / Entrata).
// A real hidden input holds the value and propagates change/input events.
const SEG_TONE = {
  USCITA: "out", ENTRATA: "in", expense: "out", income: "in",
  CARTA: "neutral", CONTANTI: "neutral",
};
function segmentedField(f) {
  const opts = f.options;
  const initial = f.value != null && opts.some((o) => String(o.value) === String(f.value))
    ? String(f.value) : String(opts[0].value);
  const input = el("input", { type: "hidden", name: f.name, value: initial });

  const setVal = (v) => {
    if (input.value === String(v)) return;
    input.value = String(v);
    group.querySelectorAll(".seg-field__btn").forEach((b) => b.classList.toggle("is-on", b.dataset.v === String(v)));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const group = el("div", { class: `seg-field seg-field--n${opts.length}`, role: "radiogroup" }, [
    input,
    ...opts.map((o) => {
      const tone = o.tone || SEG_TONE[o.value] || "neutral";
      return el("button", {
        type: "button",
        class: `seg-field__btn seg-field__btn--${tone}${String(o.value) === initial ? " is-on" : ""}`,
        "data-v": String(o.value),
        role: "radio",
        "aria-checked": String(String(o.value) === initial),
        onclick: () => setVal(o.value),
      }, [el("span", { class: "seg-field__dot" }), el("span", { class: "seg-field__lab", text: o.label })]);
    }),
  ]);

  return el("div", { class: "field field--seg" }, [
    el("label", {}, f.label),
    group,
    f.hint ? el("span", { class: "field-hint", text: f.hint }) : null,
  ]);
}

// Toggle field: whole <label> clickable, real input hidden, animated track + thumb.
function switchField(f) {
  const input = el("input", {
    class: "switch__input",
    type: "checkbox",
    name: f.name,
    checked: f.value ? "checked" : null,
  });
  const wrap = el("label", { class: `switch-field${f.value ? " is-on" : ""}` }, [
    el("span", { class: "switch-field__text" }, [
      el("span", { class: "switch-field__label", text: f.label }),
      f.hint ? el("span", { class: "switch-field__hint", text: f.hint }) : null,
    ]),
    el("span", { class: "switch" }, [
      input,
      el("span", { class: "switch__track" }),
      el("span", { class: "switch__thumb" }),
    ]),
  ]);
  input.addEventListener("change", () => wrap.classList.toggle("is-on", input.checked));
  return wrap;
}

function validate(control) {
  if (control.type === "checkbox") return true;
  const wrap = control.closest(".field");
  const err = wrap?.querySelector(".field-error");
  let msg = "";
  const v = control.value.trim();
  if (control.required && !v) msg = "Campo obbligatorio";
  else if (control.type === "number" && v !== "") {
    const n = Number(v);
    if (Number.isNaN(n)) msg = "Numero non valido";
    else if (control.min !== "" && control.min != null && n < Number(control.min))
      msg = `Valore minimo ${control.min}`;
  } else if (control.type === "email" && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))
    msg = "Email non valida";
  wrap?.classList.toggle("has-error", !!msg);
  if (err) err.textContent = msg;
  return !msg;
}
