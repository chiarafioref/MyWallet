# MyWallet — Setup

## 1. Database Supabase

1. Crea un progetto su [supabase.com](https://supabase.com).
2. Apri **SQL Editor** → incolla ed esegui l'intero contenuto di [`DB.sql`](DB.sql).
   Crea tabelle, funzioni, trigger, policy RLS e attiva il Realtime. È idempotente:
   si può rieseguire in sicurezza.
3. **Authentication → Providers → Email**: per una demo puoi disattivare
   *"Confirm email"* così il login è immediato dopo la registrazione. Per un
   deploy pubblico valuta di lasciarlo attivo o di usare un account demo.

## 2. Configurazione client

I valori del progetto stanno in [`assets/js/config.js`](assets/js/config.js)
(**Project Settings → API**). Sono valori **pubblici** (URL + chiave *publishable*):
a proteggere i dati è la Row Level Security, non la segretezza della chiave.

```js
export const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_xxxxxxxx";
export const AI_ASSISTANT_ENABLED = true; // vedi sezione 3
```

## 3. Assistente AI (Mistral) — Supabase Edge Function

L'assistente funziona anche **senza AI** (interprete locale, offline). Per
abilitare le risposte generate da Mistral, la chiamata all'API passa da una
**Supabase Edge Function** ([`supabase/functions/chat-ai`](supabase/functions/chat-ai/index.ts)):
la API key vive **solo** come Secret lato server e non finisce mai nel browser.

### 3.1 CLI

```bash
npm install -g supabase
supabase login
supabase link --project-ref <project-ref>   # Project Settings → General
```

### 3.2 Secret con la API key di Mistral

Crea la chiave su <https://console.mistral.ai/> (imposta un **limite di spesa**), poi:

```bash
supabase secrets set MISTRAL_API_KEY=la_tua_chiave_mistral
# opzionali:
supabase secrets set MISTRAL_MODEL=mistral-small-latest
supabase secrets set ALLOWED_ORIGIN=https://<utente>.github.io   # CORS in produzione
```

Verifica con `supabase secrets list`.

### 3.3 Deploy

```bash
supabase functions deploy chat-ai
```

> `verify_jwt = true` (in [`supabase/config.toml`](supabase/config.toml)): solo
> gli utenti autenticati possono invocare la funzione. `functions.invoke()`
> allega automaticamente il JWT della sessione.

### 3.4 Attivazione

In `assets/js/config.js` metti `AI_ASSISTANT_ENABLED = true`. Se lo lasci `false`,
o se la funzione non è raggiungibile, l'app usa l'interprete locale.

### 3.5 Test locale della funzione (facoltativo)

```bash
supabase functions serve chat-ai --env-file supabase/.env
# supabase/.env  ->  MISTRAL_API_KEY=...
```

## 4. Avvio in locale

Il progetto usa ES Modules: serve un server locale (non aprire con `file://`).

```bash
npx serve .
# oppure
python -m http.server 5500
```

## 5. Pubblicazione su GitHub Pages

1. `assets/js/config.js` è **committato** (contiene solo valori pubblici).
2. Repo → **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch `main`, cartella `/ (root)`.
3. Il sito sarà su `https://<utente>.github.io/<repo>/`. I path in `index.html`
   sono relativi e il routing usa `location.hash`, quindi funziona sotto sotto-cartella.
4. Imposta il Secret `ALLOWED_ORIGIN` della Edge Function sull'URL di GitHub Pages.

## 6. Come testare che tutto funzioni

1. Registrati / accedi.
2. **Assistente finanziario**: l'intestazione mostra *"AI attiva"*.
3. Fai una domanda (es. *"Quanto ho speso per i ristoranti questo mese?"*):
   la risposta ha il badge **AI**.
4. Console del browser: nessun warning `[assistant] AI unavailable…`.
5. Supabase → **Edge Functions → chat-ai → Logs**: si vedono le invocazioni.
6. Nessuna richiesta a `api.mistral.ai` nel tab Network del browser (solo
   `/functions/v1/chat-ai`).
7. Controprova: `AI_ASSISTANT_ENABLED = false` → l'assistente risponde comunque
   (interprete locale, badge *"assistente"*).

## 7. Struttura

```
index.html
DB.sql                       -- schema Supabase completo (tabelle + RLS + realtime + trigger)
assets/
  css/style.css              -- design system, temi chiaro/scuro, animazioni
  js/
    config.js                -- URL + anon key + flag AI (valori pubblici, committato)
    config.example.js         -- template di config
    supabaseClient.js         -- crea "supabaseClient"
    app.js                    -- bootstrap, router, layout, realtime
    auth.js                   -- signup / login / sessione + schermata auth
    store.js                  -- stato centrale, caricamento dati, channel realtime
    data.js                   -- wrapper CRUD su Supabase
    form.js                   -- form con validazione in tempo reale
    chart.js                  -- grafici SVG (nessuna libreria)
    recurring.js              -- generazione automatica transazioni ricorrenti
    subscriptions.js          -- generazione automatica spese da abbonamento
    utils.js                  -- DOM, formattazione, toast, modali, contatori
    assistant/
      ai-client.js            -- client browser: invoca la Edge Function "chat-ai"
      interpreter.js           -- linguaggio naturale -> spec di ricerca (AI o regole locali)
      engine.js                -- esegue la spec sui dati e costruisce la risposta
      budget-planner.js        -- wizard budget 50/30/20 (nessuna AI)
    views/
      dashboard.js  transactions.js  budgets.js    savings.js   future.js
      trips.js      stats.js         analysis.js   settings.js   assistant.js
      availability.js  subscriptions.js
supabase/
  config.toml                -- config progetto + verify_jwt della funzione
  functions/chat-ai/
    index.ts                  -- proxy autenticato verso l'API di Mistral
```

## Note

- **Realtime**: un solo `supabaseClient.channel("mywallet")` con listener
  `postgres_changes` filtrati per `user_id`; i viaggi hanno un channel dedicato.
- **RLS**: ogni utente vede solo i propri dati. Le sezioni "IN VIAGGIO" usano
  funzioni `SECURITY DEFINER` (`is_trip_member`, `join_trip`) per la condivisione.
- **Sicurezza AI**: la chiave Mistral non è nel bundle del browser. Il client
  invoca `chat-ai` con il JWT dell'utente; la funzione aggiunge la chiave e
  inoltra la richiesta a Mistral.
- **Trasferimenti**: un trigger (`check_transfer_balance`) impedisce di spostare
  più denaro di quello disponibile sul metodo di partenza.
- **Elimina account**: `delete_my_data()` rimuove i dati applicativi. La
  cancellazione della riga in `auth.users` richiede una Edge Function con
  `service_role`.
- **Transazioni ricorrenti / abbonamenti**: generati automaticamente all'avvio
  dell'app dai rispettivi "template".
