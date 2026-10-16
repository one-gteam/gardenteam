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

/**
 * Una sezione: righe come le celle, colonne nella griglia fine (cu = unità di
 * partenza, cus = unità occupate). Così segue esattamente le celle di ogni
 * riga anche quando le righe hanno un numero di celle diverso (3 sopra, 4
 * sotto). Le sezioni salvate prima hanno solo c/cs, sulla griglia di `cols`.
 */
export interface SezioneGriglia { r: number; rs: number; c: number; cs: number; cu?: number; cus?: number }

/** Da quale unità a quale unità va la sezione (fine esclusa). */
export function unitaSezione(p: GrigliaPagina, s: SezioneGriglia): { da: number; a: number } {
  if (s.cu !== undefined && s.cus !== undefined) return { da: s.cu, a: Math.min(UNITA, s.cu + s.cus) };
  const u = UNITA / p.cols;
  return { da: s.c * u, a: Math.min(UNITA, (s.c + s.cs) * u) };
}

/** Da quale unità a quale unità va una cella (fine esclusa). */
export function unitaCella(p: GrigliaPagina, b: { r: number; c: number; cs: number; rs: number }): { da: number; a: number } {
  const n = b.rs > 1 ? p.cols : colonneRiga(p, b.r);
  const u = UNITA / n;
  return { da: b.c * u, a: (b.c + b.cs) * u };
}

/** La cella sta dentro la sezione? Righe in comune e il centro della cella nelle sue colonne. */
export function cellaInSezione(p: GrigliaPagina, b: { r: number; c: number; cs: number; rs: number }, s: SezioneGriglia): boolean {
  if (b.r + b.rs <= s.r || b.r >= s.r + s.rs) return false;
  const c = unitaCella(p, b);
  const centro = (c.da + c.a) / 2;
  const z = unitaSezione(p, s);
  return centro >= z.da && centro < z.a;
}

/** Il `grid-column` di una sezione. */
export function colonnaSezione(p: GrigliaPagina, s: SezioneGriglia): string {
  const z = unitaSezione(p, s);
  return `${z.da + 1} / span ${Math.max(1, z.a - z.da)}`;
}

/** La sezione appena creata su una cella: esattamente le sue colonne. */
export function sezioneDaCella(p: GrigliaPagina, b: { r: number; c: number; cs: number; rs: number }): { r: number; rs: number; c: number; cs: number; cu: number; cus: number } {
  const u = unitaCella(p, b);
  const base = UNITA / p.cols;
  return { r: b.r, rs: b.rs, cu: u.da, cus: u.a - u.da, c: Math.floor(u.da / base), cs: Math.max(1, Math.round((u.a - u.da) / base)) };
}

/**
 * Allarga la sezione di una cella a destra: la cella che nelle sue righe
 * comincia dove la sezione finisce (la più stretta, se le righe sono diverse).
 */
export function allargaSezioneADestra(p: GrigliaPagina, s: SezioneGriglia): { cu: number; cus: number } {
  const z = unitaSezione(p, s);
  let passo = 0;
  for (let r = s.r; r < s.r + s.rs; r++) {
    const cella = p.blocks.find((b) => b.r <= r && r < b.r + b.rs && Math.abs(unitaCella(p, b).da - z.a) < 0.01);
    const w = cella ? unitaCella(p, cella).a - unitaCella(p, cella).da : UNITA / colonneRiga(p, r);
    passo = passo === 0 ? w : Math.min(passo, w);
  }
  return { cu: z.da, cus: Math.min(UNITA - z.da, z.a - z.da + (passo || UNITA / p.cols)) };
}

/** Restringe la sezione di una cella da destra (almeno una cella resta). */
export function restringiSezioneDaDestra(p: GrigliaPagina, s: SezioneGriglia): { cu: number; cus: number } {
  const z = unitaSezione(p, s);
  const ultima = p.blocks
    .filter((b) => b.r < s.r + s.rs && b.r + b.rs > s.r && cellaInSezione(p, b, s))
    .map((b) => unitaCella(p, b))
    .filter((c) => Math.abs(c.a - z.a) < 0.01)
    .reduce((min, c) => Math.min(min, c.a - c.da), Infinity);
  const passo = Number.isFinite(ultima) ? ultima : UNITA / p.cols;
  return { cu: z.da, cus: Math.max(passo, z.a - z.da - passo) };
}
