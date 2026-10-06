"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Barra che resta in vista scorrendo: quando il suo posto esce dallo schermo
 * dall'alto, si aggancia al bordo superiore (position: fixed) con la larghezza
 * che aveva, e un segnaposto tiene il suo spazio. Si fa con JavaScript e non
 * con `position: sticky` perché quest'ultimo smette di funzionare appena un
 * contenitore sopra ha un overflow, e in pagine così lunghe capitava.
 */
export default function BarraFissa({ children }: { children: ReactNode }) {
  const posto = useRef<HTMLDivElement>(null);
  const [fissa, setFissa] = useState(false);
  const [misure, setMisure] = useState({ left: 0, width: 0, height: 0 });

  useEffect(() => {
    const el = posto.current;
    if (!el) return;
    const misura = () => {
      const r = el.getBoundingClientRect();
      setMisure({ left: r.left, width: r.width, height: el.firstElementChild?.getBoundingClientRect().height ?? r.height });
      setFissa(r.top < 0);
    };
    misura();
    window.addEventListener("scroll", misura, { passive: true });
    window.addEventListener("resize", misura);
    return () => { window.removeEventListener("scroll", misura); window.removeEventListener("resize", misura); };
  }, []);

  return (
    <div ref={posto} style={{ minHeight: fissa ? misure.height : undefined }}>
      <div className={`barra-fissa${fissa ? " agganciata" : ""}`}
        style={fissa ? { position: "fixed", top: 0, left: misure.left, width: misure.width } : undefined}>
        {children}
      </div>
    </div>
  );
}
