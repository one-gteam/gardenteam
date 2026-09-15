"use client";

import { useRef, useState, type ReactNode } from "react";

/**
 * Intestazione di colonna che ordina la tabella al volo, senza ricaricare la
 * pagina: riordina le righe già disegnate leggendo il valore che ognuna si
 * porta dietro (data-marca, data-fornitore…). Un clic ordina dalla A alla Z,
 * il secondo al contrario, e le righe del pannello "dettagli" seguono la loro.
 */
export default function ColonnaOrdinabile({ campo, children }: { campo: string; children: ReactNode }) {
  const [verso, setVerso] = useState<0 | 1 | -1>(0);
  const rif = useRef<HTMLTableCellElement>(null);

  const ordina = () => {
    const corpo = rif.current?.closest("table")?.querySelector("tbody");
    if (!corpo) return;
    const nuovo: 1 | -1 = verso === 1 ? -1 : 1;
    const righe = [...corpo.querySelectorAll<HTMLTableRowElement>(`tr[data-${campo}]`)];
    // ogni riga può avere sotto la riga del pannello dettagli: si sposta con lei
    const codaDi = new Map<HTMLTableRowElement, HTMLTableRowElement | null>();
    for (const r of righe) {
      const dopo = r.nextElementSibling as HTMLTableRowElement | null;
      codaDi.set(r, dopo && !dopo.hasAttribute(`data-${campo}`) ? dopo : null);
    }
    righe.sort((a, b) => (a.getAttribute(`data-${campo}`) ?? "").localeCompare(b.getAttribute(`data-${campo}`) ?? "") * nuovo);
    for (const r of righe) {
      corpo.appendChild(r);
      const sotto = codaDi.get(r);
      if (sotto) corpo.appendChild(sotto);
    }
    setVerso(nuovo);
  };

  return (
    <th ref={rif}>
      <button type="button" onClick={ordina} title="Ordina per questa colonna"
        style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer", textTransform: "inherit", letterSpacing: "inherit" }}>
        {children}{verso === 1 ? " ▾" : verso === -1 ? " ▴" : ""}
      </button>
    </th>
  );
}
