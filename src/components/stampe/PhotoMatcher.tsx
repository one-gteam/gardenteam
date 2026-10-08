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
  foto: fotoIniziali, catalogo, onConfirm, onIgnora,
}: {
  foto: FotoDaAbbinare[];
  catalogo: Bersaglio[];
  onConfirm: (coppie: { file: string; target: string }[]) => Promise<{ ok: boolean; n: number }>;
  /** Non proporre più una foto: sparisce dall'elenco senza ricaricare la pagina. */
  onIgnora?: (files: string[]) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [nascoste, setNascoste] = useState<Set<string>>(new Set());
  // anteprima grande al passaggio del mouse sulla miniatura
  const [ingrandita, setIngrandita] = useState<{ url: string; x: number; y: number } | null>(null);
  const foto = fotoIniziali.filter((f) => !nascoste.has(f.file));
  const ignora = async (file: string) => {
    if (!onIgnora) return;
    setNascoste((prev) => new Set([...prev, file]));
    const r = await onIgnora([file]).catch(() => ({ ok: false }));
    if (!r.ok) {
      setNascoste((prev) => { const n = new Set(prev); n.delete(file); return n; });
      setEsito("non sono riuscito a ignorare la foto");
    }
  };
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

  /** «✓ Abbina» sulla riga: conferma solo quella foto, e la riga sparisce senza ricaricare. */
  const [inCorso, setInCorso] = useState<string | null>(null);
  const abbinaUna = async (file: string) => {
    const target = scelte[file];
    if (!target) return;
    setInCorso(file);
    try {
      const res = await onConfirm([{ file, target }]);
      if (res.ok && res.n > 0) {
        setNascoste((prev) => new Set([...prev, file]));
        setEsito(`✓ ${file} abbinata a ${etichetta.get(target) ?? target}`);
      } else setEsito("abbinamento non riuscito");
    } catch {
      setEsito("abbinamento non riuscito");
    } finally {
      setInCorso(null);
    }
  };

  const conferma = async () => {
    const coppie = Object.entries(scelte)
      .filter(([file, target]) => target && !nascoste.has(file))
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
      {ingrandita && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ingrandita.url} alt="" style={{
          position: "fixed", zIndex: 100, pointerEvents: "none",
          left: Math.min(ingrandita.x, window.innerWidth - 340), top: Math.max(8, Math.min(ingrandita.y - 60, window.innerHeight - 340)),
          width: 320, height: 320, objectFit: "contain", background: "#fff", borderRadius: 10, padding: 6,
          border: "1px solid var(--line)", boxShadow: "0 12px 30px rgba(0,0,0,.25)",
        }} />
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th style={{ width: 56 }}>Foto</th><th>File</th><th>Abbina a</th><th></th></tr>
          </thead>
          <tbody>
            {foto.map((f) => {
              const scelto = scelte[f.file] ?? "";
              const trovati = risultati(f.file);
              return (
                <tr key={f.file}>
                  <td>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img loading="lazy" decoding="async" src={f.url} alt=""
                      style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 6, border: "1px solid #eee", cursor: "zoom-in" }}
                      onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setIngrandita({ url: f.url, x: r.right + 12, y: r.top }); }}
                      onMouseLeave={() => setIngrandita(null)} />
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
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="btn btn-sm" disabled={!scelto || inCorso === f.file}
                      title={scelto ? "Abbina solo questa foto, subito" : "Scegli prima l'articolo o il padre"}
                      onClick={() => abbinaUna(f.file)}>
                      {inCorso === f.file ? "…" : "✓ Abbina"}
                    </button>
                    {onIgnora && (
                      <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: 6 }} title="Non proporre più questa foto" onClick={() => ignora(f.file)}>
                        Ignora
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
        <button className="btn btn-sm" type="button" onClick={conferma} disabled={pending}>Conferma tutti gli abbinamenti scelti</button>
        {esito && <span style={{ fontSize: 12, color: esito.startsWith("✓") ? "var(--green-700)" : "var(--muted)" }}>{esito}</span>}
      </div>
    </div>
  );
}
