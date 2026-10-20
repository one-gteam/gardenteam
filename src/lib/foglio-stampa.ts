/**
 * Come si stampa un formato su fogli A4: quanti cartelli per foglio e in che
 * verso va il foglio. Si prova l'A4 dritto e girato e vince quello che ne
 * contiene di più: A5 → 2 su A4 orizzontale, A6 → 4 su A4 verticale,
 * A6 orizzontale → 4 su A4 orizzontale, A5 orizzontale → 2 su A4 verticale.
 */
export function foglioDiStampa(f: { w: number; h: number }, carta?: "a4" | "formato"): { w: number; h: number; colonne: number; righe: number } {
  // la stampante ha già la carta del formato (es. A6): un cartello per foglio, a misura
  if (carta === "formato") return { w: f.w, h: f.h, colonne: 1, righe: 1 };
  const prova = (W: number, H: number) => ({ w: W, h: H, colonne: Math.floor((W + 0.5) / f.w), righe: Math.floor((H + 0.5) / f.h) });
  const dritto = prova(210, 297), girato = prova(297, 210);
  const n = (x: { colonne: number; righe: number }) => x.colonne * x.righe;
  if (n(dritto) === 0 && n(girato) === 0) return { w: f.w, h: f.h, colonne: 1, righe: 1 }; // più grande dell'A4: un foglio suo
  return n(girato) > n(dritto) ? girato : dritto;
}
