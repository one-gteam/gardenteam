import type { Cornice, LayoutItem } from "./stampe";
import { ELEMENTO_IMMAGINE, ELEMENTO_QR, ELEMENTO_RIQUADRO } from "./cartello-campi";
import { LAYOUT_FONTS } from "./layout-fonts";

/*
 * Pulizia degli elementi di un layout cartello arrivati dal client: una sola
 * per Arredo e Zoo (prima erano due copie, e lo Zoo perdeva cornice, prefisso,
 * scritte fisse e QR; l'Arredo l'allineamento verticale).
 */

const COLORE = /^#[0-9a-fA-F]{3,8}$/;

/** La cornice del riquadro, entro limiti ragionevoli; se non resta niente di valido non si salva. */
export function sanitizeCornice(c: Record<string, unknown>): { cornice?: Cornice } {
  const out: Cornice = {};
  if (typeof c.titolo === "string" && c.titolo.trim()) out.titolo = c.titolo.slice(0, 80);
  if (typeof c.icona === "string" && c.icona.trim()) out.icona = [...c.icona.trim()].slice(0, 2).join("");
  if (["linee", "fascia", "semplice"].includes(c.stile as string)) out.stile = c.stile as Cornice["stile"];
  if (typeof c.colore === "string" && COLORE.test(c.colore)) out.colore = c.colore;
  if (typeof c.sfondo === "string" && COLORE.test(c.sfondo)) out.sfondo = c.sfondo;
  if (Number.isFinite(Number(c.size)) && Number(c.size) > 0) out.size = Math.max(4, Math.min(120, Number(c.size)));
  if (typeof c.bordoColore === "string" && COLORE.test(c.bordoColore)) out.bordoColore = c.bordoColore;
  if (Number.isFinite(Number(c.bordoSpessore)) && Number(c.bordoSpessore) > 0) out.bordoSpessore = Math.max(0.1, Math.min(10, Number(c.bordoSpessore)));
  if (["tutti", "sopra", "sotto", "sopra-sotto"].includes(c.bordoLati as string)) out.bordoLati = c.bordoLati as Cornice["bordoLati"];
  if (Number.isFinite(Number(c.padding)) && Number(c.padding) > 0) out.padding = Math.max(0, Math.min(30, Number(c.padding)));
  return Object.keys(out).length ? { cornice: out } : {};
}

/** Ripulisce un array di LayoutItem grezzo dal client: stessa validazione per il foglio normale e per quello senza foto. */
export function sanitizeLayoutItems(raw: unknown, isKnownField: (fieldId: string) => boolean): LayoutItem[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .filter(
      (i) =>
        typeof i.fieldId === "string" &&
        (i.fieldId === ELEMENTO_IMMAGINE ? typeof i.imageUrl === "string"
          : i.fieldId === ELEMENTO_RIQUADRO || i.fieldId === ELEMENTO_QR ? true
          : isKnownField(i.fieldId))
    )
    .map((i) => ({
      fieldId: i.fieldId as string,
      x: Math.max(0, Math.min(95, Number(i.x) || 0)),
      y: Math.max(0, Math.min(95, Number(i.y) || 0)),
      w: Math.max(3, Math.min(100, Number(i.w) || 10)),
      h: Math.max(2, Math.min(100, Number(i.h) || 5)),
      ...(typeof i.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(i.color) ? { color: i.color } : {}),
      ...(i.fieldId === "__img" ? { imageUrl: String(i.imageUrl).slice(0, 300) } : {}),
      ...(Number.isFinite(Number(i.size)) ? { size: Math.max(4, Math.min(120, Number(i.size))) } : {}),
      ...(typeof i.bold === "boolean" ? { bold: i.bold } : {}),
      ...(typeof i.italic === "boolean" ? { italic: i.italic } : {}),
      ...(["left", "center", "right"].includes(i.align as string) ? { align: i.align as "left" | "center" | "right" } : {}),
      ...(["top", "middle", "bottom"].includes(i.valign as string) ? { valign: i.valign as "top" | "middle" | "bottom" } : {}),
      ...(typeof i.font === "string" && (LAYOUT_FONTS.some((f) => f.id === i.font) || /^u_[a-z0-9]{4,24}$/.test(i.font)) ? { font: i.font as string } : {}),
      ...(typeof i.bg === "string" && /^#[0-9a-fA-F]{3,8}$/.test(i.bg) ? { bg: i.bg } : {}),
      ...(Number.isFinite(Number(i.radius)) ? { radius: Math.max(0, Math.min(40, Number(i.radius))) } : {}),
      ...(typeof i.testo === "string" && i.testo.trim() ? { testo: i.testo.slice(0, 200) } : {}),
      ...(typeof i.prefisso === "string" && i.prefisso.trim() ? { prefisso: i.prefisso.trim().slice(0, 6) } : {}),
      ...(i.cornice && typeof i.cornice === "object" ? sanitizeCornice(i.cornice as Record<string, unknown>) : {}),
      ...(i.sticker && typeof i.sticker === "object"
        ? {
            sticker: {
              shape: ["cerchio", "quadrato", "stella", "nastro"].includes((i.sticker as Record<string, unknown>).shape as string)
                ? ((i.sticker as Record<string, unknown>).shape as "cerchio")
                : "cerchio",
              bg: /^#[0-9a-fA-F]{3,8}$/.test(String((i.sticker as Record<string, unknown>).bg)) ? String((i.sticker as Record<string, unknown>).bg) : "#e8481c",
              rotation: Math.max(-180, Math.min(180, Number((i.sticker as Record<string, unknown>).rotation) || 0)),
              size: Math.max(6, Math.min(120, Number((i.sticker as Record<string, unknown>).size) || 16)),
              ...((i.sticker as Record<string, unknown>).font === "cn" ? { font: "cn" as const } : {}),
            },
          }
        : {}),
    }));
}

/** Le proprietà di aspetto di un elemento (tutto tranne campo e posizione). */
export const CHIAVI_STILE = ["color", "sticker", "size", "bold", "italic", "align", "valign", "font", "bg", "radius", "cornice", "prefisso"] as const;

/** Opzioni di «Applica a tutti i layout». */
export interface OpzioniCopia {
  /** Anche posizione e misure (per i campi; immagini e riquadri le copiano sempre). */
  conPosizione: boolean;
  /** Se nel layout il campo (o l'immagine in quel punto) non c'è, lo aggiunge uguale. */
  aggiungi: boolean;
}

/** Immagini libere e riquadri: non sono «un campo», si riconoscono da dove stanno. */
export function elementoLibero(fieldId: string): boolean {
  return fieldId === ELEMENTO_IMMAGINE || fieldId === ELEMENTO_RIQUADRO;
}

/** Quanto si sovrappongono due riquadri (0 = per niente, 1 = uguali). */
function sovrapposizione(a: LayoutItem, b: LayoutItem): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const comune = x * y;
  const unione = a.w * a.h + b.w * b.h - comune;
  return unione > 0 ? comune / unione : 0;
}

