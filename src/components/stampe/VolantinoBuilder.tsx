"use client";

import { useMemo, useState } from "react";
import { saveVolantinoLayout, updateZooOfferQuick } from "@/lib/zoo-actions";
import type { VolPage, VolCell } from "@/lib/zoo";

export interface OffLite {
  id: string; descrizione: string; prezzo: string; prezzoListino?: string; foto: string;
  voti: number; nonTrattati: number; scheda?: string;
  marca: string; fornitore: string; caratts: string[]; label?: string;
}

const nuovaRiga = (cols: number) => ({ cols, cells: Array.from({ length: cols }, () => ({ span: 1, tipo: "vuoto" }) as VolCell) });
const pagina = (titolo: string, righe = 3, cols = 3): VolPage => ({
  id: `vp_${titolo.toLowerCase().replace(/[^a-z0-9]/g, "")}_${Math.random().toString(36).slice(2, 6)}`,
  titolo,
  rows: Array.from({ length: righe }, () => nuovaRiga(cols)),
});

/** Struttura standard del volantino zoo: copertina + 7 pagine tematiche. */
const PAGINE_DEFAULT = (): VolPage[] => [
  pagina("Copertina", 2, 2),
  pagina("Gatto — pag. 2"), pagina("Gatto — pag. 3"),
  pagina("Cane — pag. 4"), pagina("Cane — pag. 5"),
  pagina("Accessori — pag. 6"),
  pagina("Piccoli animali — pag. 7"),
  pagina("Acquario e rettili — pag. 8"),
];

const UNITS = 60; // base della griglia: 60 è divisibile per 2, 3, 4, 5

/** Posizionamento celle in griglia unica (necessario per le unioni verticali). */
function placeCells(page: VolPage) {
  const placed: { cell: VolCell; ri: number; ci: number; colStart: number; colEnd: number; rowStart: number; rowEnd: number }[] = [];
  let carry: { start: number; end: number }[] = [];
  page.rows.forEach((row, ri) => {
    const width = UNITS / row.cols;
    let cursor = 0;
    const nextCarry: { start: number; end: number }[] = [...carry.map((c) => ({ ...c }))];
    row.cells.forEach((cell, ci) => {
      // salta gli spazi occupati da celle unite verticalmente della riga sopra
      let free = false;
      while (!free) {
        const hit = carry.find((c) => cursor < c.end && cursor + 1 > c.start);
        if (hit) cursor = hit.end;
        else free = true;
      }
      const w = Math.round(width * Math.min(cell.span, row.cols));
      placed.push({
        cell, ri, ci,
        colStart: cursor + 1, colEnd: Math.min(cursor + w, UNITS) + 1,
        rowStart: ri + 1, rowEnd: ri + 1 + (cell.vspan === 2 ? 2 : 1),
      });
      if (cell.vspan === 2) nextCarry.push({ start: cursor, end: cursor + w });
      cursor += w;
    });
    carry = nextCarry.filter((c) => placed.some((p) => p.rowEnd > ri + 2 && p.colStart - 1 === c.start));
  });
  return placed;
}

