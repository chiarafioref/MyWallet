- La web app integra una barra di ricerca intelligente basata sull'intelligenza artificiale, permettendo all'utente di trovare rapidamente transazioni e ottenere informazioni sul proprio portafoglio utilizzando il linguaggio naturale.
- L'utente può formulare domande o richieste in modo naturale senza conoscere la struttura del databse o icriteri di ricerca.
- L'utente può digitare richieste come:
  - Quanto ho speso questo mese?
  - Mostrami tutte le spese per i ristoranti.
  - Quanto ho speso di carburante negli ultimi tre mesi?
  - Qual è la mia spesa più alta?
  - Fammi vedere tutte le transazioni pagate con la carta.
  - Quanto ho ricevuto di stipendio quest'anno?
  - Mostrami le spese superiori a 100 €.
  - Quanto ho speso lo scorso weekend?
  - Quanto ho speso durante il viaggio a Parigi?
  - Quali abbonamenti aumenteranno di prezzo i prossimi mesi?
- La ricerca intelligente interpreta automaticamente le categorie di spesa, intervalli di date, importi, metodi di pagamento, entrate e uscite, budget, risparmi, spese future, abbonamenti e viggi condivisi.
- Converte automaticamente la richiesta dell'utente in una ricerca sui dati presenti nel database e restituisce il risultato sotto forma di elenco o riepiloghi.
- Durante la digitazione vengono proposti suggerimenti dianmici per aiutare l'utente a completare rapidamente la ricerca.
- Le ultime ricerche effettuate vengono salvate per consentire un accesso rapido alle richieste più frequenti.
- L'utente può eseguire ricerche specifiche all'interno di sezioni specifiche come portafoglio personale, viaggi, budget, risparmi, spese future, abbonamenti.
- L'assistente AI restituisce risulati in tempo reale con tempi di risposta ridotti e propone automaticamente statistiche correlate quando la richiesta lo consente.
- L'assistente AI interpreta automaticamente il contesto della sezione in cui si trova l'utente.
- La ricerca AI deve essere un vero e proprio assistente finanziario.
- L'utente può chiedere diversi consigli e chiarimenti come:
- "Perchè questo mese ho speso più del solito?" e l'assistente risponde "hai speso 247 € in più rispetto al mese scorso e le differenze sono, ristoranti + 98 €, carburante + 42 €, shopping + 71 €, intrattenimento + 36 €".
- "Come posso risparmiare 200 € al mese?" e l'assistente risponde "riducendo del 20% le spese in ristoranti (+55€), shopping (+73€), intrattenimento (+41€), abbonamenti (+35€), potresti risparmiare circa 204 € al mese".

## ARCHITETTURA

- L'IA interpreta la richiesta dell'utente e la trasforma in struttura di ricerca (ad esempio: categoria = "Ristoranti", periodo = "ultimo mese", importo < 100 €).
- La web app esegue la query su Supabase utilizzando quei parametri e restituisce i risultati.
