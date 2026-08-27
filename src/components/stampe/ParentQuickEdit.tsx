"use client";

import { useState, useTransition } from "react";

export interface ArticoloLite { id: string; ean: string; descrizione: string }
export interface PadreLite { id: string; nome: string }

/**
 * Due operazioni rapide sul prodotto padre aperto, dentro la riga di dettaglio:
 * spostare un suo articolo sotto un altro padre e scegliere per il padre una
 * delle foto già caricate. Client component perché entrambe salvano subito
 * (senza ricaricare la pagina ad ogni scelta) e mostrano l'esito accanto.
 */
export default function ParentQuickEdit({
  parentId, articoli, padri, foto, urlFoto, onMove, onSetImage,
}: {
  parentId: string;
  articoli: ArticoloLite[];
  padri: PadreLite[];
  foto: string[];
  /** prefisso per costruire l'anteprima di una foto del bucket */
  urlFoto: (file: string) => string;
  onMove: (productId: string, newParentId: string) => Promise<{ ok: boolean }>;
  onSetImage: (fileName: string) => Promise<{ ok: boolean }>;
}) {
  const [esito, setEsito] = useState("");
  const [fotoScelta, setFotoScelta] = useState("");
  const [pending, startTransition] = useTransition();

  const sposta = async (productId: string, newParentId: string) => {
    const res = await onMove(productId, newParentId);
    setEsito(res.ok ? "✓ articolo spostato — ricarica per vedere l'elenco aggiornato" : "errore nello spostamento");
    if (res.ok) startTransition(() => { window.location.reload(); });
  };

  const usaFoto = async () => {
    if (!fotoScelta) return;
    const res = await onSetImage(fotoScelta);
    setEsito(res.ok ? "✓ foto del padre aggiornata" : "errore nel salvataggio della foto");
    if (res.ok) startTransition(() => { window.location.reload(); });
  };

  return (
    <div style={{ marginTop: 10 }}>
      {foto.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <strong style={{ fontSize: 12.5 }}>Usa una foto già caricata</strong>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
            <select value={fotoScelta} onChange={(e) => setFotoScelta(e.target.value)} style={{ fontSize: 11.5, marginTop: 0, maxWidth: 260 }}>
              <option value="">scegli fra le {foto.length} non abbinate…</option>
              {foto.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            {fotoScelta && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={urlFoto(fotoScelta)} alt="" style={{ width: 34, height: 34, objectFit: "contain", border: "1px solid #eee", borderRadius: 4, background: "#fff" }} />
            )}
            <button type="button" className="btn btn-outline btn-sm" disabled={!fotoScelta || pending} onClick={usaFoto}>
              Usa questa
            </button>
          </div>
        </div>
      )}

      <strong style={{ fontSize: 12.5 }}>Articoli del padre ({articoli.length})</strong>
      <p className="hint" style={{ margin: "2px 0 6px", fontSize: 11 }}>
        Se un articolo è finito nel padre sbagliato, spostalo qui: la tendina elenca tutti gli altri prodotti padre.
      </p>
      <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", fontSize: 12 }}>
        {articoli.map((a) => (
          <li key={a.id} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              {a.descrizione} <span style={{ color: "var(--muted)" }}>· EAN {a.ean}</span>
            </span>
            <select
              defaultValue={parentId}
              disabled={pending}
              onChange={(e) => sposta(a.id, e.target.value)}
              style={{ fontSize: 11, marginTop: 0, maxWidth: 220 }}
            >
              <option value={parentId}>resta in questo padre</option>
              <option value="">— togli dal padre —</option>
              {padri.filter((p) => p.id !== parentId).map((p) => (
                <option key={p.id} value={p.id}>sposta in: {p.nome}</option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      {esito && <div style={{ fontSize: 11.5, marginTop: 6, color: esito.startsWith("✓") ? "var(--green-700)" : "#a33" }}>{esito}</div>}
    </div>
  );
}
