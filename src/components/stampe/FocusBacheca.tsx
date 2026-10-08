"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { spostaInFocus, unisciFocus, salvaFocusDef, eliminaFocus } from "@/lib/zoo-focus-actions";

export interface VoceBacheca { id: string; offerIds: string[]; nome: string; animale?: string; foto: string; prezzo?: string }
export interface FocusBachecaDef { nome: string; descrizione?: string; colore?: string; voci: VoceBacheca[] }

const COLORI = ["#e8f3ea", "#fde8ef", "#e6eefb", "#fff3d6", "#efe6fb", "#e0f4f4", "#fbe9df"];

/**
 * Focus del volantino in lavorazione, come una bacheca: una colonna per focus
 * con nome, descrizione (intera) e colore; le offerte si trascinano da un focus
 * all'altro o in «Senza focus». Trascinando l'intestazione di un focus su un
 * altro, i due si uniscono.
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

  const colonna = (titolo: string | null, voci: VoceBacheca[], def?: FocusBachecaDef) => {
    const chiave = titolo ?? "_senza";
    const visibili = filtro ? voci.filter((v) => v.nome.toLowerCase().includes(filtro.toLowerCase())) : voci;
    return (
      <div key={chiave} className={`fb-col${sopra === chiave ? " sopra" : ""}`} style={{ background: def?.colore ?? (titolo ? "#f7f8f6" : "#fff") }}
        onDragOver={(e) => { e.preventDefault(); setSopra(chiave); }} onDragLeave={() => setSopra(null)} onDrop={(e) => { e.preventDefault(); rilascia(titolo); }}>
        <div className="fb-testa" draggable={Boolean(titolo)}
          onDragStart={() => titolo && setTrasc({ tipo: "focus", nome: titolo })}
          title={titolo ? "Trascina questa intestazione su un altro focus per unirli" : undefined}>
          <strong>{titolo ?? "Senza focus"}</strong>
          <span className="hint">{voci.length} offerte</span>
        </div>
        {def && (
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
        )}
        {def?.descrizione && <p className="fb-descr">{def.descrizione}</p>}
        <div className="fb-voci">
          {visibili.map((v) => (
            <div key={v.id} className="fb-voce" draggable onDragStart={() => setTrasc({ tipo: "voce", voce: v })} title="Trascina in un altro focus">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={v.foto} alt="" />
              <span style={{ minWidth: 0 }}>
                <span className="fb-nome">{v.nome}</span>
                <span className="hint" style={{ fontSize: 10.5 }}>{[v.animale, v.prezzo && `€ ${v.prezzo}`].filter(Boolean).join(" · ")}</span>
              </span>
            </div>
          ))}
          {visibili.length === 0 && <span className="hint" style={{ fontSize: 11 }}>trascina qui le offerte</span>}
        </div>
      </div>
    );
  };

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
        <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="cerca un'offerta…" style={{ marginTop: 0, width: 200 }} />
        <span className="hint">Trascina le offerte da un focus all&apos;altro; trascina l&apos;intestazione di un focus su un altro per unirli.</span>
        {esito && <span className="hint" style={{ color: "var(--green-700)", fontWeight: 700 }}>{esito}</span>}
      </div>
      <div className="fb-bacheca">
        {focus.map((f) => colonna(f.nome, f.voci, f))}
        {colonna(null, senzaFocus)}
      </div>
    </div>
  );
}