/**
 * Copia `modello` sugli elementi corrispondenti di un foglio. Ritorna quanti
 * elementi sono cambiati (o aggiunti).
 *  - Un campo (titolo, prezzo, meccanica…): corrisponde chi ha lo stesso campo;
 *    si copia l'aspetto, e con `conPosizione` anche posizione e misure.
 *  - Un'immagine libera (la testata, un logo) o un riquadro: corrisponde quello
 *    dello stesso tipo che sta più o meno nello stesso punto (sovrapposto per
 *    almeno metà); si sostituisce per intero, immagine o scritta comprese.
 *  - Con `aggiungi`, se non c'è niente di corrispondente si aggiunge una copia.
 */
export function copiaStileCampo(items: LayoutItem[], modello: LayoutItem, opzioni: OpzioniCopia | boolean): number {
  const { conPosizione, aggiungi } = typeof opzioni === "boolean" ? { conPosizione: opzioni, aggiungi: false } : opzioni;
  const copiaDi = () => JSON.parse(JSON.stringify(modello)) as LayoutItem;
  let n = 0;
  if (elementoLibero(modello.fieldId)) {
    const corrispondenti = items
      .map((it, i) => ({ it, i, s: it.fieldId === modello.fieldId ? sovrapposizione(it, modello) : 0 }))
      .filter((c) => c.s >= 0.5);
    for (const c of corrispondenti) {
      if (JSON.stringify(c.it) === JSON.stringify(modello)) continue;
      items[c.i] = copiaDi();
      n++;
    }
    if (corrispondenti.length === 0 && aggiungi) { items.push(copiaDi()); n++; }
    return n;
  }
  let trovato = false;
  for (const it of items) {
    if (it.fieldId !== modello.fieldId) continue;
    trovato = true;
    const prima = JSON.stringify(it);
    const rec = it as unknown as Record<string, unknown>;
    for (const k of CHIAVI_STILE) {
      const v = (modello as unknown as Record<string, unknown>)[k];
      if (v === undefined) delete rec[k];
      else rec[k] = JSON.parse(JSON.stringify(v));
    }
    if (conPosizione) { it.x = modello.x; it.y = modello.y; it.w = modello.w; it.h = modello.h; }
    if (JSON.stringify(it) !== prima) n++;
  }
  if (!trovato && aggiungi) { items.push(copiaDi()); n++; }
  return n;
}
