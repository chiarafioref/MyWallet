# Immagini per il README

Metti qui i file con **esattamente** questi nomi (il README li referenzia già):

| File | Cosa mostrare | Note |
| --- | --- | --- |
| `demo.gif` | Registrazione schermo 10-20s: login → dashboard → aggiungi una transazione (si aggiorna in tempo reale) → assistente AI che risponde | larghezza ~1000-1200px, < 10 MB |
| `dashboard.png` | La dashboard con saldo, entrate/uscite, grafico spese per categoria, ultime transazioni | tema chiaro, dati realistici |
| `statistiche.png` | La sezione Statistiche: donut + ranking categorie + barre 6 mesi | |
| `assistente.png` | L'assistente dopo aver risposto a una domanda (badge "AI" o "assistente" visibile) | es. "Quanto ho speso per i ristoranti questo mese?" |
| `budget.png` | Il consulente di budget (wizard 50/30/20), step con le barre essenziali/sfizi/risparmio | |
| `viaggi.png` | Il foglio di un viaggio: spesa totale, "chi deve dare a chi", spese per categoria | |
| `report.png` | Il report mensile (sezione Analisi) o l'anteprima del PDF | |

## Come catturare

**Screenshot (Windows):** `Win + Shift + S` → area → incolla in Paint → salva come PNG.
Meglio ancora: browser a ~1440px di larghezza, DevTools chiuso.

**GIF:** [ScreenToGif](https://www.screentogif.com/) (gratuito, Windows) — registra, taglia, esporta in `.gif`.
In alternativa una `demo.mp4` va bene: rinomina il riferimento nel README da `demo.gif` a `demo.mp4`
e usa `<video src="..." controls>` (GitHub lo riproduce).

## Consigli

- Popola l'app con qualche settimana di transazioni finte ma plausibili prima di scattare.
- Usa il tema chiaro per gli screenshot principali (uno in dark mode è un bel tocco extra).
- Ritaglia via la barra degli indirizzi del browser.
- Comprimi i PNG con [squoosh.app](https://squoosh.app/) se superano ~500 KB.
