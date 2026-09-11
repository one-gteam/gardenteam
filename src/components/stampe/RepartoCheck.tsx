"use client";

import { useEffect, useState, useTransition } from "react";
import type { CardLayout, PrintField, PrintFormat } from "@/lib/stampe";
import Cartello from "./Cartello";
import InlineEdit from "./InlineEdit";
import {
  mettiInCoda, toggleZooNoPrintInline, setPvPriceInline, setPvListinoInline, updateOfferFieldInline, setOfferTextScoped,
  segnalaProblemaInline,
} from "@/lib/zoo-actions";

/** Una voce dell'elenco da controllare: un cartello (prodotto padre o offerta singola). */
export interface VoceReparto {
  id: string;         // id dell'offerta rappresentante
  nome: string;
  ean: string;
  nCodici: number;
  marca: string;
  animale: string;
  inCoda?: "dopo" | "arrivo";
  stampato: boolean;
  escluso: boolean;
  giacenza?: string; // dal gestionale del punto vendita, quando collegato
  codiceGestionale?: string;
}

interface Dettagli {
  scopeType: string;
  scopeLabel: string;
  cartelli: { id: string; format: PrintFormat; layout: CardLayout; values: Record<string, string> }[];
  righe: {
    id: string; ean: string; descrizione: string; parentId?: string;
    nome?: { value: string; custom: boolean };
    descOfferta: { value: string; custom: boolean };
    cond: { value: string; custom: boolean };
    prezzoPromo: string; prezzoListino?: string; meccanica?: string; pv?: string; pvListino?: string; escluso: boolean;
  }[];
}

/**
 * Controllo in reparto, dal cellulare: un cartello alla volta davanti allo
 * scaffale. Si vede il cartello come verrà stampato, si correggono prezzo,
 * prezzo di partenza, descrizione e condizioni, e con un tocco si manda in
 * coda per stamparlo dopo in blocco. Avanti e indietro con i pulsanti grandi,
 * con le frecce della tastiera o scorrendo con il dito.
 */
