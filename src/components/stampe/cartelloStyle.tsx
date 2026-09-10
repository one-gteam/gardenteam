import type { LayoutItem, PrintField } from "@/lib/stampe";
import { layoutFontCss } from "@/lib/layout-fonts";
import { stickerShapeStyle } from "./stickerStyle";

/*
 * Regole grafiche del cartello, in un modulo a sé perché le usano sia la stampa
 * (Cartello, lato server) sia l'editor dei layout (client): tenerle qui evita
 * che l'editor si porti dietro il codice server di lib/stampe, e soprattutto
 * evita di riscriverle due volte con il rischio che divergano.
 */

export const FONT_CN = '"Avenir Next LT Pro Cn", "Avenir Next LT Pro", "Segoe UI", sans-serif';

/**
 * Prezzo come nel template: intero grande + centesimi più piccoli allineati in
 * alto ("109,00" → 109 ⁰⁰). Non un <sup> con vertical-align: quel calcolo
 * dipende dai metrici del font, e sia dentro un contenitore flex sia in stampa
 * (motore di rasterizzazione diverso da quello a schermo) i centesimi
 * finivano in basso invece che in alto. Un flex "allineati in alto" non
 * dipende dal motore di rendering: è pura disposizione dei riquadri.
 */
export function Prezzo({ value, size, scale, font }: { value: string; size: number; scale: number; font?: string }) {
  /*
   * Il simbolo di valuta va in apice come i centesimi: sul cartello deve saltare
   * all'occhio il numero, non l'euro. Si stacca dal resto solo se c'è davvero —
   * i prezzi dell'Arredo arrivano senza simbolo e restano come prima.
   */
  const testo = value.trim();
  const valuta = /^[€$£]/.test(testo) ? testo[0] : "";
  const [int, cent] = (valuta ? testo.slice(1).trim() : testo).split(",");
  const fs = (size * scale) / 2.4;
  return (
    <span style={{ fontFamily: font ?? FONT_CN, fontWeight: 800, lineHeight: 0.95, whiteSpace: "nowrap", fontSize: fs, display: "inline-flex", alignItems: "flex-start" }}>
      {valuta && <span style={{ fontSize: "0.45em", marginRight: "0.08em" }}>{valuta}</span>}
      <span>{int}</span>
      {cent !== undefined && <span style={{ fontSize: "0.5em", marginLeft: "0.05em" }}>,{cent}</span>}
    </span>
  );
}

/*
 * Le regole grafiche dei campi stanno qui, in un posto solo, perché le usano
 * sia la stampa sia l'editor dei layout: quando erano scritte due volte
 * l'anteprima dell'editor mostrava colori, caratteri e a capo diversi da quelli
 * che poi uscivano dalla stampante.
 */

/** La regola Garden Team "due spazi = a capo". */
export function testoStampato(value: string): string {
  return value.replace(/ {2}/g, "\n");
}

/**
 * Il prezzo promo e la meccanica (3x2, 1+1…) sono l'informazione che deve saltare
 * all'occhio a scaffale: rossi salvo diverso colore scelto nel layout. Gli altri
 * campi restano neri, compreso il prezzo dell'Arredo, che segue altre regole.
 */
export function coloreCampo(item: LayoutItem): string {
  const rossoDiDefault = item.fieldId === "prezzoPromo" || item.fieldId === "meccanica";
  return item.color ?? (rossoDiDefault ? "#c8161d" : "#111");
}

/** È uno dei due campi disegnati come prezzo (intero grande, centesimi in alto)? */
export function isPrezzoField(fieldId: string): boolean {
  return fieldId === "prezzo" || fieldId === "prezzoPromo";
}

/** Come si legge un campo di testo sul cartello stampato. */
export function stileTestoCartello(
  item: LayoutItem, meta: PrintField | undefined, value: string, scale: number
): React.CSSProperties {
  /*
   * Il listino va barrato — è quello che rende leggibile lo sconto — ma solo
   * quando è davvero un prezzo: quando manca il prezzo di partenza al suo posto
   * compare la dicitura "A SOLI", che barrata non avrebbe senso.
   */
  const barrato = item.fieldId === "prezzoListino" && value.trim().startsWith("€");
  return {
    fontSize: ((item.size ?? meta?.size ?? 11) * scale) / 2.4,
    fontWeight: (item.bold ?? meta?.bold) ? 700 : 400,
    fontStyle: item.italic ? "italic" : "normal",
    fontFamily: item.font !== undefined ? layoutFontCss(item.font) : meta?.font === "cn" ? FONT_CN : undefined,
    lineHeight: 1.2,
    color: coloreCampo(item),
    textAlign: item.align ?? "left",
    whiteSpace: "pre-line",
    textDecoration: barrato ? "line-through" : undefined,
  };
}

/** Come si legge il testo dentro uno sticker/bollino stampato. */
export function stileStickerCartello(item: LayoutItem, scale: number): React.CSSProperties {
  return {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: "6%",
    color: item.color ?? "#fff",
    fontWeight: 800,
    fontFamily: item.sticker?.font === "cn" ? FONT_CN : undefined,
    fontSize: ((item.sticker?.size ?? 16) * scale) / 2.4,
    lineHeight: 1.05,
    ...stickerShapeStyle(item.sticker!),
  };
}

/** Allineamento orizzontale del prezzo, che vive dentro un flex e non usa text-align. */
export function justifyPrezzo(item: LayoutItem): "flex-start" | "center" | "flex-end" {
  return item.align === "left" ? "flex-start" : item.align === "center" ? "center" : "flex-end";
}
