/*
 * Griglia delle pagine del volantino con un numero di celle diverso per riga.
 *
 * La pagina ha `cols` colonne; una riga può averne un numero suo
 * (`colsRiga[r]`: es. 3 sopra, 4 in mezzo, 5 sotto). Per disegnarle tutte
 * nella stessa griglia CSS si usa una griglia fine da UNITA colonne (60 = il
 * minimo comune multiplo di 1…6): una cella di una riga da n occupa 60/n
 * unità. Le righe attraversate da una cella alta (rs > 1) restano a `cols`.
 *
 * Nessuna dipendenza: lo usano sia Crea Volantino (componente client) sia la
 * Bozza (pagina server).
 */

export const UNITA = 60;

export interface GrigliaPagina {
  cols: number;
  rows: number;
  colsRiga?: Record<string, number>;
  blocks: { r: number; c: number; rs: number; cs: number }[];
}

/** Le righe che una cella alta attraversa: lì non si cambia il numero di celle. */
export function righeBloccate(p: GrigliaPagina): Set<number> {
  const s = new Set<number>();
  for (const b of p.blocks) if (b.rs > 1) for (let r = b.r; r < b.r + b.rs; r++) s.add(r);
  return s;
}

/** Quante celle ha la riga r. */
export function colonneRiga(p: GrigliaPagina, r: number): number {
  const n = p.colsRiga?.[String(r)];
  return n && n > 0 && !righeBloccate(p).has(r) ? n : p.cols;
}

/** Posizione di una cella nella griglia fine: `grid-column` da usare. */
export function colonnaGriglia(p: GrigliaPagina, b: { r: number; c: number; cs: number; rs: number }): string {
  const n = b.rs > 1 ? p.cols : colonneRiga(p, b.r);
  const u = UNITA / n;
  return `${b.c * u + 1} / span ${b.cs * u}`;
}

/** Il `grid-template-columns` della pagina (griglia fine). */
export function colonneGriglia(): string {
  return `repeat(${UNITA}, minmax(0, 1fr))`;
}

/** Le sezioni colorate sono sulla griglia di `cols`: la stessa conversione. */
export function colonnaSezione(p: GrigliaPagina, s: { c: number; cs: number }): string {
  const u = UNITA / p.cols;
  return `${s.c * u + 1} / span ${s.cs * u}`;
}
