"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { accendiProdottiCatalogo, salvaQuantitaMano } from "@/lib/stampe-actions";

export interface RigaCatalogo { id: string; codice: string; titolo: string; marca: string; tipologia: string; foto: string; acceso: boolean; quantita?: number; varianti: number }

/**
 * L'elenco dei prodotti del catalogo: per l'insegna gli interruttori (uno per
 * prodotto, uno per tipologia); per il punto vendita la colonna delle quantità,
 * che si scrive a mano e si salva da sola.
 */
export default function CatalogoProdotti({ righe, scopeParam, puoAccendere, puoQuantita, gestioneQuantita }: {
  righe: RigaCatalogo[];
  scopeParam: string;
  puoAccendere: boolean;
  puoQuantita: boolean;
  gestioneQuantita: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [errore, setErrore] = useState("");
  const [locali, setLocali] = useState<Record<string, boolean>>({});
  const [salvato, setSalvato] = useState<Record<string, string>>({});
  const esegui = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => {
    const r = await fn().catch(() => ({ ok: false, error: "errore di rete" }));
    setErrore(r.ok ? "" : r.error ?? "non riuscito");
    router.refresh();
  });
  const accendi = (ids: string[], on: boolean) => {
    setLocali((l) => { const n = { ...l }; for (const id of ids) n[id] = on; return n; });
    esegui(() => accendiProdottiCatalogo(scopeParam, ids, on));
  };
  const testo = q.trim().toLowerCase();
  const visibili = useMemo(() => righe.filter((r) => !testo || `${r.titolo} ${r.codice} ${r.marca} ${r.tipologia}`.toLowerCase().includes(testo)), [righe, testo]);
  const tipologie = [...new Set(visibili.map((r) => r.tipologia))].sort((a, b) => a.localeCompare(b, "it"));
  const accesi = righe.filter((r) => locali[r.id] ?? r.acceso).length;

  return (
    <div className="card">
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <h3 style={{ margin: 0, flex: 1 }}>Prodotti {puoAccendere ? "nel catalogo" : ""} <span className="hint" style={{ fontWeight: 500 }}>{accesi} accesi su {righe.length}</span></h3>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="cerca titolo, codice, marca…" style={{ marginTop: 0, width: 240 }} />
        {puoAccendere && <>
          <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => accendi(visibili.map((r) => r.id), true)}>Accendi {testo ? "i trovati" : "tutti"}</button>
          <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => accendi(visibili.map((r) => r.id), false)}>Spegni {testo ? "i trovati" : "tutti"}</button>
        </>}
      </div>
      {errore && <div className="alert alert-amber">{errore}</div>}
      {gestioneQuantita && puoQuantita && <p className="hint" style={{ margin: "0 0 6px" }}>Quantità: scrivi il numero e passa al prossimo, si salva da solo. Vuoto = non gestito (conta come esaurito).</p>}
      {tipologie.map((t) => {
        const del = visibili.filter((r) => r.tipologia === t);
        const nOn = del.filter((r) => locali[r.id] ?? r.acceso).length;
        return (
          <div key={t}>
            <div className="cat-tipologia">
              <strong>{t} <span className="hint" style={{ fontWeight: 500 }}>{nOn}/{del.length}</span></strong>
              {puoAccendere && <>
                <button type="button" className="mini-btn" disabled={pending} onClick={() => accendi(del.map((r) => r.id), true)}>accendi tutti</button>
                <button type="button" className="mini-btn" disabled={pending} onClick={() => accendi(del.map((r) => r.id), false)}>spegni tutti</button>
              </>}
            </div>
            <div className="cat-righe">
              {del.map((r) => {
                const on = locali[r.id] ?? r.acceso;
                return (
                  <div key={r.id} className={`cat-riga${on ? "" : " spento"}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.foto} alt="" />
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.titolo}</strong>
                      <span className="hint">{r.codice} · {r.marca}{r.varianti ? ` · ${r.varianti + 1} colori` : ""}</span>
                    </span>
                    <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      {gestioneQuantita && (
                        puoQuantita ? (
                          <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12 }}>
                            <input className="qta-input" type="number" min={0} step={1} defaultValue={r.quantita ?? ""} placeholder="—"
                              onBlur={(e) => { const v = e.target.value; if (v === String(r.quantita ?? "")) return; setSalvato((s) => ({ ...s, [r.id]: "…" }));
                                salvaQuantitaMano(scopeParam, r.codice, v).then((x) => setSalvato((s) => ({ ...s, [r.id]: x.ok ? "✓" : "✗" }))).catch(() => setSalvato((s) => ({ ...s, [r.id]: "✗" }))); }} />
                            <span style={{ width: 14 }}>{salvato[r.id] ?? ""}</span>
                          </label>
                        ) : <span className="hint" style={{ minWidth: 40, textAlign: "right" }}>{r.quantita ?? "—"}</span>
                      )}
                      {puoAccendere
                        ? <button type="button" className={`interruttore${on ? " on" : ""}`} aria-label={on ? "Spegni" : "Accendi"} disabled={pending} onClick={() => accendi([r.id], !on)} />
                        : <span className={`pill ${on ? "pill-green" : "pill-gray"}`}>{on ? "acceso" : "spento"}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
