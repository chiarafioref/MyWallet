// Nomi delle categorie predefinite: devono coincidere con seed_default_categories() in DB.sql.
export const CATEGORY = {
  CASA: "Casa",
  SPESA: "Spesa",
  RISTORANTI: "Ristoranti",
  BAR: "Bar",
  TRASPORTI: "Trasporti",
  CARBURANTE: "Carburante",
  SPESE_AUTO: "Spese auto",
  UTENZE: "Utenze",
  SHOPPING: "Shopping",
  SPORT: "Sport",
  INTRATTENIMENTO: "Intrattenimento",
  SALUTE: "Salute",
  ISTRUZIONE: "Istruzione",
  VIAGGI: "Viaggi",
  REGALI: "Regali",
  TASSE: "Tasse",
  RATE_FINANZIAMENTI: "Rate finanziamenti",
  ALTRO: "Altro",
  STIPENDIO: "Stipendio",
  RIMBORSO: "Rimborso",
};

// Categorie "virtuali" assegnate ai movimenti generati da risparmi e spese future.
export const SAVINGS_CATEGORY = "Risparmi";
export const FUTURE_EXPENSE_CATEGORY = "Spese future";

export const TRIP_CATEGORIES = [
  "Alloggio",
  "Cibo e ristoranti",
  "Trasporti",
  "Carburante",
  "Parcheggi e pedaggi",
  "Attività",
  "Musei",
  CATEGORY.ALTRO,
];

// Chiave di confronto per i nomi di categoria (indipendente da maiuscole/minuscole).
export const categoryKey = (name) => String(name ?? "").toLocaleLowerCase("it-IT");
