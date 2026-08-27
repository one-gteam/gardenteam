"use client";

import { useMemo, useState, useTransition } from "react";

export interface FotoDaAbbinare {
  file: string;
  url: string;
  /** proposte calcolate dal nome del file: id già pronti da confermare */
  candidati: { id: string; label: string; score: number }[];
}
/** Bersaglio possibile di un abbinamento: un articolo ("z_…") o un prodotto padre ("p:…"). */
export interface Bersaglio { id: string; label: string }

/**
 * Abbinamento foto → articolo/padre. Le proposte automatiche sono solo un punto
 * di partenza: con la ricerca si può scegliere QUALSIASI articolo o prodotto
 * padre, anche quando il nome del file non somiglia a nulla e non ci sono
 * proposte. Il catalogo arriva una volta sola (non per riga) e si filtra qui.
 */
export default function PhotoMatcher({
  foto, catalogo, onConfirm,
}: {
  foto: FotoDaAbbinare[];
  catalogo: Bersaglio[];
  onConfirm: (coppie: { file: string; target: string }[]) => Promise<{ ok: boolean; n: number }>;
}) {
  const [scelte, setScelte] = useState<Record<string, string>>(
    () => Object.fromEntries(foto.map((f) => [f.file, f.candidati[0]?.id ?? ""]))
  );
  const [ricerche, setRicerche] = useState<Record<string, string>>({});
  const [esito, setEsito] = useState("");
  const [pending, startTransition] = useTransition();

  const etichetta = useMemo(() => new Map(catalogo.map((c) => [c.id, c.label])), [catalogo]);

  const risultati = (file: string) => {
    const q = (ricerche[file] ?? "").trim().toLowerCase();
    if (q.length < 2) return [];
    const parole = q.split(/\s+/);
    return catalogo.filter((c) => {
      const l = c.label.toLowerCase();
      return parole.every((p) => l.includes(p));
    }).slice(0, 30);
  };

  const conferma = async () => {
    const coppie = Object.entries(scelte)
      .filter(([, target]) => target)
      .map(([file, target]) => ({ file, target }));
    if (coppie.length === 0) { setEsito("Nessun abbinamento da confermare."); return; }
    setEsito("salvataggio…");
    try {
      const res = await onConfirm(coppie);
      setEsito(res.ok ? `✓ ${res.n} foto abbinate` : "errore nel salvataggio");
      if (res.ok) startTransition(() => { window.location.reload(); });
    } catch {
      setEsito("errore nel salvataggio");
    }
  };

  return (
    <div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th style={{ width: 56 }}>Foto</th><th>File</th><th>Abbina a</th></tr>
          </thead>
          <tbody>
            {foto.map((f) => {
              const scelto = scelte[f.file] ?? "";
              const trovati = risultati(f.file);
              return (
                <tr key={f.file}>
                  <td>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.url} alt="" style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 6, border: "1px solid #eee" }} />
                  </td>
                  <td style={{ fontSize: 12 }}>{f.file}</td>
                  <td>
                    <select
                      value={scelto}
                      onChange={(e) => setScelte({ ...scelte, [f.file]: e.target.value })}
                      style={{ fontSize: 12.5, maxWidth: 420, marginTop: 0 }}
                    >
                      <option value="">— nessuno —</option>
                      {f.candidati.map((c) => (
                        <option key={c.id} value={c.id}>{Math.round(c.score * 100)}% — {c.label}</option>
                      ))}
                      {/* scelto con la ricerca: resta selezionabile anche se non era fra le proposte */}
                      {scelto && !f.candidati.some((c) => c.id === scelto) && (
                        <option value={scelto}>✓ {etichetta.get(scelto) ?? scelto}</option>
                      )}
                    </select>
                    <div style={{ marginTop: 4 }}>
                      <input
                        type="search"
                        placeholder={f.candidati.length === 0 ? "nessuna proposta: cerca l'articolo o il padre…" : "cerca un altro articolo o padre…"}
                        value={ricerche[f.file] ?? ""}
                        onChange={(e) => setRicerche({ ...ricerche, [f.file]: e.target.value })}
                        style={{ fontSize: 11.5, marginTop: 0, width: "100%", maxWidth: 420, padding: "3px 6px" }}
                      />
                      {trovati.length > 0 && (
                        <div style={{ maxHeight: 150, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 6, marginTop: 3, background: "#fff" }}>
                          {trovati.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                setScelte({ ...scelte, [f.file]: c.id });
                                setRicerche({ ...ricerche, [f.file]: "" });
                              }}
                              style={{
                                display: "block", width: "100%", textAlign: "left", border: "none",
                                background: "transparent", cursor: "pointer", fontSize: 11.5, padding: "3px 6px",
                              }}
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                      )}
                      {(ricerche[f.file] ?? "").trim().length >= 2 && trovati.length === 0 && (
                        <span className="hint" style={{ fontSize: 11 }}>nessun risultato</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
        <button className="btn btn-sm" type="button" onClick={conferma} disabled={pending}>Conferma abbinamenti</button>
        {esito && <span style={{ fontSize: 12, color: esito.startsWith("✓") ? "var(--green-700)" : "var(--muted)" }}>{esito}</span>}
      </div>
    </div>
  );
}