export default function RepartoCheck({
  voci, scopeParam, scopeType, scopeLabel, fields, formati,
}: {
  voci: VoceReparto[];
  scopeParam: string;
  scopeType: string;
  scopeLabel: string;
  fields: PrintField[];
  formati: { id: string; name: string }[];
}) {
  const [i, setI] = useState(0);
  const [stato, setStato] = useState<Record<string, VoceReparto>>(() => Object.fromEntries(voci.map((v) => [v.id, v])));
  const [dettagli, setDettagli] = useState<Dettagli | null>(null);
  const [formato, setFormato] = useState(formati[0]?.id ?? "za4");
  const [esito, setEsito] = useState("");
  const [segnalazione, setSegnalazione] = useState("");
  const [pending, startTransition] = useTransition();
  const [touchX, setTouchX] = useState<number | null>(null);
  // la parte bassa (prezzi, testi, formato, segnalazione) sta dietro l'ingranaggio: davanti allo scaffale servono soprattutto i tre pulsanti
  const [impostazioniAperte, setImpostazioniAperte] = useState(false);

  const voce = voci[i];
  const consorzio = scopeType === "system";

  const carica = async (id: string) => {
    setDettagli(null);
    try {
      const r = await fetch(`/stampe/zoo/stampa/dettagli?scope=${encodeURIComponent(scopeParam)}&sel=${encodeURIComponent(id)}&formato=${formato}`);
      if (r.ok) setDettagli((await r.json()) as Dettagli);
    } catch { /* si vede il messaggio di attesa */ }
  };
  useEffect(() => { if (voce) void carica(voce.id); setEsito(""); setSegnalazione(""); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [i, formato]);

  const vai = (delta: number) => setI((x) => Math.max(0, Math.min(voci.length - 1, x + delta)));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === "ArrowRight") vai(1);
      if (e.key === "ArrowLeft") vai(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voci.length]);

  if (!voce) return <div className="card"><p className="empty">Nessun cartello da controllare con questi filtri.</p></div>;
  const s = stato[voce.id];
  const riga = dettagli?.righe[0];
  const cartello = dettagli?.cartelli[0];

  const inCoda = (tipo: "dopo" | "arrivo") => startTransition(async () => {
    const r = await mettiInCoda(scopeParam, tipo, JSON.stringify([{ offerId: voce.id, impostazioni: { [`formato_${voce.id}`]: formato } }]));
    if (r.ok) {
      setStato((p) => ({ ...p, [voce.id]: { ...p[voce.id], inCoda: tipo } }));
      setEsito(tipo === "dopo" ? "✓ Confermato: lo stampi dopo, in blocco, da Stampa cartelli." : "✓ Segnato come merce in arrivo.");
      setTimeout(() => vai(1), 600);
    } else setEsito("Non sono riuscito a salvarlo.");
  });
  const escludi = () => startTransition(async () => {
    const r = await toggleZooNoPrintInline(voce.id, scopeParam);
    if (r.ok) { setStato((p) => ({ ...p, [voce.id]: { ...p[voce.id], escluso: r.escluso } })); setEsito(r.escluso ? "Cartello escluso dalla stampa." : "Cartello rimesso fra quelli da stampare."); }
  });

  return (
    <div
      className="reparto"
      onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX === null) return;
        const dx = e.changedTouches[0].clientX - touchX;
        if (Math.abs(dx) > 70) vai(dx < 0 ? 1 : -1);
        setTouchX(null);
      }}
    >
      <div className="reparto-testa">
        <span className="vol-numero">{i + 1} / {voci.length}</span>
        <strong style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{voce.nome}</strong>
        {s.inCoda === "dopo" && <span className="pill pill-green">in coda</span>}
        {s.inCoda === "arrivo" && <span className="pill pill-amber">in arrivo</span>}
        {s.stampato && <span className="pill pill-gray">stampato</span>}
        {s.escluso && <span className="pill pill-red">escluso</span>}
      </div>
      <div className="hint" style={{ marginBottom: 6 }}>
        {voce.marca}{voce.animale ? ` · ${voce.animale}` : ""} · {voce.nCodici > 1 ? `${voce.nCodici} codici` : voce.ean}
        {voce.giacenza !== undefined && <> · <strong>giacenza {voce.giacenza}</strong></>}
        {voce.codiceGestionale && <> · cod. {voce.codiceGestionale}</>}
      </div>

      <div className="reparto-cartello">
        {cartello
          ? <Cartello format={cartello.format} layout={cartello.layout} fields={fields} values={cartello.values} scale={Math.min(2, 330 / cartello.format.w)} />
          : <div className="card" style={{ padding: 20, textAlign: "center", color: "var(--muted)" }}>Preparo il cartello…</div>}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", margin: "2px 0 6px" }}>
        <button type="button" className={`btn btn-sm ${impostazioniAperte ? "" : "btn-outline"}`} onClick={() => setImpostazioniAperte((v) => !v)}
          title="Prezzi, testi, formato e segnalazione al gestore">
          ⚙ {impostazioniAperte ? "Chiudi" : "Correggi"}
        </button>
      </div>

      {impostazioniAperte && riga && (
        <div className="card reparto-campi">
          <div className="reparto-riga">
            <label>Prezzo promo
              {consorzio
                ? <InlineEdit value={riga.prezzoPromo} placeholder="es. 9,99" onSaved={() => carica(voce.id)} onSave={updateOfferFieldInline.bind(null, riga.id, "prezzoPromo")} />
                : <InlineEdit value={riga.pv ?? ""} placeholder={riga.prezzoPromo || "—"} onSaved={() => carica(voce.id)} onSave={setPvPriceInline.bind(null, riga.ean, scopeParam)} />}
              {!consorzio && <span className="hint">Consorzio: € {riga.prezzoPromo || "—"}</span>}
            </label>
            <label>Prezzo di partenza
              {consorzio
                ? <InlineEdit value={riga.prezzoListino ?? ""} placeholder="es. 12,99" onSaved={() => carica(voce.id)} onSave={updateOfferFieldInline.bind(null, riga.id, "prezzoListino")} />
                : <InlineEdit value={riga.pvListino ?? ""} placeholder={riga.prezzoListino || "A SOLI"} onSaved={() => carica(voce.id)} onSave={setPvListinoInline.bind(null, riga.ean, scopeParam)} />}
              {!consorzio && <span className="hint">Consorzio: {riga.prezzoListino ? `€ ${riga.prezzoListino}` : "A SOLI"}</span>}
            </label>
          </div>
          <label>Descrizione offerta
            <InlineEdit value={riga.descOfferta.value} multiline onSaved={() => carica(voce.id)} onSave={setOfferTextScoped.bind(null, riga.id, "descrizione", scopeParam)} />
          </label>
          <label>Condizioni
            <InlineEdit value={riga.cond.value} placeholder="es. fino a esaurimento" onSaved={() => carica(voce.id)} onSave={setOfferTextScoped.bind(null, riga.id, "condizioni", scopeParam)} />
          </label>
          {riga.meccanica && <div className="hint">Meccanica: {riga.meccanica}</div>}
          <span className="hint">I campi si salvano da soli uscendo dal campo e il cartello si aggiorna.</span>
        </div>
      )}

      <div className="reparto-azioni">
        {impostazioniAperte && (
          <label className="hint" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Formato
            <select value={formato} onChange={(e) => setFormato(e.target.value)} style={{ marginTop: 0 }}>
              {formati.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="btn" disabled={pending} onClick={() => inCoda("dopo")}>✓ Confermato, stampa dopo</button>
        <button type="button" className="btn btn-outline" disabled={pending} onClick={() => inCoda("arrivo")}>Merce in arrivo</button>
        {!consorzio && (
          <button type="button" className="btn btn-outline" disabled={pending} onClick={escludi}>
            {s.escluso ? "Rimetti in stampa" : "Non stampare"}
          </button>
        )}
      </div>
      {esito && <div className="alert alert-green">{esito}</div>}

      {!consorzio && impostazioniAperte && (
        <div className="card" style={{ padding: 10, marginTop: 8 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input type="text" value={segnalazione} onChange={(e) => setSegnalazione(e.target.value)} placeholder="Segnala un errore al gestore…"
              style={{ flex: 1, marginTop: 0, fontSize: 13 }} />
            <button type="button" className="btn btn-sm" disabled={pending || !segnalazione.trim()} onClick={() => startTransition(async () => {
              const r = await segnalaProblemaInline(scopeParam, riga?.parentId, voce.id, segnalazione);
              setEsito(r.ok ? "✓ Segnalazione inviata al gestore." : "Segnalazione non inviata.");
              if (r.ok) setSegnalazione("");
            })}>Invia</button>
          </div>
        </div>
      )}

      <div className="reparto-nav">
        <button type="button" className="btn btn-outline" disabled={i === 0} onClick={() => vai(-1)}>◀ Precedente</button>
        <button type="button" className="btn btn-outline" disabled={i >= voci.length - 1} onClick={() => vai(1)}>Successivo ▶</button>
      </div>
      <p className="hint" style={{ textAlign: "center" }}>Scorri con il dito o usa le frecce. Ambito: {scopeLabel}.</p>
    </div>
  );
}
