"use client";

import { useState, useTransition } from "react";

/**
 * Scegliere per il padre aperto una delle foto già caricate, dentro la riga di
 * dettaglio. Lo spostamento di un articolo in un altro padre ora è sulla riga
 * dell'articolo stesso (SpostaArticolo).
 */
export default function ParentQuickEdit({
  foto, fotoBaseUrl, onSetImage,
}: {
  foto: string[];
  /**
   * Prefisso per costruire l'anteprima di una foto del bucket (es.
   * ".../object/public/academy-gt/zoo-foto/"): una funzione qui non si può
   * passare da un Server Component a un Client Component, per questo è una
   * stringa e non — come prima — un callback.
   */
  fotoBaseUrl: string;
  onSetImage: (fileName: string) => Promise<{ ok: boolean }>;
}) {
  const [esito, setEsito] = useState("");
  const [fotoScelta, setFotoScelta] = useState("");
  const [pending, startTransition] = useTransition();

  const usaFoto = async () => {
    if (!fotoScelta) return;
    const res = await onSetImage(fotoScelta);
    setEsito(res.ok ? "✓ foto del padre aggiornata" : "errore nel salvataggio della foto");
    if (res.ok) startTransition(() => { window.location.reload(); });
  };

  if (foto.length === 0) return null;
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
              <img loading="lazy" decoding="async" src={`${fotoBaseUrl}${encodeURIComponent(fotoScelta)}`} alt="" style={{ width: 34, height: 34, objectFit: "contain", border: "1px solid #eee", borderRadius: 4, background: "#fff" }} />
            )}
            <button type="button" className="btn btn-outline btn-sm" disabled={!fotoScelta || pending} onClick={usaFoto}>
              Usa questa
            </button>
          </div>
        </div>
      )}

      {esito && <div style={{ fontSize: 11.5, marginTop: 6, color: esito.startsWith("✓") ? "var(--green-700)" : "#a33" }}>{esito}</div>}
    </div>
  );
}
