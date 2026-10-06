"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Il prezzo grande del cartello, fatto riempire davvero il suo riquadro.
 *
 * Un testo occupa in altezza la "riga" del carattere (ascendenti + discendenti,
 * circa 1,2 volte il corpo), ma le cifre sono alte solo 0,7 volte il corpo: a
 * ridurre il corpo finché la riga sta nel riquadro — come fa FitText — il
 * numero riempiva poco più di metà campo, e alzare la dimensione nel layout
 * non serviva a niente. Qui si misura l'inchiostro vero delle cifre (canvas,
 * `measureText`) e si sceglie il corpo più grande per cui le cifre stanno nel
 * riquadro, in altezza e in larghezza, non oltre quello impostato nel layout.
 * Poi si sposta il blocco in modo che l'inchiostro parta dal bordo chiesto
 * (alto, centro o basso), non la riga del carattere.
 */
export default function PrezzoAdattato({
  valuta, int, cent, size, font, verso,
}: {
  valuta: string; int: string; cent?: string;
  /** corpo massimo in px (quello del layout) */
  size: number;
  font: string;
  verso: "flex-start" | "center" | "flex-end";
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const adatta = () => {
      const W = box.clientWidth;
      const H = box.clientHeight;
      const c = document.createElement("canvas").getContext("2d");
      if (!c || W <= 0 || H <= 0) return;
      // misure a 100px: scalano linearmente col corpo
      c.font = `800 100px ${font}`;
      const mi = c.measureText(int);
      const asc = mi.actualBoundingBoxAscent;
      const desc = mi.actualBoundingBoxDescent;
      const inkH = (asc + desc) / 100;
      if (!(inkH > 0)) return;
      let wEm = mi.width / 100;
      if (cent !== undefined) { c.font = `800 50px ${font}`; wEm += c.measureText(`,${cent}`).width / 100 + 0.05; }
      if (valuta) { c.font = `800 45px ${font}`; wEm += c.measureText(valuta).width / 100 + 0.08; }
      const fit = Math.max(4, Math.min(size, H / inkH, W / wEm));
      // la riga del carattere = la sua area di contenuto: così la linea di base sta a `fontAsc` dall'alto
      const fontAsc = (mi.fontBoundingBoxAscent ?? asc) / 100;
      const fontDesc = (mi.fontBoundingBoxDescent ?? desc) / 100;
      const inkTop = fontAsc - asc / 100; // em dalla cima della riga alla cima delle cifre
      el.style.fontSize = `${fit}px`;
      el.style.lineHeight = `${fontAsc + fontDesc}`;
      const inkPx = inkH * fit;
      const y = verso === "center" ? (H - inkPx) / 2 : verso === "flex-end" ? H - inkPx : 0;
      el.style.transform = `translateY(${(y - inkTop * fit).toFixed(2)}px)`;
    };
    adatta();
    // col carattere del layout caricato dopo, le misure cambiano: si rifà
    document.fonts?.ready.then(adatta).catch(() => undefined);
  });

  return (
    <div ref={ref} style={{ display: "flex", alignItems: "flex-start", whiteSpace: "nowrap", fontFamily: font, fontWeight: 800, fontSize: size }}>
      {valuta && <span style={{ fontSize: "0.45em", marginRight: "0.08em" }}>{valuta}</span>}
      <span>{int}</span>
      {cent !== undefined && <span style={{ fontSize: "0.5em", marginLeft: "0.05em" }}>,{cent}</span>}
    </div>
  );
}
