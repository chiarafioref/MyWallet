// Settings section.
import { state, applyTheme } from "../store.js";
import { profile as profileApi, categories as catApi } from "../data.js";
import { buildForm } from "../form.js";
import { signOut } from "../auth.js";
import { setCurrency, el, toast, openModal, closeModal } from "../utils.js";
import { icon, iconEl } from "../icons.js";

export function render(container) {
  container.innerHTML = "";
  const p = state.profile;

  const profileForm = buildForm(
    [
      { name: "first_name", label: "Nome", value: p.first_name },
      { name: "last_name", label: "Cognome", value: p.last_name },
      { name: "theme", label: "Tema", type: "select", value: p.theme, options: [
        { value: "light", label: "Chiaro" }, { value: "dark", label: "Scuro" },
      ]},
      { name: "currency", label: "Valuta", type: "select", value: p.currency, options: [
        { value: "EUR", label: "Euro (€)" }, { value: "USD", label: "Dollaro ($)" },
        { value: "GBP", label: "Sterlina (£)" }, { value: "CHF", label: "Franco (CHF)" },
      ]},
    ],
    {
      submitLabel: "Salva impostazioni",
      onSubmit: async (v) => {
        try {
          const updated = await profileApi.update(v);
          state.profile = updated;
          setCurrency(updated.currency);
          applyTheme(updated.theme);
          toast("Impostazioni salvate", "success");
        } catch (err) {
          toast(err.message, "error");
        }
      },
    }
  );

  const passwordForm = buildForm(
    [{ name: "password", label: "Nuova password", type: "password", required: true, hint: "Minimo 6 caratteri" }],
    {
      submitLabel: "Aggiorna password",
      onSubmit: async (v, form) => {
        if (v.password.length < 6) return toast("Password troppo corta", "error");
        try {
          await profileApi.updatePassword(v.password);
          form.reset();
          toast("Password aggiornata", "success");
        } catch (err) {
          toast(err.message, "error");
        }
      },
    }
  );

  const view = el("div", { class: "view settings" }, [
    el("h2", { text: "Impostazioni" }),

    section("Profilo", profileForm),
    section("Password", passwordForm),
    section("Categorie personalizzate", customCategories()),

    section(
      "Account",
      el("div", { class: "settings-danger" }, [
        el("button", { class: "btn btn--ghost", onclick: async () => { await signOut(); } }, "Esci"),
        el("button", { class: "btn btn--danger", onclick: confirmDelete }, "Elimina account"),
      ])
    ),
  ]);
  container.append(view);
}

function section(title, content) {
  return el("section", { class: "card glass" }, [el("h3", { text: title }), content]);
}

function customCategories() {
  const custom = state.categories.filter((c) => !c.is_default);
  return el("div", {}, [
    el("button", { class: "btn btn--primary btn--sm", onclick: addCategoryModal }, [iconEl("plus", { size: 16 }), "Nuova categoria"]),
    custom.length
      ? el("ul", { class: "chip-list" }, custom.map((c) =>
          el("li", { class: "chip" }, [
            el("span", { text: `${c.name} · ${c.kind === "income" ? "entrata" : "uscita"}` }),
            el("button", { class: "chip__x", "aria-label": "Elimina categoria", html: icon("close", { size: 14 }), onclick: async () => {
              if (!confirm(`Eliminare "${c.name}"?`)) return;
              try { await catApi.remove(c.id); toast("Categoria eliminata", "success"); }
              catch (err) { toast(err.message, "error"); }
            }}),
          ])
        ))
      : el("p", { class: "muted", text: "Nessuna categoria personalizzata" }),
  ]);
}

function addCategoryModal() {
  const body = buildForm(
    [
      { name: "name", label: "Nome categoria", required: true },
      { name: "kind", label: "Tipo", type: "select", value: "expense", options: [
        { value: "expense", label: "Uscita" }, { value: "income", label: "Entrata" },
      ]},
    ],
    {
      submitLabel: "Crea categoria",
      onSubmit: async (v) => {
        try {
          await catApi.create({ name: v.name.toUpperCase(), kind: v.kind });
          closeModal();
          toast("Categoria creata", "success");
        } catch (err) {
          toast(err.message, "error");
        }
      },
    }
  );
  openModal({ title: "Nuova categoria", body });
}

function confirmDelete() {
  const body = el("div", {}, [
    el("p", { text: "Questa azione elimina tutti i tuoi dati (transazioni, budget, risparmi…). L'operazione è irreversibile." }),
    el("div", { class: "settings-danger" }, [
      el("button", { class: "btn btn--ghost", onclick: () => closeModal() }, "Annulla"),
      el("button", { class: "btn btn--danger", onclick: async () => {
        try {
          await profileApi.deleteData();
          toast("Dati eliminati. Disconnessione…", "success");
          setTimeout(() => signOut(), 1200);
        } catch (err) {
          toast(err.message, "error");
        }
      }}, "Elimina definitivamente"),
    ]),
  ]);
  openModal({ title: "Eliminare l'account?", body });
}
