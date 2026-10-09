"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { spostaInFocus, unisciFocus, salvaFocusDef, eliminaFocus } from "@/lib/zoo-focus-actions";

export interface VoceBacheca { id: string; offerIds: string[]; nome: string; animale?: string; foto: string; prezzo?: string }
export interface FocusBachecaDef { nome: string; descrizione?: string; colore?: string; voci: VoceBacheca[] }

const COLORI = ["#e8f3ea", "#fde8ef", "#e6eefb", "#fff3d6", "#efe6fb", "#e0f4f4", "#fbe9df"];

/**
 * Focus del volantino in lavorazione, come una bacheca: una colonna per focus
 * con nome, descrizione (intera) e colore; le offerte si trascinano da un focus
 * all'altro (la × le toglie dal focus). Le offerte senza focus non hanno una
 * colonna: si trovano con «cerca» e da lì si trascinano dentro un focus.
 * Trascinando l'intestazione di un focus su un altro, i due si uniscono. Le
 * schede si comprimono, e la scelta resta sul browser.
 */
export default function FocusBacheca({
  campaignId, focus, senzaFocus,
}: {
  campaignId: string;
  focus: FocusBachecaDef[];
  senzaFocus: VoceBacheca[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [trasc, setTrasc] = useState<{ tipo: "voce"; voce: VoceBacheca } | { tipo: "focus"; nome: string } | null>(null);
  const [sopra, setSopra] = useState<string | null>(null);
  const [esito, setEsito] = useState("");
  const [nuovo, setNuovo] = useState("");
  const [filtro, setFiltro] = useState("");
  const [chiuse, setChiuse] = useState<Set<string>>(new Set());
  const CHIAVE = "gt-focus-chiuse";
  // la scelta si legge dopo il primo disegno (il server non ha il localStorage)
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem(CHIAVE) ?? "[]"); if (Array.isArray(v)) setChiuse(new Set(v.map(String))); } catch { /* niente */ }
  }, []);
  const salvaChiuse = (n: Set<string>) => {
    setChiuse(n);
    try { localStorage.setItem(CHIAVE, JSON.stringify([...n])); } catch { /* niente */ }
  };
  const alternaChiusa = (nome: string) => { const n = new Set(chiuse); if (n.has(nome)) n.delete(nome); else n.add(nome); salvaChiuse(n); };

  const esegui = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    startTransition(async () => {
      const r = await fn().catch(() => ({ ok: false, error: "errore di rete" }));
      setEsito(r.ok ? msg : r.error ?? "non riuscito");
      if (r.ok) router.refresh();
    });

  const rilascia = (destinazione: string | null) => {
    setSopra(null);
    if (!trasc) return;
    if (trasc.tipo === "voce") {
      esegui(() => spostaInFocus(campaignId, trasc.voce.offerIds, destinazione ?? ""), destinazione ? `«${trasc.voce.nome}» spostata in «${destinazione}».` : `«${trasc.voce.nome}» ora è senza focus.`);
    } else if (destinazione && destinazione !== trasc.nome) {
      if (confirm(`Unire il focus «${trasc.nome}» dentro «${destinazione}»? Le sue offerte passano tutte in «${destinazione}».`)) {
        esegui(() => unisciFocus(campaignId, trasc.nome, destinazione), `«${trasc.nome}» unito in «${destinazione}».`);
      }
    }
    setTrasc(null);
  };

  const q = filtro.trim().toLowerCase();
  const combacia = (v: VoceBacheca) => !q || v.nome.toLowerCase().includes(q) || (v.animale ?? "").toLowerCase().includes(q);
  const trovateSenza = q ? senzaFocus.filter(combacia) : [];

  const voce = (v: VoceBacheca, nelFocus: boolean) => (
    <div key={v.id} className="fb-voce" draggable onDragStart={() => setTrasc({ tipo: "voce", voce: v })}
      title={nelFocus ? "Trascina in un altro focus" : "Trascina dentro un focus"}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={v.foto} alt="" />
      <span style={{ minWidth: 0 }}>
        <span className="fb-nome">{v.nome}</span>
        <span className="hint" style={{ fontSize: 10.5 }}>{[v.animale, v.prezzo && `€ ${v.prezzo}`].filter(Boolean).join(" · ")}</span>
      </span>
      {nelFocus && (
        <button type="button" className="fb-togli" title="Togli dal focus (l'offerta resta nel volantino)" disabled={pending}
          onClick={() => esegui(() => spostaInFocus(campaignId, v.offerIds, ""), `«${v.nome}» ora è senza focus.`)}>×</button>
      )}
    </div>
  );

  const colonna = (def: FocusBachecaDef) => {
    const titolo = def.nome;
    const visibili = def.voci.filter(combacia);
    // cercando, si aprono le schede che hanno qualcosa da mostrare
    const compressa = chiuse.has(titolo) && !(q && visibili.length > 0);
    return (
      <div key={titolo} className={`fb-col${sopra === titolo ? " sopra" : ""}${compressa ? " compressa" : ""}`} style={{ background: def.colore ?? "#f7f8f6" }}
        onDragOver={(e) => { e.preventDefault(); setSopra(titolo); }} onDragLeave={() => setSopra(null)} onDrop={(e) => { e.preventDefault(); rilascia(titolo); }}>
        <div className="fb-testa" draggable onDragStart={() => setTrasc({ tipo: "focus", nome: titolo })}
          title="Trascina questa intestazione su un altro focus per unirli">
          <button type="button" className="fb-freccia" onClick={() => alternaChiusa(titolo)} title={compressa ? "Apri la scheda" : "Comprimi la scheda"}>{compressa ? "▸" : "▾"}</button>
          <strong style={{ flex: 1 }}>{titolo}</strong>
          <span className="hint">{def.voci.length} offerte</span>
        </div>
        {!compressa && (
          <>
            <details className="fb-dett">
              <summary>{def.descrizione ? "modifica" : "aggiungi descrizione e colore"}</summary>
              <form onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                esegui(() => salvaFocusDef(campaignId, def.nome, fd), "Focus salvato.");
              }}>
                <label className="field" style={{ marginBottom: 4 }}>Nome<input name="nome" defaultValue={def.nome} required /></label>
                <label className="field" style={{ marginBottom: 4 }}>Descrizione<textarea name="descrizione" rows={3} defaultValue={def.descrizione ?? ""} /></label>
                <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                  {COLORI.map((c) => (
                    <label key={c} style={{ display: "inline-flex" }}>
                      <input type="radio" name="colore" value={c} defaultChecked={(def.colore ?? COLORI[0]) === c} hidden />
                      <span className="fb-colore" style={{ background: c }} title="colore del focus (anche per lo sfondo delle celle)" />
                    </label>
                  ))}
                  <input type="color" name="coloreLibero" defaultValue={def.colore ?? "#e8f3ea"} title="altro colore" style={{ width: 28, height: 22, padding: 0, marginTop: 0 }} />
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <button className="btn btn-sm" type="submit" disabled={pending}>Salva</button>
                  <button className="btn btn-outline btn-sm" type="button" style={{ color: "var(--red)" }}
                    onClick={() => confirm(`Eliminare il focus «${def.nome}»? Le offerte restano nel volantino, senza focus.`) && esegui(() => eliminaFocus(campaignId, def.nome), "Focus eliminato.")}>Elimina</button>
                </div>
              </form>
            </details>
            {def.descrizione && <p className="fb-descr">{def.descrizione}</p>}
            <div className="fb-voci">
              {visibili.map((v) => voce(v, true))}
              {visibili.length === 0 && <span className="hint" style={{ fontSize: 11 }}>{q ? "nessuna offerta trovata qui" : "trascina qui le offerte"}</span>}
            </div>
          </>
        )}
      </div>
    );
  };

  const tutteChiuse = focus.length > 0 && focus.every((f) => chiuse.has(f.nome));

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <form onSubmit={(e) => {
          e.preventDefault();
          const n = nuovo.trim(); if (!n) return;
          const fd = new FormData(); fd.set("nome", n);
          esegui(() => salvaFocusDef(campaignId, null, fd), `Focus «${n}» creato: trascinaci le offerte.`);
          setNuovo("");
        }} style={{ display: "flex", gap: 6 }}>
          <input value={nuovo} onChange={(e) => setNuovo(e.target.value)} placeholder="nuovo focus (es. Denti sani)" style={{ marginTop: 0, width: 240 }} />
          <button className="btn btn-sm" type="submit" disabled={pending}>+ Crea focus</button>
        </form>
        <input type="search" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="cerca un'offerta…" style={{ marginTop: 0, width: 220 }} />
        {focus.length > 0 && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => salvaChiuse(tutteChiuse ? new Set() : new Set(focus.map((f) => f.nome)))}>
            {tutteChiuse ? "Apri tutte" : "Comprimi tutte"}
          </button>
        )}
        <span className="hint">Trascina le offerte da un focus all&apos;altro; trascina l&apos;intestazione di un focus su un altro per unirli. La ricerca trova anche le offerte senza focus.</span>
        {esito && <span className="hint" style={{ color: "var(--green-700)", fontWeight: 700 }}>{esito}</span>}
      </div>

      {q && (
        <div className="fb-trovate">
          <strong style={{ fontSize: 12.5 }}>Senza focus che corrispondono a «{filtro.trim()}»: {trovateSenza.length}</strong>
          {trovateSenza.length > 0 && <span className="hint" style={{ fontSize: 11.5 }}> · trascinale dentro un focus</span>}
          {trovateSenza.length > 0 && <div className="fb-trovate-voci">{trovateSenza.slice(0, 40).map((v) => voce(v, false))}</div>}
          {trovateSenza.length > 40 && <span className="hint" style={{ fontSize: 11 }}>… e altre {trovateSenza.length - 40}: restringi la ricerca</span>}
        </div>
      )}

      <div className="fb-bacheca">
        {focus.map((f) => colonna(f))}
        {focus.length === 0 && <p className="hint">Nessun focus: creane uno qui sopra, poi cerca le offerte e trascinale dentro.</p>}
      </div>
    </div>
  );
}
