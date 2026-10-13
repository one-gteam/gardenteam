"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { spostaInFocus, unisciFocus, salvaFocusDef, eliminaFocus } from "@/lib/zoo-focus-actions";

export interface VoceBacheca {
  id: string; offerIds: string[]; nome: string; animale?: string; foto: string; prezzo?: string;
  articoli?: { ean: string; descrizione: string; prezzo: string; codice: string }[];
}
export interface FocusBachecaDef { nome: string; descrizione?: string; colore?: string; notaGrafico?: string; voci: VoceBacheca[] }

/**
 * Il modulo di un focus: testo, nota per il grafico e colore si salvano da
 * soli un attimo dopo; il nome quando si esce dal campo (rinominare a ogni
 * lettera sposterebbe le offerte a metà parola).
 */
function ModuloFocus({ campaignId, def, onSalvato, onElimina, colori }: {
  campaignId: string; def: FocusBachecaDef; onSalvato: () => void; onElimina: () => void; colori: string[];
}) {
  const rif = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [stato, setStato] = useState("");
  // il nome com'è adesso sul server: dopo una rinomina i salvataggi successivi usano quello nuovo
  const nomeAttuale = useRef(def.nome);
  const invia = async (rinomina: boolean) => {
    if (!rif.current) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const fd = new FormData(rif.current);
    const nuovoNome = String(fd.get("nome") ?? "").trim();
    if (!rinomina) fd.set("nome", nomeAttuale.current);
    setStato("Salvo…");
    const r = await salvaFocusDef(campaignId, nomeAttuale.current, fd).catch(() => ({ ok: false, error: "errore di rete" }));
    if (r.ok && rinomina && nuovoNome) nomeAttuale.current = nuovoNome;
    setStato(r.ok ? "✓ Salvato" : r.error ?? "Non salvato");
    if (r.ok) onSalvato();
  };
  const presto = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => invia(false), 900); };
  return (
    <form ref={rif} onSubmit={(e) => e.preventDefault()}
      onChange={(e) => { if ((e.target as unknown as HTMLInputElement).name !== "nome") presto(); }}>
      <label className="field" style={{ marginBottom: 4 }}>Nome
        <input name="nome" defaultValue={def.nome} required
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== nomeAttuale.current) invia(true); }} />
      </label>
      <label className="field" style={{ marginBottom: 4 }}>Testo del focus
        <textarea name="descrizione" rows={3} defaultValue={def.descrizione ?? ""} onBlur={() => timer.current && invia(false)} />
      </label>
      <label className="field" style={{ marginBottom: 4 }}>Note per il grafico <span className="hint" style={{ fontWeight: 400 }}>(non si stampano)</span>
        <textarea name="notaGrafico" rows={2} defaultValue={def.notaGrafico ?? ""} placeholder="es. tenere vicine queste offerte, usare la foto ambientata del cane"
          onBlur={() => timer.current && invia(false)} />
      </label>
      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        {colori.map((c) => (
          <label key={c} style={{ display: "inline-flex" }}>
            <input type="radio" name="colore" value={c} defaultChecked={(def.colore ?? colori[0]) === c} hidden />
            <span className="fb-colore" style={{ background: c }} title="colore del focus (anche per lo sfondo delle celle)" />
          </label>
        ))}
        <input type="color" name="coloreLibero" defaultValue={def.colore ?? "#e8f3ea"} title="altro colore" style={{ width: 28, height: 22, padding: 0, marginTop: 0 }}
          onInput={() => rif.current?.querySelectorAll<HTMLInputElement>('input[name="colore"]').forEach((r) => { r.checked = false; })} />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
        <span className="hint" style={{ flex: 1, fontSize: 11 }}>{stato || "si salva da solo"}</span>
        <button className="btn btn-outline btn-sm" type="button" style={{ color: "var(--red)" }} onClick={onElimina}>Elimina</button>
      </div>
    </form>
  );
}

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
        {(v.articoli?.length ?? 0) > 0 && (
          <details className="fb-articoli" onClick={(e) => e.stopPropagation()}>
            <summary>dettagli · {v.articoli!.length} {v.articoli!.length === 1 ? "articolo" : "articoli"}</summary>
            <ul>
              {v.articoli!.map((a) => (
                <li key={`${a.ean}_${a.codice}`}>{a.descrizione}<span className="hint"> · {a.ean}{a.codice ? ` · ${a.codice}` : ""}{a.prezzo ? ` · ${/^[\d.,]+$/.test(a.prezzo) ? `€ ${a.prezzo}` : a.prezzo}` : ""}</span></li>
              ))}
            </ul>
          </details>
        )}
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
              <summary>{def.descrizione || def.notaGrafico ? "modifica" : "aggiungi testo, note e colore"}</summary>
              <ModuloFocus campaignId={campaignId} def={def} colori={COLORI} onSalvato={() => router.refresh()}
                onElimina={() => confirm(`Eliminare il focus «${def.nome}»? Le offerte restano nel volantino, senza focus.`) && esegui(() => eliminaFocus(campaignId, def.nome), "Focus eliminato.")} />
            </details>
            {def.descrizione && <p className="fb-descr">{def.descrizione}</p>}
            {def.notaGrafico && <p className="fb-nota">Per il grafico: {def.notaGrafico}</p>}
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
