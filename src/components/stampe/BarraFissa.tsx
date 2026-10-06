"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Barra che resta in vista scorrendo: quando il suo posto esce dallo schermo
 * dall'alto, si aggancia al bordo superiore (position: fixed) con la larghezza
 * che aveva, e un segnaposto tiene il suo spazio. Si fa con JavaScript e non
 * con `position: sticky` perché quest'ultimo smette di funzionare appena un
 * contenitore sopra ha un overflow, e in pagine così lunghe capitava.
 */
export default function BarraFissa({ children, sotto }: {
  children: ReactNode;
  /** Selettore di un'altra barra già fissa in alto (es. i contatori per pagina): questa si mette sotto, non sopra. */
  sotto?: string;
}) {
  const posto = useRef<HTMLDivElement>(null);
  const [fissa, setFissa] = useState(false);
  const [misure, setMisure] = useState({ left: 0, width: 0, height: 0, top: 0 });

  useEffect(() => {
    const el = posto.current;
    if (!el) return;
    const misura = () => {
      const r = el.getBoundingClientRect();
      const sopra = sotto ? document.querySelector(sotto)?.getBoundingClientRect() : undefined;
      // se la barra di sopra è agganciata (è a filo del bordo), questa parte dal suo fondo
      const top = sopra && sopra.top <= 0 ? Math.max(0, sopra.bottom) : 0;
      setMisure({ left: r.left, width: r.width, height: el.firstElementChild?.getBoundingClientRect().height ?? r.height, top });
      setFissa(r.top < top);
    };
    misura();
    window.addEventListener("scroll", misura, { passive: true });
    window.addEventListener("resize", misura);
    return () => { window.removeEventListener("scroll", misura); window.removeEventListener("resize", misura); };
  }, [sotto]);

  return (
    <div ref={posto} style={{ minHeight: fissa ? misure.height : undefined }}>
      <div className={`barra-fissa${fissa ? " agganciata" : ""}`}
        style={fissa ? { position: "fixed", top: misure.top, left: misure.left, width: misure.width } : undefined}>
        {children}
      </div>
    </div>
  );
}