export default function VolantinoBuilder({
  campaignId, offers, initialPages, excelHref, animali, caratts, labels, marche, fornitori,
}: {
  campaignId: string; offers: OffLite[]; initialPages: VolPage[]; excelHref: string;
  animali: string[]; caratts: string[]; labels: string[]; marche: string[]; fornitori: string[];
}) {
  const [pages, setPages] = useState<VolPage[]>(initialPages.length ? initialPages : PAGINE_DEFAULT());
  const [saved, setSaved] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [affiancate, setAffiancate] = useState(true);
  const [editing, setEditing] = useState<{ pi: number; ri: number; ci: number } | null>(null);
  const [f, setF] = useState({ animale: "", caratt: "", label: "", minVoti: "", minNon: "", marca: "", fornitore: "" });

  const filtered = useMemo(() => offers.filter((o) => {
    if (f.animale && !o.caratts.includes(f.animale)) return false;
    if (f.caratt && !o.caratts.includes(f.caratt)) return false;
    if (f.label && o.label !== f.label) return false;
    if (f.minVoti && o.voti < Number(f.minVoti)) return false;
    if (f.minNon && o.nonTrattati < Number(f.minNon)) return false;
    if (f.marca && o.marca !== f.marca) return false;
    if (f.fornitore && o.fornitore !== f.fornitore) return false;
    return true;
  }), [offers, f]);

  const upd = (fn: (p: VolPage[]) => VolPage[]) => { setSaved(""); setPages((prev) => fn(structuredClone(prev))); };
  const cellAt = (ps: VolPage[], pi: number, ri: number, ci: number) => ps[pi].rows[ri].cells[ci];
  const offer = (id?: string) => offers.find((o) => o.id === id);

  /** Unione orizzontale: la cella assorbe la successiva (e viceversa quando si separa). */
  const toggleSpan = (pi: number, ri: number, ci: number) => upd((ps) => {
    const row = ps[pi].rows[ri];
    const c = row.cells[ci];
    if (c.span > 1) {
      c.span = 1;
      row.cells.splice(ci + 1, 0, { span: 1, tipo: "vuoto" });
    } else if (ci + 1 < row.cells.length) {
      row.cells.splice(ci + 1, 1); // la cella a destra viene assorbita
      c.span = 2;
    }
    return ps;
  });

  /** Unione verticale: assorbe la cella corrispondente della riga sotto (stessa griglia). */
  const toggleVspan = (pi: number, ri: number, ci: number) => upd((ps) => {
    const rows = ps[pi].rows;
    const c = rows[ri].cells[ci];
    if (c.vspan === 2) {
      delete c.vspan;
      if (rows[ri + 1]) rows[ri + 1].cells.splice(ci, 0, { span: 1, tipo: "vuoto" });
    } else if (rows[ri + 1] && rows[ri + 1].cols === rows[ri].cols && rows[ri + 1].cells[ci]) {
      rows[ri + 1].cells.splice(ci, 1); // lo spazio sotto viene assorbito
      c.vspan = 2;
    }
    return ps;
  });

  const drop = (pi: number, ri: number, ci: number) => {
    if (!dragId) return;
    upd((ps) => { const c = cellAt(ps, pi, ri, ci); c.tipo = "offerta"; c.offerId = dragId; delete c.testo; delete c.descrizione; delete c.prezzo; return ps; });
    setDragId(null);
  };

  const salva = async () => {
    const res = await saveVolantinoLayout(campaignId, JSON.stringify(pages));
    setSaved(res.ok ? "Salvato" : "Errore nel salvataggio");
  };

  const renderPage = (page: VolPage, pi: number) => (
    <div key={page.id} className="card vol-page" style={{ padding: 12, width: 470, maxWidth: "100%" }}>
      <div className="no-print" style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <input value={page.titolo ?? ""} onChange={(e) => upd((ps) => { ps[pi].titolo = e.target.value; return ps; })}
          style={{ marginTop: 0, width: 170, fontWeight: 700, fontSize: 13 }} />
        {[3, 4].map((n) => (
          <button key={n} className="mini-btn" onClick={() => upd((ps) => { ps[pi].rows.push(nuovaRiga(n)); return ps; })}>+ riga da {n}</button>
        ))}
        {pages.length > 1 && (
          <button className="mini-btn" style={{ color: "var(--red)" }} title="Elimina pagina"
            onClick={() => confirm("Eliminare questa pagina?") && upd((ps) => ps.filter((_, i) => i !== pi))}>✕ pagina</button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${UNITS}, 1fr)`, gridAutoRows: "minmax(118px, auto)", gap: 6 }}>
        {placeCells(page).map(({ cell, ri, ci, colStart, colEnd, rowStart, rowEnd }) => {
          const o = cell.tipo === "offerta" ? offer(cell.offerId) : undefined;
          const isEditing = editing && editing.pi === pi && editing.ri === ri && editing.ci === ci;
          return (
            <div key={`${ri}_${ci}`} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(pi, ri, ci)}
              style={{
                gridColumn: `${colStart} / ${colEnd}`, gridRow: `${rowStart} / ${rowEnd}`,
                borderRadius: 8, position: "relative", padding: 6, minWidth: 0,
                border: cell.tipo === "vuoto" ? "1.5px dashed var(--line)" : "1px solid var(--line)",
                background: cell.tipo === "vuoto" ? "var(--sand)" : "#fff",
              }}>
              {o && !isEditing && (
                <div style={{ textAlign: "center", fontSize: 11.5, overflow: "hidden" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={o.foto} alt="" style={{ maxWidth: "100%", height: cell.vspan === 2 ? 110 : 48, objectFit: "contain" }} />
                  <div style={{ fontWeight: 600, lineHeight: 1.2 }}>{cell.descrizione ?? o.descrizione}</div>
                  <div style={{ color: "#c2410c", fontWeight: 800, fontSize: 15 }}>
                    € {cell.prezzo ?? o.prezzo}{" "}
                    {o.prezzoListino && <span style={{ fontSize: 10, color: "var(--muted)", textDecoration: "line-through", fontWeight: 400 }}>€ {o.prezzoListino}</span>}
                  </div>
                  {(cell.descrizione || cell.prezzo) && <span className="pill pill-amber no-print" title="Modificata solo per questo volantino">solo volantino</span>}
                </div>
              )}
              {o && isEditing && (
                <div className="no-print" style={{ fontSize: 11.5 }}>
                  <input id={`ed_d_${pi}_${ri}_${ci}`} defaultValue={cell.descrizione ?? o.descrizione} style={{ marginTop: 0, fontSize: 11.5 }} />
                  <input id={`ed_p_${pi}_${ri}_${ci}`} defaultValue={cell.prezzo ?? o.prezzo} style={{ marginTop: 4, fontSize: 11.5, width: 80 }} />
                  <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                    <button className="mini-btn" onClick={() => {
                      const d = (document.getElementById(`ed_d_${pi}_${ri}_${ci}`) as HTMLInputElement).value;
                      const p = (document.getElementById(`ed_p_${pi}_${ri}_${ci}`) as HTMLInputElement).value;
                      upd((ps) => { const c = cellAt(ps, pi, ri, ci); c.descrizione = d; c.prezzo = p; return ps; });
                      setEditing(null);
                    }}>Solo volantino</button>
                    <button className="mini-btn" onClick={async () => {
                      const d = (document.getElementById(`ed_d_${pi}_${ri}_${ci}`) as HTMLInputElement).value;
                      const p = (document.getElementById(`ed_p_${pi}_${ri}_${ci}`) as HTMLInputElement).value;
                      await updateZooOfferQuick(o.id, d, p);
                      upd((ps) => { const c = cellAt(ps, pi, ri, ci); delete c.descrizione; delete c.prezzo; return ps; });
                      setEditing(null);
                      window.location.reload(); // ricarica i dati aggiornati dell'offerta
                    }}>Salva nel database</button>
                    <button className="mini-btn" onClick={() => setEditing(null)}>Annulla</button>
                  </div>
                </div>
              )}
              {cell.tipo === "offerta" && !o && <span className="hint">offerta rimossa</span>}
              {cell.tipo === "testo" && (
                <textarea value={cell.testo ?? ""} placeholder="Testo libero…" rows={cell.vspan === 2 ? 9 : 4}
                  onChange={(e) => upd((ps) => { cellAt(ps, pi, ri, ci).testo = e.target.value; return ps; })}
                  style={{ marginTop: 0, border: "none", background: "transparent", resize: "none", fontWeight: 600, textAlign: "center", fontSize: 12 }} />
              )}
              {cell.tipo === "vuoto" && <div className="no-print" style={{ textAlign: "center", color: "var(--muted)", fontSize: 10.5, paddingTop: 34 }}>trascina qui</div>}
              <div className="no-print" style={{ position: "absolute", top: 2, right: 2, display: "flex", gap: 2 }}>
                {o && <button className="mini-btn" title="Modifica descrizione/prezzo" onClick={() => setEditing({ pi, ri, ci })}>✎</button>}
                <button className="mini-btn" title={cell.span > 1 ? "Separa in orizzontale" : "Unisci con lo spazio a destra"} onClick={() => toggleSpan(pi, ri, ci)}>
                  {cell.span > 1 ? "⇤" : "⇥"}
                </button>
                <button className="mini-btn" title={cell.vspan === 2 ? "Separa in verticale" : "Unisci con lo spazio sotto"} onClick={() => toggleVspan(pi, ri, ci)}>
                  {cell.vspan === 2 ? "⤒" : "⤓"}
                </button>
                <button className="mini-btn" title="Cella di solo testo" onClick={() => upd((ps) => { const c = cellAt(ps, pi, ri, ci); c.tipo = "testo"; delete c.offerId; return ps; })}>T</button>
                <button className="mini-btn" title="Svuota" onClick={() => upd((ps) => { const c = cellAt(ps, pi, ri, ci); c.tipo = "vuoto"; delete c.offerId; delete c.testo; delete c.descrizione; delete c.prezzo; return ps; })}>✕</button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="no-print" style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
        {page.rows.map((row, ri) => (
          <span key={ri} style={{ fontSize: 10.5, color: "var(--muted)" }}>
            riga {ri + 1}:{" "}
            {[2, 3, 4, 5].map((n) => (
              <button key={n} className="mini-btn" style={row.cols === n ? { background: "var(--green-100)" } : undefined}
                onClick={() => upd((ps) => {
                  const r = ps[pi].rows[ri];
                  r.cols = n;
                  while (r.cells.reduce((a, c) => a + c.span, 0) < n) r.cells.push({ span: 1, tipo: "vuoto" });
                  while (r.cells.reduce((a, c) => a + c.span, 0) > n && r.cells.length > 1) r.cells.pop();
                  return ps;
                })}>{n}</button>
            ))}
            <button className="mini-btn" title="Elimina riga" onClick={() => upd((ps) => { ps[pi].rows.splice(ri, 1); return ps; })}>✕</button>
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "250px 1fr", gap: 14, alignItems: "start" }}>
      {/* filtro + offerte trascinabili */}
      <div className="card no-print" style={{ padding: 10, maxHeight: 860, overflowY: "auto" }}>
        <strong style={{ fontSize: 13 }}>Filtro offerte</strong>
        <div style={{ display: "grid", gap: 4, margin: "6px 0 10px" }}>
          <select value={f.animale} onChange={(e) => setF({ ...f, animale: e.target.value })} style={{ marginTop: 0 }}>
            <option value="">Animale: tutti</option>
            {animali.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={f.caratt} onChange={(e) => setF({ ...f, caratt: e.target.value })} style={{ marginTop: 0 }}>
            <option value="">Caratteristica: tutte</option>
            {caratts.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} style={{ marginTop: 0 }}>
            <option value="">Tipologia offerta: tutte</option>
            {labels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <div style={{ display: "flex", gap: 4 }}>
            <input type="number" min={0} placeholder="Voti ≥" value={f.minVoti} onChange={(e) => setF({ ...f, minVoti: e.target.value })} style={{ marginTop: 0, fontSize: 12 }} />
            <input type="number" min={0} placeholder="Non tratt. ≥" value={f.minNon} onChange={(e) => setF({ ...f, minNon: e.target.value })} style={{ marginTop: 0, fontSize: 12 }} />
          </div>
          <select value={f.marca} onChange={(e) => setF({ ...f, marca: e.target.value })} style={{ marginTop: 0 }}>
            <option value="">Marca: tutte</option>
            {marche.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={f.fornitore} onChange={(e) => setF({ ...f, fornitore: e.target.value })} style={{ marginTop: 0 }}>
            <option value="">Fornitore: tutti</option>
            {fornitori.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <strong style={{ fontSize: 12.5 }}>Offerte ({filtered.length})</strong>
        {filtered.map((o) => (
          <div key={o.id} draggable onDragStart={() => setDragId(o.id)}
            style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 8, marginTop: 6, cursor: "grab", background: "#fff" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={o.foto} alt="" style={{ width: 32, height: 32, objectFit: "contain" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.descrizione}</div>
              <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
                € {o.prezzo} {o.voti > 0 && <span className="pill pill-green">{o.voti} voti</span>}{" "}
                {o.nonTrattati > 0 && <span className="pill pill-red">{o.nonTrattati} n.t.</span>}
                {o.label && <span className="pill pill-blue">{o.label}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* pagine */}
      <div>
        <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn btn-sm" onClick={salva}>Salva volantino</button>
          <button className="btn btn-outline btn-sm" onClick={() => window.print()}>Esporta PDF (stampa)</button>
          <a className="btn btn-outline btn-sm" href={excelHref}>Esporta Excel per il grafico</a>
          <button className="btn btn-outline btn-sm" onClick={() => upd((ps) => [...ps, pagina(`Pagina ${ps.length + 1}`)])}>+ Pagina</button>
          <label style={{ fontSize: 12.5, display: "flex", gap: 5, alignItems: "center" }}>
            <input type="checkbox" checked={affiancate} onChange={(e) => setAffiancate(e.target.checked)} />
            Pagine affiancate (copertina da sola)
          </label>
          {saved && <span className={`pill ${saved === "Salvato" ? "pill-green" : "pill-red"}`}>{saved}</span>}
        </div>

        {affiancate ? (
          <>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>{pages[0] && renderPage(pages[0], 0)}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
              {pages.slice(1).map((p, i) => renderPage(p, i + 1))}
            </div>
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
            {pages.map((p, i) => renderPage(p, i))}
          </div>
        )}
      </div>
    </div>
  );
}
