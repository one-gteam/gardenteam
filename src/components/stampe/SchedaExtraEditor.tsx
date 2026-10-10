"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import CaricaMedia from "@/components/stampe/CaricaMedia";
import { salvaSchedaExtra, registraMediaScheda, rimuoviMediaScheda, ereditaSchedaExtra } from "@/lib/stampe-actions";

export interface ProdottoBreve { id: string; codice: string; titolo: string; foto: string; marca: string }
type Origine = "system" | "tenant" | "store" | undefined;

/**
 * Nella scheda del prodotto (Dati prodotti): quello che la scheda online
 * mostra in più — foto aggiuntive, apertura emozionale, accessori e simili.
 * Un'insegna o un PV che non ha scelto nulla eredita dal Consorzio, voce per voce.
 */
export default function SchedaExtraEditor({
  productId, scopeParam, scopeType, canEdit, foto, emozionali, occhiello, frase, accessori, correlati, proposti, prodotti, origine, urlScheda,
}: {
  productId: string;
  scopeParam: string;
  scopeType: "system" | "tenant" | "store";
  canEdit: boolean;
  foto: string[];
  emozionali: { url: string; tipo: "foto" | "video" }[];
  occhiello: string;
  frase: string;
  accessori: ProdottoBreve[];
  correlati: ProdottoBreve[];
  proposti: ProdottoBreve[];
  prodotti: ProdottoBreve[];
  origine: Record<string, Origine>;
  urlScheda: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errore, setErrore] = useState("");
  const [cerca, setCerca] = useState<{ dove: "accessori" | "correlati"; testo: string } | null>(null);
  const esegui = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => {
    const r = await fn().catch(() => ({ ok: false, error: "errore di rete" }));
    setErrore(r.ok ? "" : r.error ?? "non riuscito");
    if (r.ok) router.refresh();
  });
  const salvaLista = (dove: "accessori" | "correlati", ids: string[]) => {
    const fd = new FormData(); fd.set("campo", dove);
    for (const id of ids) fd.append(dove, id);
    esegui(() => salvaSchedaExtra(productId, scopeParam, fd));
  };
  const daDove = (v: Origine) => scopeType === "system" || !v ? null
    : v === scopeType ? <span className="field-version fv-custom">personalizzata</span>
    : <span className="field-version fv-consorzio">{v === "system" ? "Consorzio" : "insegna"}</span>;
  const trovati = cerca ? prodotti.filter((p) => {
    const q = cerca.testo.trim().toLowerCase();
    return q.length >= 2 && p.id !== productId && `${p.titolo} ${p.codice} ${p.marca}`.toLowerCase().includes(q);
  }).slice(0, 8) : [];
  const lista = (dove: "accessori" | "correlati", voci: ProdottoBreve[], titolo: string, spiega: string) => (
    <div style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
        <strong style={{ fontSize: 13, flex: 1 }}>{titolo} <span className="hint" style={{ fontWeight: 500 }}>{spiega}</span></strong>
        {daDove(origine[dove])}
        {canEdit && scopeType !== "system" && origine[dove] === scopeType && (
          <button type="button" className="mini-btn" disabled={pending} onClick={() => esegui(() => ereditaSchedaExtra(productId, scopeParam, dove))}>torna a quelli del Consorzio</button>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {voci.map((p) => (
          <span key={p.id} className="sx-chip" title={`${p.codice} · ${p.marca}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.foto} alt="" />
            <span>{p.titolo}</span>
            {canEdit && <button type="button" aria-label="Togli" disabled={pending} onClick={() => salvaLista(dove, voci.filter((x) => x.id !== p.id).map((x) => x.id))}>×</button>}
          </span>
        ))}
        {voci.length === 0 && <span className="hint">nessuno</span>}
      </div>
      {canEdit && (
        <div style={{ marginTop: 6, position: "relative" }}>
          <input type="search" placeholder={`aggiungi: cerca per titolo, codice o marca…`} value={cerca?.dove === dove ? cerca.testo : ""}
            onChange={(e) => setCerca({ dove, testo: e.target.value })} style={{ marginTop: 0, width: "100%", maxWidth: 420 }} />
          {cerca?.dove === dove && trovati.length > 0 && (
            <div className="sx-trovati">
              {trovati.map((p) => (
                <button key={p.id} type="button" disabled={pending || voci.some((x) => x.id === p.id)} onClick={() => { salvaLista(dove, [...voci.map((x) => x.id), p.id]); setCerca(null); }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.foto} alt="" /><span>{p.titolo}</span><span className="hint">{p.codice} · {p.marca}</span>
                </button>
              ))}
            </div>
          )}
          {dove === "correlati" && proposti.length > 0 && (
            <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span className="hint">proposte (stessa tipologia):</span>
              {proposti.filter((p) => !voci.some((x) => x.id === p.id)).map((p) => (
                <button key={p.id} type="button" className="mini-btn" disabled={pending} onClick={() => salvaLista(dove, [...voci.map((x) => x.id), p.id])}>+ {p.titolo}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, flex: 1 }}>Scheda online: foto, apertura, accessori e simili</h3>
        <a className="btn btn-outline btn-sm" href={urlScheda} target="_blank" rel="noreferrer">Apri la scheda come la vede il cliente</a>
      </div>
      {errore && <div className="alert alert-amber" style={{ marginTop: 8 }}>{errore}</div>}

      <div style={{ borderTop: "1px solid var(--line)", padding: "8px 0", marginTop: 8 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
          <strong style={{ fontSize: 13, flex: 1 }}>Foto in più <span className="hint" style={{ fontWeight: 500 }}>la galleria: dopo la foto di catalogo e le eventuali <code>codice_2.jpg</code>, <code>codice_3.jpg</code> della cartella</span></strong>
          {daDove(origine.foto)}
          {canEdit && <CaricaMedia scopeParam={scopeParam} cartella={`p-${productId}`} etichetta="＋ Foto" disabilitato={pending}
            onCaricati={async (m) => { await registraMediaScheda(productId, scopeParam, "foto", m); router.refresh(); }} />}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {foto.map((u) => (
            <span key={u} className="sx-foto">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="" />
              {canEdit && <button type="button" aria-label="Togli la foto" disabled={pending} onClick={() => esegui(() => rimuoviMediaScheda(productId, scopeParam, "foto", u))}>×</button>}
            </span>
          ))}
          {foto.length === 0 && <span className="hint">nessuna foto in più</span>}
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
          <strong style={{ fontSize: 13, flex: 1 }}>Apertura emozionale <span className="hint" style={{ fontWeight: 500 }}>foto o video a tutto schermo prima della scheda; senza niente qui, la scheda parte dalla galleria</span></strong>
          {daDove(origine.emozionali)}
          {canEdit && <CaricaMedia scopeParam={scopeParam} cartella={`e-${productId}`} accetta="image/*,video/mp4,video/webm,video/quicktime" etichetta="＋ Foto o video" disabilitato={pending}
            onCaricati={async (m) => { await registraMediaScheda(productId, scopeParam, "emozionali", m); router.refresh(); }} />}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {emozionali.map((m) => (
            <span key={m.url} className="sx-foto">
              {m.tipo === "video" ? <video src={m.url} muted playsInline preload="metadata" /> : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt="" />
              )}
              {m.tipo === "video" && <i>video</i>}
              {canEdit && <button type="button" aria-label="Togli" disabled={pending} onClick={() => esegui(() => rimuoviMediaScheda(productId, scopeParam, "emozionali", m.url))}>×</button>}
            </span>
          ))}
          {emozionali.length === 0 && <span className="hint">nessuna apertura: la scheda parte dalla galleria</span>}
        </div>
        <form style={{ display: "grid", gridTemplateColumns: "180px 1fr auto", gap: 6, alignItems: "end", marginTop: 8 }}
          onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); fd.set("campo", "testi"); esegui(() => salvaSchedaExtra(productId, scopeParam, fd)); }}>
          <label className="field" style={{ marginBottom: 0 }}>Occhiello<input name="occhiello" defaultValue={occhiello} placeholder="es. LA TUA ESTATE, FUORI" maxLength={60} disabled={!canEdit} /></label>
          <label className="field" style={{ marginBottom: 0 }}>Frase<input name="frase" defaultValue={frase} placeholder="es. Una tavolata da dodici, quando serve." maxLength={200} disabled={!canEdit} /></label>
          {canEdit && <button className="btn btn-sm" type="submit" disabled={pending}>Salva</button>}
          {daDove(origine.frase) && <span style={{ gridColumn: "1 / -1" }}>{daDove(origine.frase)}</span>}
        </form>
      </div>

      {lista("accessori", accessori, "Accessori", "«Completa il set» nella scheda")}
      {lista("correlati", correlati, "Prodotti simili", "«Simili a questo» nella scheda")}
    </div>
  );
}
