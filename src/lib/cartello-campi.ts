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
