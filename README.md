# MyWallet

**Demo live:** https://chiarafioref.github.io/MyWallet/

## Descrizione

MyWallet è una web application per la gestione delle finanze personali, permette agli utenti di registrarsi, autenticarsi e monitorare entrate, uscite e statistiche del proprio portafoglio digitale.
L'autenticazione avviene tramite Supabase e i dati vengono aggiornati in tempo reale, un assistente virtuale basato su Mistral AI aiuta gli utenti ad analizzare le spese e a creare budget mensili personalizzati.

## Anteprima

<!-- Aggiungi il file docs/screenshots/demo.gif (vedi docs/screenshots/HOW-TO.md), poi togli i commenti.
![Demo di MyWallet](docs/screenshots/demo.gif)
-->
_Anteprima in arrivo — nel frattempo apri la [demo live](https://chiarafioref.github.io/MyWallet/)._

## Screenshot

<!-- Aggiungi i file in docs/screenshots/ (vedi docs/screenshots/HOW-TO.md), poi togli i commenti.
| Dashboard | Statistiche |
| :---: | :---: |
| ![Dashboard](docs/screenshots/dashboard.png) | ![Statistiche](docs/screenshots/statistiche.png) |

| Assistente AI | Consulente di budget |
| :---: | :---: |
| ![Assistente](docs/screenshots/assistente.png) | ![Budget](docs/screenshots/budget.png) |

| Spese di gruppo (viaggi) | Report mensile |
| :---: | :---: |
| ![Viaggi](docs/screenshots/viaggi.png) | ![Report](docs/screenshots/report.png) |
-->

## Funzionalità

- Registrazione e login tramite Supabase Authentication.
- Gestione di entrate e uscite.
- Storico delle transazioni.
- Filtri per categoria e data.
- Dashboard con statistiche.
- Aggiornamento in tempo reale.
- Dati isolati per ogni utente grazie alle Row Level Security.

## Tecnologie

- HTML5
- CSS3
- JavaScript (Vanilla)
- Supabase
- PostgreSQL
- Mistral AI API

## Assistente AI

La web application integra un assistente virtuale basato sui modelli di Mistral AI.
L'assistente permette di:

- rispondere alle domande dell'utente;
- fornire suggerimenti sulla gestione delle spese;
- aiutare nell'analisi del budget personale;
- offrire consigli personalizzati in base alle richieste dell'utente.

## Obiettivo del progetto

- Creare un account.
- Effettuare login.
- Sezione "IMPOSTAZIONI".
- Gestire il proprio portafoglio virtuale.
- Registrare entrate e uscite.
- Visualizzare il saldo aggiornato in tempo reale.
- Consultare lo storico delle transazioni.
- Filtrare le spese.
- Generare statistiche sull'utilizzo del denaro.
- Ogni utente può vedere solamente i suoi dati.
- L'utente può aggiungere, modificare, eliminare e visualizzare ogni transazione.
- Selezione del metodo di pagamento in entrata e in uscita (Contanti o Carta).
- Una barra di ricerca per titolo, categoria, importo e intervallo di date.
- Creazione di un budget mensile su misura per ogni categoria.
- Una sezione "IN VIAGGIO" progettata per semplificare la gestione delle spese di gruppo.
- Una sezione "RISPARMI" per aiutare l'utente a mettere dei soldi da parte.
- L'utente può aggiungere categorie di spesa personalizzabili.
- Una sezione "SPESE FUTURE" per pianificare le spese future di importo elevato, evitando di doverle pagare in un'unica soluzione.
- Analisi mensile con report su: quanto hai speso, quanto hai risparmiato, categoria con più spese, numero budget rispettati, obiettivi di risparmio raggiunti, consiglio su dove ridurre budget per risparmiare di più.

## Documentazione per singola sezione

- [DASHBOARD](docs/DASHBOARD.md)
- [GESTIONE TRANSAZIONI](docs/GESTIONETRANSAZIONI.md)
- [TRANSAZIONI RICORRENTI](docs/TRANSAZIONIRICORRENTI.md)
- [GESTIONE STATISTICHE](docs/GESTIONESTATISTICHE.md)
- [SEZIONE IN VIAGGIO](docs/SEZIONEINVIAGGIO.md)
- [SEZIONE RISPARMI](docs/SEZIONERISPARMI.md)
- [GESTIONE BUDGET](docs/GESTIONEBUDGET.md)
- [SPESE FUTURE](docs/SPESEFUTURE.md)
- [IMPOSTAZIONI](docs/IMPOSTAZIONI.md)
- [ASSISTENTE FINANZIARIO](docs/RICERCAINTELLIGENTE.md)
- [TRASFERIMENTO DENARO](docs/TRASFERIMENTODIDENARO.md)
- [DISPONIBILITÀ](docs/SEZIONEDISPONIBILITA.md)
- [DESIGN](docs/DESIGN.md)
