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
    /*
     * Sotto una riga possono starcene altre che le appartengono — gli articoli
     * del prodotto padre, il pannello "dettagli" — e si riconoscono perché non
     * hanno il dato della colonna: seguono la loro riga nello spostamento.
     */
    const codaDi = new Map<HTMLTableRowElement, HTMLTableRowElement[]>();
    for (const r of righe) {
      const appese: HTMLTableRowElement[] = [];
      let dopo = r.nextElementSibling as HTMLTableRowElement | null;
      while (dopo && !dopo.hasAttribute(`data-${campo}`)) {
        appese.push(dopo);
        dopo = dopo.nextElementSibling as HTMLTableRowElement | null;
      }
      codaDi.set(r, appese);
    }
    righe.sort((a, b) => (a.getAttribute(`data-${campo}`) ?? "").localeCompare(b.getAttribute(`data-${campo}`) ?? "") * nuovo);
    for (const r of righe) {
      corpo.appendChild(r);
      for (const sotto of codaDi.get(r) ?? []) corpo.appendChild(sotto);
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
