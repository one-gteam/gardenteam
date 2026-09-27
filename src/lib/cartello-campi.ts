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
