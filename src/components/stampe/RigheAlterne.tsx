"use client";

import { useEffect, useRef } from "react";

/**
 * Colora a righe alterne le tabelle che contiene. Non basta il CSS: sotto ogni
 * riga ce ne può essere un'altra nascosta (il pannello del prodotto padre), le
 * righe tolte spariscono senza ricaricare e l'ordinamento le rimescola. Qui si
 * contano solo le righe vere e visibili, e si ricolora a ogni cambiamento.
 */
export default function RigheAlterne({ children, className }: { children: React.ReactNode; className?: string }) {
  const rif = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const radice = rif.current;
    if (!radice) return;
    const colora = () => {
      for (const corpo of radice.querySelectorAll("table.data tbody")) {
        let n = 0;
        let pari = false;
        for (const riga of corpo.querySelectorAll<HTMLTableRowElement>(":scope > tr")) {
          // la riga del pannello sotto non ha dati suoi: prende il colore della sua riga
          if (riga.hasAttribute("data-nome")) {
            if (riga.style.display === "none") continue;
            pari = n % 2 === 1;
            n++;
          }
          if (riga.classList.contains("riga-pari") !== pari) riga.classList.toggle("riga-pari", pari);
        }
      }
    };
    colora();
    const osserva = new MutationObserver(colora);
    osserva.observe(radice, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    return () => osserva.disconnect();
  }, []);

  return <div ref={rif} className={className}>{children}</div>;
}
