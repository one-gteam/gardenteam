"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { eliminaFileOrfani } from "@/lib/actions";
import type { StoredFile } from "@/lib/storage-audit";

const mb = (kb: number) => (kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`);

/**
 * Elenco dei file dello spazio di archiviazione con il loro stato.
 * Si possono selezionare ed eliminare solo quelli non più usati: gli altri
 * non hanno nemmeno la casella di spunta.
 */
export default function ArchivioPanel({
  files, cartelle, gestibili,
}: {
  files: StoredFile[];
  cartelle: { id: string; label: string; nota: string }[];
  gestibili: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sel, setSel] = useState<string[]>([]);
  const [esito, setEsito] = useState("");
  const [soloOrfani, setSoloOrfani] = useState(true);
  const [cartella, setCartella] = useState("");

  const visibili = useMemo(
    () => files.filter((f) => (!soloOrfani || !f.usato) && (!cartella || f.cartella === cartella)),
    [files, soloOrfani, cartella]
  );
  const eliminabili = visibili.filter((f) => !f.usato && !f.recente && gestibili.includes(f.cartella));

  const orfani = files.filter((f) => !f.usato);
  const spazioOrfani = orfani.reduce((a, f) => a + f.sizeKb, 0);
  const spazioTotale = files.reduce((a, f) => a + f.sizeKb, 0);

  const elimina = () => {
    if (!confirm(`Eliminare definitivamente ${sel.length} file? L'operazione non è reversibile.`)) return;
    startTransition(async () => {
      const res = await eliminaFileOrfani(sel);
      setEsito(res.ok ? `Eliminati ${res.eliminati} file.` : `Errore: ${res.error ?? "operazione non riuscita"}`);
      setSel([]);
      router.refresh();
    });
  };

  return (
    <div>
      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <div className="card stat"><div className="num">{files.length}</div><div className="lbl">File in archivio</div></div>
        <div className="card stat"><div className="num">{mb(spazioTotale)}</div><div className="lbl">Spazio occupato</div></div>
        <div className="card stat"><div className="num">{orfani.length}</div><div className="lbl">Non più usati</div></div>
        <div className="card stat"><div className="num">{mb(spazioOrfani)}</div><div className="lbl">Spazio recuperabile</div></div>
      </div>

      <div className="card" style={{ marginBottom: 14, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <label className="field" style={{ marginBottom: 0, minWidth: 240 }}>
          Cartella
          <select value={cartella} onChange={(e) => { setCartella(e.target.value); setSel([]); }}>
            <option value="">Tutte</option>
            {cartelle.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="checkbox-row" style={{ margin: 0 }}>
          <input type="checkbox" checked={soloOrfani} onChange={(e) => { setSoloOrfani(e.target.checked); setSel([]); }} />
          Mostra solo i file non più usati
        </label>
        <span style={{ flex: 1 }} />
        {eliminabili.length > 0 && (
          <button className="btn btn-outline btn-sm" type="button"
            onClick={() => setSel(sel.length === eliminabili.length ? [] : eliminabili.map((f) => f.path))}>
            {sel.length === eliminabili.length ? "Deseleziona tutti" : `Seleziona gli ${eliminabili.length} eliminabili`}
          </button>
        )}
        <button className="btn btn-sm danger" type="button" disabled={sel.length === 0 || pending}
          style={sel.length > 0 ? { background: "var(--red)", color: "#fff" } : undefined}
          onClick={elimina}>
          {pending ? "Eliminazione…" : `Elimina i ${sel.length} selezionati`}
        </button>
      </div>

      {esito && <div className={`alert ${esito.startsWith("Errore") ? "alert-amber" : "alert-green"}`}>{esito}</div>}

      <div className="card table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 30 }}></th>
              <th>File</th>
              <th>Cartella</th>
              <th>Dimensione</th>
              <th>Modificato</th>
              <th>Stato</th>
            </tr>
          </thead>
          <tbody>
            {visibili.length === 0 && (
              <tr><td colSpan={6} className="empty">Nessun file da mostrare: l&apos;archivio è in ordine.</td></tr>
            )}
            {visibili.slice(0, 400).map((f) => {
              const puoEliminare = !f.usato && !f.recente && gestibili.includes(f.cartella);
              return (
                <tr key={f.path} style={{ opacity: f.usato ? 0.65 : 1 }}>
                  <td>
                    {puoEliminare && (
                      <input
                        type="checkbox"
                        checked={sel.includes(f.path)}
                        onChange={(e) => setSel((prev) => (e.target.checked ? [...prev, f.path] : prev.filter((x) => x !== f.path)))}
                      />
                    )}
                  </td>
                  <td style={{ maxWidth: 420, wordBreak: "break-all", fontSize: 12.5 }}>{f.nome}</td>
                  <td style={{ fontSize: 12.5 }}>{cartelle.find((c) => c.id === f.cartella)?.label ?? f.cartella}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{mb(f.sizeKb)}</td>
                  <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>
                    {f.modificato ? new Date(f.modificato).toLocaleDateString("it-IT") : "—"}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {f.usato ? (
                      <span className="pill pill-green">in uso</span>
                    ) : f.recente ? (
                      <span className="pill pill-amber" title="Caricato da meno di 24 ore: protetto, potrebbe essere in lavorazione">
                        recente — protetto
                      </span>
                    ) : gestibili.includes(f.cartella) ? (
                      <span className="pill pill-red">non più usato</span>
                    ) : (
                      <span className="pill pill-gray" title="Non più usato, ma la pulizia di questa cartella spetta a un altro ruolo">
                        non più usato — altra cartella
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visibili.length > 400 && (
          <p className="hint" style={{ marginTop: 8 }}>Mostrati i primi 400 file su {visibili.length}: usa i filtri.</p>
        )}
      </div>
    </div>
  );
}
