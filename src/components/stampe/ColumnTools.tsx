"use client";

import { useEffect, useState } from "react";

/**
 * Colonne ridimensionabili (trascinando il bordo destro dell'intestazione) e
 * riordinabili (trascinando l'intestazione stessa).
 *
 * Il `resize: horizontal` del CSS non funziona sulle celle di tabella: allargava
 * solo il riquadro del titolo, non la colonna. Qui si agisce sul `<colgroup>`
 * con `table-layout: fixed`, che è l'unico modo perché la larghezza imposta
 * valga per tutta la colonna.
 *
 * Il riordino sposta davvero le celle nel DOM, riga per riga: la tabella arriva
 * già impaginata dal server (componente server), quindi non si può ricomporre
 * l'ordine in React senza riscrivere ogni pagina che la usa. Ogni cella si porta
 * dietro `data-col` con la sua posizione di partenza, così larghezze e ordine
 * restano legati alla colonna giusta anche dopo gli spostamenti. Le righe che
 * non hanno una cella per colonna (riquadri espansi con `colSpan`, riga "nessun
 * risultato") vengono saltate.
 *
 * Entrambe le preferenze restano nel browser di chi guarda (localStorage): non
 * seguono l'utente su un altro computer, ma non si perdono ad ogni ricarica e
 * non toccano le impostazioni condivise dagli altri.
 */
