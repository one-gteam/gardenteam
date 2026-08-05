"use client";

import { useState } from "react";
import { saveVolantinoLayout } from "@/lib/zoo-actions";
import type { VolPage, VolCell } from "@/lib/zoo";

export interface OffLite {
  id: string; descrizione: string; prezzo: string; prezzoListino?: string; foto: string;
  voti: number; nonTrattati: number; scheda?: string;
}

const nuovaRiga = (cols: number) => ({ cols, cells: Array.from({ length: cols }, () => ({ span: 1, tipo: "vuoto" }) as VolCell) });
const nuovaPagina = (n: number): VolPage => ({ id: `vp_${Date.now()}_${n}`, titolo: `Pagina ${n}`, rows: [nuovaRiga(3), nuovaRiga(3), nuovaRiga(3)] });

/**
 * Costruzione del volantino in stile inpublish: si trascinano le offerte dalla
 * colonna sinistra sugli spazi delle pagine. Ogni riga ha la sua griglia (3, 4…
 * spazi), le celle si possono unire (larghezza doppia), svuotare o trasformare
 * in solo testo. Esporta in PDF (stampa del browser) o Excel per il grafico.
 */
export default function VolantinoBuilder({
  campaignId, offers, initialPages, excelHref,
}: {
  campaignId: string; offers: OffLite[]; initialPages: VolPage[]; excelHref: string;
}) {
  const [pages, setPages] = useState<VolPage[]>(initialPages.length ? initialPages : [nuovaPagina(1)]);
  const [saved, setSaved] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);

  const upd = (fn: (p: VolPage[]) => VolPage[]) => { setSaved(""); setPages((prev) => fn(structuredClone(prev))); };
  const cellAt = (ps: VolPage[], pi: number, ri: number, ci: number) => ps[pi].rows[ri].cells[ci];

  const drop = (pi: number, ri: number, ci: number) => {
    if (!dragId) return;
    upd((ps) => { const c = cellAt(ps, pi, ri, ci); c.tipo = "offerta"; c.offerId = dragId; delete c.testo; return ps; });
    setDragId(null);
  };

  const salva = async () => {
    const res = await saveVolantinoLayout(campaignId, JSON.stringify(pages));
    setSaved(res.ok ? "Salvato" : "Errore nel salvataggio");
  };

  const offer = (id?: string) => offers.find((o) => o.id === id);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "290px 1fr", gap: 14, alignItems: "start" }}>
      {/* offerte trascinabili */}
      <div className="card no-print" style={{ padding: 10, maxHeight: 760, overflowY: "auto" }}>
        <strong style={{ fontSize: 13 }}>Offerte della campagna ({offers.length})</strong>
        <p className="hint" style={{ margin: "4px 0 8px", fontSize: 11.5 }}>Trascina un&apos;offerta su uno spazio del volantino.</p>
        {offers.map((o) => (
          <div key={o.id} draggable onDragStart={() => setDragId(o.id)}
            style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 8, marginBottom: 6, cursor: "grab", background: "#fff" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={o.foto} alt="" style={{ width: 34, height: 34, objectFit: "contain" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.descrizione}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                € {o.prezzo} · {o.voti > 0 && <span className="pill pill-green">{o.voti} voti</span>}{" "}
                {o.nonTrattati > 0 && <span className="pill pill-red">{o.nonTrattati} non trattato</span>}
                {o.scheda && <span className="pill pill-gray">{o.scheda}</span>}
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
          <button className="btn btn-outline btn-sm" onClick={() => upd((ps) => [...ps, nuovaPagina(ps.length + 1)])}>+ Pagina</button>
          {saved && <span className={`pill ${saved === "Salvato" ? "pill-green" : "pill-red"}`}>{saved}</span>}
          <span className="hint" style={{ fontSize: 11.5 }}>Ricorda di salvare prima di uscire.</span>
        </div>

        {pages.map((page, pi) => (
          <div key={page.id} className="card vol-page" style={{ marginBottom: 16, padding: 14 }}>
            <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
              <input value={page.titolo ?? ""} onChange={(e) => upd((ps) => { ps[pi].titolo = e.target.value; return ps; })}
                style={{ marginTop: 0, width: 180, fontWeight: 700 }} />
              <button className="btn btn-outline btn-sm" onClick={() => upd((ps) => { ps[pi].rows.push(nuovaRiga(3)); return ps; })}>+ Riga da 3</button>
              <button className="btn btn-outline btn-sm" onClick={() => upd((ps) => { ps[pi].rows.push(nuovaRiga(4)); return ps; })}>+ Riga da 4</button>
              {pages.length > 1 && (
                <button className="btn btn-outline btn-sm danger" title="Elimina pagina"
                  onClick={() => confirm("Eliminare questa pagina?") && upd((ps) => ps.filter((_, i) => i !== pi))}>✕ pagina</button>
              )}
            </div>
            {page.rows.map((row, ri) => (
              <div key={ri} style={{ display: "grid", gridTemplateColumns: `repeat(${row.cols}, 1fr)`, gap: 6, marginBottom: 6 }}>
                {row.cells.map((cell, ci) => {
                  const o = cell.tipo === "offerta" ? offer(cell.offerId) : undefined;
                  return (
                    <div key={ci} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(pi, ri, ci)}
                      style={{
                        gridColumn: `span ${Math.min(cell.span, row.cols)}`, minHeight: 108, borderRadius: 8, position: "relative",
                        border: cell.tipo === "vuoto" ? "1.5px dashed var(--line)" : "1px solid var(--line)",
                        background: cell.tipo === "vuoto" ? "var(--sand)" : "#fff", padding: 8,
                      }}>
                      {o && (
                        <div style={{ textAlign: "center", fontSize: 12 }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={o.foto} alt="" style={{ maxWidth: "100%", height: 52, objectFit: "contain" }} />
                          <div style={{ fontWeight: 600, lineHeight: 1.25 }}>{o.descrizione}</div>
                          <div style={{ color: "#c2410c", fontWeight: 800, fontSize: 15 }}>
                            € {o.prezzo} {o.prezzoListino && <span style={{ fontSize: 10.5, color: "var(--muted)", textDecoration: "line-through", fontWeight: 400 }}>€ {o.prezzoListino}</span>}
                          </div>
                        </div>
                      )}
                      {cell.tipo === "offerta" && !o && <span className="hint">offerta rimossa</span>}
                      {cell.tipo === "testo" && (
                        <textarea value={cell.testo ?? ""} placeholder="Testo libero…" rows={4}
                          onChange={(e) => upd((ps) => { cellAt(ps, pi, ri, ci).testo = e.target.value; return ps; })}
                          style={{ marginTop: 0, border: "none", background: "transparent", resize: "none", fontWeight: 600, textAlign: "center" }} />
                      )}
                      {cell.tipo === "vuoto" && <div className="no-print" style={{ textAlign: "center", color: "var(--muted)", fontSize: 11, paddingTop: 30 }}>trascina qui</div>}
                      <div className="no-print" style={{ position: "absolute", top: 3, right: 3, display: "flex", gap: 2 }}>
                        <button className="mini-btn" title={cell.span > 1 ? "Torna a larghezza singola" : "Unisci con lo spazio a destra (larghezza doppia)"}
                          onClick={() => upd((ps) => { const c = cellAt(ps, pi, ri, ci); c.span = c.span > 1 ? 1 : 2; return ps; })}>
                          {cell.span > 1 ? "⇤" : "⇥"}
                        </button>
                        <button className="mini-btn" title="Cella di solo testo"
                          onClick={() => upd((ps) => { const c = cellAt(ps, pi, ri, ci); c.tipo = "testo"; delete c.offerId; return ps; })}>T</button>
                        <button className="mini-btn" title="Svuota"
                          onClick={() => upd((ps) => { const c = cellAt(ps, pi, ri, ci); c.tipo = "vuoto"; delete c.offerId; delete c.testo; return ps; })}>✕</button>
                      </div>
                    </div>
                  );
                })}
                <div className="no-print" style={{ gridColumn: `1 / -1`, display: "flex", gap: 6, marginTop: -2 }}>
                  <span className="hint" style={{ fontSize: 10.5 }}>riga da</span>
                  {[2, 3, 4, 5].map((n) => (
                    <button key={n} className="mini-btn" style={row.cols === n ? { background: "var(--green-100)" } : undefined}
                      onClick={() => upd((ps) => {
                        const r = ps[pi].rows[ri];
                        r.cols = n;
                        while (r.cells.length < n) r.cells.push({ span: 1, tipo: "vuoto" });
                        r.cells = r.cells.slice(0, n);
                        return ps;
                      })}>{n}</button>
                  ))}
                  <button className="mini-btn" title="Elimina riga" onClick={() => upd((ps) => { ps[pi].rows.splice(ri, 1); return ps; })}>✕ riga</button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
