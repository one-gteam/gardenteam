"use client";

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";

/**
 * Riquadro di testo che, se il contenuto non ci sta, rimpicciolisce il corpo
 * finché entra (fino al 40% di quello impostato). Serve ai campi che possono
 * allungarsi senza preavviso — l'elenco dei codici a barre di un padre con
 * tanti gusti, una descrizione lunga — che altrimenti uscivano tagliati a
 * metà riga. Il corpo di partenza resta quello del layout: si riduce solo
 * quando serve, e solo quanto serve.
 */
export default function FitText({ style, children }: { style: CSSProperties; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const base = typeof style.fontSize === "number" ? style.fontSize : undefined;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !base) return;
    let fs = base;
    el.style.fontSize = `${fs}px`;
    const trabocca = () => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
    for (let i = 0; i < 40 && fs > base * 0.4 && trabocca(); i++) {
      fs = Math.round(fs * 0.93 * 100) / 100;
      el.style.fontSize = `${fs}px`;
    }
  });

  return <div ref={ref} style={style}>{children}</div>;
}