export default function ColumnTools({ tableId }: { tableId: string }) {
  /*
   * Menu «Colonne»: ogni colonna si può nascondere; la scelta resta nel browser
   * (localStorage, come larghezze e ordine). Le celle sono riconosciute da
   * `data-col`, così la regola vale anche dopo un riordino.
   */
  const [intestazioni, setIntestazioni] = useState<{ chiave: string; testo: string }[]>([]);
  const [nascoste, setNascoste] = useState<string[]>([]);
  useEffect(() => {
    const table = document.getElementById(tableId) as HTMLTableElement | null;
    const headRow = table?.tHead?.rows[0];
    if (!table || !headRow) return;
    const voci = Array.from(headRow.cells).map((th, i) => ({ chiave: th.dataset.col ?? String(i), testo: (th.textContent ?? "").trim() || `Colonna ${i + 1}` }));
    setIntestazioni(voci);
    try { setNascoste(JSON.parse(localStorage.getItem(`colhide_${tableId}`) ?? "[]")); } catch { /* preferenza illeggibile: tutte visibili */ }
    // le righe aggiunte dopo (ricarica dei dati) ricevono il loro data-col come le altre
    const marca = () => {
      const n = headRow.cells.length;
      for (const tb of Array.from(table.tBodies)) for (const r of Array.from(tb.rows)) {
        if (r.cells.length !== n) continue;
        Array.from(r.cells).forEach((c, i) => { if (!c.dataset.col) c.dataset.col = String(i); });
      }
    };
    const oss = new MutationObserver(marca);
    oss.observe(table, { childList: true, subtree: true });
    return () => oss.disconnect();
  }, [tableId]);
  const alterna = (chiave: string) => {
    const prossime = nascoste.includes(chiave) ? nascoste.filter((c) => c !== chiave) : [...nascoste, chiave];
    setNascoste(prossime);
    try { localStorage.setItem(`colhide_${tableId}`, JSON.stringify(prossime)); } catch { /* si perde solo la preferenza */ }
  };

  useEffect(() => {
    const table = document.getElementById(tableId) as HTMLTableElement | null;
    if (!table) return;
    const headRow = table.tHead?.rows[0];
    if (!headRow || headRow.cells.length === 0) return;
    const nCols = headRow.cells.length;

    const leggi = <T,>(chiave: string, vuoto: T): T => {
      try { return JSON.parse(localStorage.getItem(chiave) ?? "null") ?? vuoto; } catch { return vuoto; }
    };
    const scrivi = (chiave: string, valore: unknown) => {
      try { localStorage.setItem(chiave, JSON.stringify(valore)); } catch { /* storage pieno o disattivato: si perde solo la preferenza */ }
    };

    /** Righe su cui agire: intestazione e ogni riga del corpo con una cella per colonna. */
    const righeComplete = (): HTMLTableRowElement[] => [
      headRow,
      ...Array.from(table.tBodies).flatMap((tb) => Array.from(tb.rows)).filter((r) => r.cells.length === nCols),
    ];

    // ---- marcatura di partenza: ogni cella ricorda la colonna a cui appartiene ----
    righeComplete().forEach((riga) => {
      Array.from(riga.cells).forEach((cella, i) => {
        if (!cella.dataset.col) cella.dataset.col = String(i);
      });
    });

    // ---- colgroup: una <col> per colonna, nell'ordine di partenza ----
    const larghezze: Record<string, number> = leggi(`colw_${tableId}`, {});
    const colgroup = document.createElement("colgroup");
    const colPerIndice = new Map<string, HTMLTableColElement>();
    Array.from(headRow.cells).forEach((th, i) => {
      const col = document.createElement("col");
      const chiave = th.dataset.col ?? String(i);
      const w = larghezze[chiave] > 0 ? larghezze[chiave] : th.getBoundingClientRect().width;
      // colonne nascoste dal CSS (.col-wide sotto i 1400px) misurano 0: lasciarle
      // in automatico, altrimenti resterebbero larghe zero anche quando riappaiono
      if (w > 0) col.style.width = `${Math.round(w)}px`;
      col.dataset.col = chiave;
      colgroup.appendChild(col);
      colPerIndice.set(chiave, col);
    });
    table.insertBefore(colgroup, table.firstChild);
    table.style.tableLayout = "fixed";
    table.style.width = "max-content";
    table.style.minWidth = "100%";

    const salvaLarghezze = () => {
      const out: Record<string, number> = {};
      colPerIndice.forEach((col, chiave) => { out[chiave] = parseFloat(col.style.width) || 0; });
      scrivi(`colw_${tableId}`, out);
    };

    /** Ordine attuale delle colonne, come elenco di indici di partenza. */
    const ordineAttuale = (): string[] => Array.from(headRow.cells).map((c) => c.dataset.col ?? "");

    /**
     * Rimette celle e `<col>` nell'ordine indicato: `appendChild` su un elemento
     * già figlio lo sposta, quindi accodarli uno alla volta nell'ordine voluto
     * ricompone la riga senza calcoli di posizione.
     */
    const applicaOrdine = (ordine: string[]) => {
      for (const riga of righeComplete()) {
        const perChiave = new Map(Array.from(riga.cells).map((c) => [c.dataset.col ?? "", c]));
        for (const chiave of ordine) {
          const cella = perChiave.get(chiave);
          if (cella) riga.appendChild(cella);
        }
      }
      for (const chiave of ordine) {
        const col = colPerIndice.get(chiave);
        if (col) colgroup.appendChild(col);
      }
    };

    /** Sposta la colonna `da` nel punto in cui è stata rilasciata (la colonna `a`). */
    const spostaColonna = (da: string, a: string) => {
      if (da === a) return;
      const ordine = ordineAttuale();
      const iDa = ordine.indexOf(da);
      const iA = ordine.indexOf(a);
      if (iDa < 0 || iA < 0) return;
      const senza = ordine.filter((c) => c !== da);
      const posizione = senza.indexOf(a) + (iDa < iA ? 1 : 0); // da sinistra si inserisce dopo, da destra prima
      senza.splice(posizione, 0, da);
      applicaOrdine(senza);
      scrivi(`colord_${tableId}`, senza);
    };

    // ---- ordine salvato in precedenza, limitato alle colonne che esistono ancora ----
    const salvato: string[] = leggi(`colord_${tableId}`, []);
    const noti = ordineAttuale();
    const daApplicare = [
      ...salvato.filter((c) => noti.includes(c)),
      ...noti.filter((c) => !salvato.includes(c)), // colonne nuove: restano dove le mette la pagina
    ];
    if (daApplicare.length === noti.length && daApplicare.some((c, i) => c !== noti[i])) applicaOrdine(daApplicare);

    // ---- maniglie: bordo destro = ridimensiona, resto dell'intestazione = trascina ----
    const pulizie: (() => void)[] = [];
    Array.from(headRow.cells).forEach((th) => {
      const chiave = th.dataset.col!;
      const grip = document.createElement("span");
      grip.className = "col-grip";
      grip.title = "Trascina per allargare o stringere la colonna";
      th.style.position = "relative";
      th.appendChild(grip);

      const giu = (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const col = colPerIndice.get(chiave)!;
        const xIniziale = e.clientX;
        const wIniziale = parseFloat(col.style.width) || th.getBoundingClientRect().width;
        const muovi = (m: PointerEvent) => {
          col.style.width = `${Math.max(40, wIniziale + (m.clientX - xIniziale))}px`;
        };
        const su = () => {
          document.removeEventListener("pointermove", muovi);
          document.removeEventListener("pointerup", su);
          document.body.style.userSelect = "";
          salvaLarghezze();
        };
        document.body.style.userSelect = "none";
        document.addEventListener("pointermove", muovi);
        document.addEventListener("pointerup", su);
      };
      grip.addEventListener("pointerdown", giu);

      th.draggable = true;
      th.style.cursor = "grab";
      if (!th.title) th.title = "Trascina l'intestazione per spostare la colonna";
      const inizio = (e: DragEvent) => { e.dataTransfer?.setData("text/plain", chiave); th.style.opacity = "0.4"; };
      const sopra = (e: DragEvent) => e.preventDefault();
      const rilascio = (e: DragEvent) => {
        e.preventDefault();
        const da = e.dataTransfer?.getData("text/plain");
        if (da) spostaColonna(da, chiave);
      };
      const fine = () => { th.style.opacity = ""; };
      th.addEventListener("dragstart", inizio);
      th.addEventListener("dragover", sopra);
      th.addEventListener("drop", rilascio);
      th.addEventListener("dragend", fine);

      pulizie.push(() => {
        grip.removeEventListener("pointerdown", giu);
        grip.remove();
        th.removeEventListener("dragstart", inizio);
        th.removeEventListener("dragover", sopra);
        th.removeEventListener("drop", rilascio);
        th.removeEventListener("dragend", fine);
        th.draggable = false;
        th.style.cursor = "";
      });
    });

    return () => {
      pulizie.forEach((f) => f());
      colgroup.remove();
      table.style.tableLayout = "";
      table.style.width = "";
      table.style.minWidth = "";
    };
  }, [tableId]);

  if (intestazioni.length === 0) return null;
  const css = nascoste.map((c) => `#${tableId} [data-col="${c}"]{display:none !important}`).join("");
  return (
    <>
      {css && <style>{css}</style>}
      <details className="colonne-menu">
        <summary className="btn btn-outline btn-sm" title="Scegli quali colonne vedere (la scelta resta su questo computer)">
          ⚙ Colonne{nascoste.length > 0 ? ` (${nascoste.length} nascoste)` : ""}
        </summary>
        <div>
          {intestazioni.map((h) => (
            <label key={h.chiave}>
              <input type="checkbox" checked={!nascoste.includes(h.chiave)} onChange={() => alterna(h.chiave)} /> {h.testo}
            </label>
          ))}
          {nascoste.length > 0 && (
            <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 6 }}
              onClick={() => { setNascoste([]); try { localStorage.removeItem(`colhide_${tableId}`); } catch { /* niente */ } }}>
              Mostra tutte
            </button>
          )}
        </div>
      </details>
    </>
  );
}
