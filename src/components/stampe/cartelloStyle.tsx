import type { Cornice, LayoutItem, PrintField } from "@/lib/stampe";
import { layoutFontCss } from "@/lib/layout-fonts";
import { stickerShapeStyle } from "./stickerStyle";
import FitText from "./FitText";
import PrezzoAdattato from "./PrezzoAdattato";

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
export function Prezzo(
  { value, size, scale, font, valign, align }:
  {
    value: string; size: number; scale: number; font?: string;
    valign?: "top" | "middle" | "bottom"; align?: "left" | "center" | "right";
  }
) {
  // dove sta il prezzo dentro al riquadro: lo decide il layout, come per i testi
  const versoIlBasso = valign === "middle" ? "center" : valign === "bottom" ? "flex-end" : "flex-start";
  /*
   * Il simbolo di valuta va in apice come i centesimi: sul cartello deve saltare
   * all'occhio il numero, non l'euro. Si stacca dal resto solo se c'è davvero —
   * i prezzi dell'Arredo arrivano senza simbolo e restano come prima.
   */
  const testo = value.trim();
  /*
   * Al posto del prezzo può esserci una scritta — "SCONTO 20%" sui cartelli a
   * solo sconto: si stampa grande come il prezzo, ma va a capo invece di uscire
   * dal riquadro, perché non ha centesimi da mettere in apice.
   */
  /*
   * Scritta al posto del prezzo ("SCONTO 20%"): si rimpicciolisce fino a
   * starci dentro, come tutti gli altri campi. Prima usciva dal riquadro e
   * finiva sopra al prezzo barrato.
   */
  if (testo && !/^[€$£]?\s*\d/.test(testo)) {
    return (
      <FitText style={{
        width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: versoIlBasso,
        fontFamily: font ?? FONT_CN, fontWeight: 800, lineHeight: 0.95, textAlign: align ?? "right",
        fontSize: (size * scale) / 2.4, whiteSpace: "pre-line", overflow: "hidden",
      }}>
        {testoStampato(testo)}
      </FitText>
    );
  }
  const valuta = /^[€$£]/.test(testo) ? testo[0] : "";
  const [int, cent] = (valuta ? testo.slice(1).trim() : testo).split(",");
  const fs = (size * scale) / 2.4;
  /*
   * Il prezzo riempie il riquadro: le cifre (non la riga del carattere) si
   * fanno grandi quanto lo spazio permette, fino al corpo scelto nel layout.
   * Vedi PrezzoAdattato per il perché.
   */
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", justifyContent: "inherit", alignItems: "flex-start", overflow: "visible" }}>
      <PrezzoAdattato valuta={valuta} int={int} cent={cent} size={fs} font={font ?? FONT_CN} verso={versoIlBasso} />
    </div>
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
  const rossoDiDefault = item.fieldId === "prezzoPromo" || item.fieldId === "meccanica" || item.fieldId === "tipoPromo";
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
    /*
     * Testo centrato (o in basso) dentro al suo riquadro: colonna flessibile,
     * così l'allineamento orizzontale del paragrafo resta quello di textAlign.
     */
    ...(item.valign && item.valign !== "top"
      ? { display: "flex", flexDirection: "column" as const, justifyContent: item.valign === "middle" ? "center" : "flex-end" }
      : {}),
  };
}

/** Dove sta il prezzo dentro al suo riquadro (il prezzo vive in un flex). */
export function alignPrezzo(item: LayoutItem): "flex-start" | "center" | "flex-end" {
  return item.valign === "middle" ? "center" : item.valign === "bottom" ? "flex-end" : "flex-start";
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

/* ================== Cornice del riquadro ================== */

/** Bordo del riquadro (sui lati scelti), da unire allo stile del riquadro stesso. */
export function bordoRiquadro(item: LayoutItem, scale: number): React.CSSProperties {
  const c = item.cornice;
  if (!c?.bordoColore) return {};
  const riga = `${Math.max(1, (c.bordoSpessore ?? 0.3) * scale)}px solid ${c.bordoColore}`;
  const lati = c.bordoLati ?? "tutti";
  return {
    boxSizing: "border-box",
    borderTop: lati !== "sotto" ? riga : undefined,
    borderBottom: lati !== "sopra" ? riga : undefined,
    borderLeft: lati === "tutti" ? riga : undefined,
    borderRight: lati === "tutti" ? riga : undefined,
  };
}

/** Stile del titolo del riquadro ("misure imballo:" con le sue righe o la sua fascia). */
function stileTitolo(c: Cornice, scale: number): React.CSSProperties {
  const stile = c.stile ?? "linee";
  const corpo = ((c.size ?? 12) * scale) / 2.4;
  const base: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 0.9 * scale, flex: "none",
    fontSize: corpo, fontWeight: 700, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden",
    color: c.colore ?? (stile === "fascia" ? "#fff" : "#111"),
    boxSizing: "border-box",
  };
  if (stile === "linee") {
    const riga = `${Math.max(1, 0.5 * scale)}px solid ${c.colore ?? "#111"}`;
    return { ...base, borderTop: riga, borderBottom: riga, padding: `${0.9 * scale}px ${1 * scale}px` };
  }
  if (stile === "fascia") {
    return { ...base, background: c.sfondo ?? "#a6c788", padding: `${0.9 * scale}px ${1.5 * scale}px` };
  }
  return { ...base, padding: `0 0 ${0.5 * scale}px` };
}

/**
 * Il riquadro di un campo con la sua cornice: titolo (con icona) in alto e il
 * contenuto sotto, con lo spazio interno scelto. Lo usano sia la stampa sia
 * l'editor, così quello che si vede nell'editor è quello che esce.
 */
export function CorniceCampo({ item, scale, children }: { item: LayoutItem; scale: number; children: React.ReactNode }) {
  const c = item.cornice;
  const pad = (c?.padding ?? 0) * scale;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", boxSizing: "border-box", overflow: "inherit" }}>
      {c?.titolo && (
        <div style={stileTitolo(c, scale)}>
          {c.icona && (
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none",
              width: 4.6 * scale, height: 4.6 * scale, borderRadius: 1 * scale,
              background: c.sfondo ?? "#9bc77d", color: "#fff", fontSize: 3.2 * scale, fontWeight: 700, lineHeight: 1,
            }}>
              {c.icona}
            </span>
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{c.titolo}</span>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, padding: pad, boxSizing: "border-box", overflow: "inherit" }}>
        {children}
      </div>
    </div>
  );
}

/** Il valore con il prefisso scelto nel layout ("€" davanti a un prezzo che arriva nudo). */
export function conPrefisso(item: LayoutItem, value: string): string {
  const p = item.prefisso?.trim();
  if (!p || !value.trim() || value.trim().startsWith(p)) return value;
  return `${p}${/^[€$£]$/.test(p) ? " " : " "}${value.trim()}`;
}
