import type { PrintField } from "./stampe";

/*
 * Riconoscimento dei campi immagine, in un modulo senza dipendenze server:
 * lo usa Cartello, che deve poter girare anche nel browser (anteprima dal
 * vivo in Stampa cartelli), e lib/stampe importa `fs`.
 */

export const IMAGE_FIELDS = new Set(["foto", "logoAzienda", "logoInsegna"]);

export function isImageField(field: PrintField | undefined, fieldId: string): boolean {
  return IMAGE_FIELDS.has(fieldId) || field?.type === "image";
}

/*
 * Elementi del layout che non sono campi del prodotto: l'immagine libera,
 * il riquadro (una fascia colorata o una scritta fissa) e il QR code che
 * porta alla scheda online. Si disegnano sempre, anche se il prodotto non
 * ha un valore — tranne il QR, che sparisce se la scheda online è spenta.
 */
export const ELEMENTO_IMMAGINE = "__img";
export const ELEMENTO_RIQUADRO = "__box";
export const ELEMENTO_QR = "__qr";

export function isElementoLibero(fieldId: string): boolean {
  return fieldId === ELEMENTO_IMMAGINE || fieldId === ELEMENTO_RIQUADRO || fieldId === ELEMENTO_QR;
}

/*
 * Classificazione dei campi: serve a decidere in blocco cosa va sul cartello
 * e cosa solo sulla scheda online ("tutte le misure solo online"). I campi
 * del Consorzio hanno un gruppo predefinito; quelli aggiunti e quelli
 * riclassificati lo portano scritto su di sé (PrintField.gruppo).
 */
export const GRUPPI_PREDEFINITI: Record<string, string> = {
  titolo: "Identità", sottotitolo: "Identità", codice: "Identità", codiceInterno: "Identità",
  materiali: "Descrizione", partiIncluse: "Descrizione", colori: "Descrizione", buono: "Descrizione", consigli: "Descrizione",
  misure: "Misure e imballo",
  prezzo: "Prezzo", prezzoListino: "Prezzo", prezzoPromo: "Prezzo",
  descrizionePromo: "Promozione", novita: "Promozione", validita: "Promozione", condizioni: "Promozione", trasporto: "Promozione",
  foto: "Immagini", logoAzienda: "Immagini", logoInsegna: "Immagini",
};

export const GRUPPO_ALTRO = "Altro";

export function gruppoDi(field: Pick<PrintField, "id" | "gruppo">): string {
  return field.gruppo?.trim() || GRUPPI_PREDEFINITI[field.id] || GRUPPO_ALTRO;
}

/** I gruppi esistenti, nell'ordine in cui si leggono meglio (i predefiniti prima, poi gli altri). */
export function elencoGruppi(fields: Pick<PrintField, "id" | "gruppo">[]): string[] {
  const ordine = ["Identità", "Descrizione", "Misure e imballo", "Prezzo", "Promozione", "Immagini"];
  const presenti = new Set(fields.map(gruppoDi));
  return [...ordine.filter((g) => presenti.has(g)), ...[...presenti].filter((g) => !ordine.includes(g)).sort()];
}

/**
 * Cosa contiene ogni campo, in una riga: si legge sotto il pulsante in
 * «Campi disponibili» dell'editor dei layout. Vale per i campi senza una
 * `nota` propria; i campi personalizzati usano la loro.
 */
export const DESCRIZIONI_CAMPI: Record<"zoo" | "arredo", Record<string, string>> = {
  zoo: {
  titolo: "Il nome del prodotto padre (es. «Forza10 Maintenance»), uguale per tutti i gusti.",
  descCartello: "Il testo del padre scritto per i cartelli: formato, gusti, uso.",
  descrizione: "La descrizione dell'offerta come arriva dall'Excel delle promo.",
  descrizioneArticolo: "La descrizione del singolo articolo (gusto o formato), dal listino.",
  marca: "La marca del listino o, se manca, il fornitore.",
  prezzoPromo: "Il prezzo in offerta, grande: quello dell'insegna/PV se l'ha caricato.",
  prezzoUnita: "Prezzo al chilo o al litro, calcolato dal peso: obbligatorio sugli alimenti.",
  label: "Una parola in evidenza scelta sull'offerta: SOTTOCOSTO, NOVITÀ…",
  condizioni: "Le condizioni scritte sull'offerta (es. «fino a esaurimento scorte»).",
  condizioniStandard: "Il testo fisso delle condizioni impostato in Impostazioni Zoo.",
  validita: "Le date del volantino: «Promozione valida dal… al…».",
  eanLista: "I codici a barre di tutti gli articoli del padre, in piccolo.",
  animale: "Cane, Gatto, Roditori… come è classificato il padre.",
  caratteristica: "Secco, Umido, Snack… la caratteristica del padre.",
  immagine: "La foto del prodotto (del padre, o quella scelta per il volantino).",
  },
  arredo: {
  titolo: "Il nome del prodotto.",
  sottotitolo: "Una riga sotto al titolo: linea, collezione o uso.",
  materiali: "Di cosa è fatto il prodotto.",
  partiIncluse: "Cosa c'è nella confezione.",
  colori: "I colori disponibili.",
  misure: "Le misure dell'imballo (o del prodotto).",
  buono: "Una curiosità o un vantaggio da mettere in evidenza.",
  consigli: "Consigli d'uso o di manutenzione.",
  prezzo: "Il prezzo di vendita del prodotto.",
  prezzoListino: "Il prezzo di partenza, stampato barrato quando c'è una promo.",
  trasporto: "Note sulla consegna o sul trasporto.",
  foto: "La foto del prodotto.",
  logoAzienda: "Il logo del produttore.",
  descrizionePromo: "Il testo della promozione (es. «Solo questo mese»).",
  novita: "Il bollino «Novità» per i prodotti appena arrivati.",
  prezzoPromo: "Il prezzo in promozione.",
  validita: "Fino a quando vale la promozione.",
  condizioni: "Le condizioni della promozione.",
  logoInsegna: "Il logo dell'insegna che stampa il cartello.",
  codice: "Il codice articolo del fornitore.",
  codiceInterno: "Il codice che l'insegna usa nel proprio gestionale.",
  },
};
