"use client";

import { useEffect } from "react";

/**
 * Colonne ridimensionabili trascinando il bordo destro dell'intestazione.
 *
 * Il `resize: horizontal` del CSS non funziona sulle celle di tabella: allargava
 * solo il riquadro del titolo, non la colonna. Qui si agisce sul `<colgroup>`
 * con `table-layout: fixed`, che è l'unico modo perché la larghezza imposta
 * valga per tutta la colonna. Le larghezze restano memorizzate nel browser
 * (localStorage) così non si rifà la regolazione ad ogni caricamento.
 */
export default function ColumnResize({ tableId }: { tableId: string }) {
  useEffect(() => {
    const table = document.getElementById(tableId) as HTMLTableElement | null;
    if (!table) return;
    const ths = Array.from(table.tHead?.rows[0]?.cells ?? []);
    if (ths.length === 0) return;

    // colgroup con le larghezze correnti, poi la tabella passa a layout fisso
    const salvate: number[] = (() => {
      try { return JSON.parse(localStorage.getItem(`colw_${tableId}`) ?? "[]"); } catch { return []; }
    })();
    const colgroup = document.createElement("colgroup");
    const cols = ths.map((th, i) => {
      const col = document.createElement("col");
      const w = salvate[i] > 0 ? salvate[i] : th.getBoundingClientRect().width;
      col.style.width = `${Math.round(w)}px`;
      colgroup.appendChild(col);
      return col;
    });
    table.insertBefore(colgroup, table.firstChild);
    table.style.tableLayout = "fixed";
    table.style.width = "max-content";
    table.style.minWidth = "100%";

    const salva = () => {
      try {
        localStorage.setItem(`colw_${tableId}`, JSON.stringify(cols.map((c) => parseFloat(c.style.width) || 0)));
      } catch { /* spazio esaurito o storage disabilitato: si perde solo la preferenza */ }
    };

    const cleanups: (() => void)[] = [];
    ths.forEach((th, i) => {
      const grip = document.createElement("span");
      grip.className = "col-grip";
      grip.title = "Trascina per allargare o stringere la colonna";
      th.style.position = "relative";
      th.appendChild(grip);

      const giu = (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const xIniziale = e.clientX;
        const wIniziale = parseFloat(cols[i].style.width) || th.getBoundingClientRect().width;
        const muovi = (m: PointerEvent) => {
          cols[i].style.width = `${Math.max(40, wIniziale + (m.clientX - xIniziale))}px`;
        };
        const su = () => {
          document.removeEventListener("pointermove", muovi);
          document.removeEventListener("pointerup", su);
          document.body.style.userSelect = "";
          salva();
        };
        document.body.style.userSelect = "none";
        document.addEventListener("pointermove", muovi);
        document.addEventListener("pointerup", su);
      };
      grip.addEventListener("pointerdown", giu);
      cleanups.push(() => { grip.removeEventListener("pointerdown", giu); grip.remove(); });
    });

    return () => {
      cleanups.forEach((f) => f());
      colgroup.remove();
      table.style.tableLayout = "";
      table.style.width = "";
      table.style.minWidth = "";
    };
  }, [tableId]);

  return null;
}
