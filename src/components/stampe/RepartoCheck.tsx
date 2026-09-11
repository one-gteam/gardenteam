"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
  caratteristica: string;
  inCoda?: "dopo" | "arrivo";
  stampato: boolean;
  escluso: boolean;
  giacenza?: string; // dal gestionale del punto vendita, quando collegato
  codiceGestionale?: string;
}

interface Dettagli {
  scopeType: string;
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
  voci, scopeParam, scopeType, fields, formati,
}: {
  voci: VoceReparto[];
  scopeParam: string;
  scopeType: string;
  fields: PrintField[];
  formati: { id: string; name: string }[];
}) {
  const [i, setI] = useState(0);
  const [stato, setStato] = useState<Record<string, VoceReparto>>(() => Object.fromEntries(voci.map((v) => [v.id, v])));
  const [dettagli, setDettagli] = useState<Dettagli | null>(null);
  // l'ultimo cartello disegnato: resta al suo posto mentre arriva il prossimo, così la pagina non salta
  const [ultimo, setUltimo] = useState<Dettagli["cartelli"][number] | null>(null);
  const [formato, setFormato] = useState(formati[0]?.id ?? "za4");
  const [esito, setEsito] = useState("");
  const [segnalazione, setSegnalazione] = useState("");
  const [pending, startTransition] = useTransition();
  const [touchX, setTouchX] = useState<number | null>(null);
  // prezzi, testi e segnalazione stanno dietro l'ingranaggio: davanti allo scaffale servono soprattutto i pulsanti
  const [impostazioniAperte, setImpostazioniAperte] = useState(false);
  /* I cartelli già scaricati restano qui: passare al successivo è immediato
     perché mentre si guarda questo si scaricano in silenzio i prossimi. */
  const memoria = useRef(new Map<string, Dettagli>());
  /* Lo spazio libero fra la testata appesa in alto e la barra appesa in basso:
     il cartello si rimpicciolisce per starci dentro, così non si scorre nulla. */
  const [spazio, setSpazio] = useState(0);
  const [altezzaBarra, setAltezzaBarra] = useState(0);
  useEffect(() => {
    const misura = () => {
      const alto = document.querySelector(".reparto-appeso")?.getBoundingClientRect().height ?? 60;
      const basso = document.querySelector(".reparto-barra")?.getBoundingClientRect().height ?? 160;
      setSpazio(Math.max(220, window.innerHeight - alto - basso - 28));
      setAltezzaBarra(window.innerWidth <= 760 ? basso + 20 : 0);
    };
    misura();
    window.addEventListener("resize", misura);
    return () => window.removeEventListener("resize", misura);
  }, []);

  const voce = voci[i];
  const consorzio = scopeType === "system";
  /* Appena il primo cartello e' pronto la pagina si porta da sola in posizione
     di lavoro: testata in cima, cartello in mezzo, pulsanti in fondo. Da li' in
     avanti non si muove piu' nulla. Si sale col dito per menu e filtri. */
  const posizionato = useRef(false);
  const chiave = (id: string) => `${id}|${formato}`;

  const scarica = async (id: string): Promise<Dettagli | null> => {
    const k = chiave(id);
    const gia = memoria.current.get(k);
    if (gia) return gia;
    try {
      const r = await fetch(`/stampe/zoo/stampa/dettagli?scope=${encodeURIComponent(scopeParam)}&sel=${encodeURIComponent(id)}&formato=${formato}`);
      if (!r.ok) return null;
      const d = (await r.json()) as Dettagli;
      if (memoria.current.size > 80) memoria.current.clear();
      memoria.current.set(k, d);
      return d;
    } catch { return null; /* si vede il messaggio di attesa */ }
  };
  /** Ricarica davvero dal server: dopo una correzione il cartello in memoria è vecchio. */
  const carica = async (id: string) => {
    memoria.current.delete(chiave(id));
    const d = await scarica(id);
    if (d) { setDettagli(d); setUltimo(d.cartelli[0] ?? null); }
  };

  useEffect(() => {
    if (!voce) return;
    setEsito(""); setSegnalazione("");
    let vivo = true;
    const pronto = memoria.current.get(chiave(voce.id));
    if (pronto) { setDettagli(pronto); setUltimo(pronto.cartelli[0] ?? null); }
    else {
      setDettagli(null);
      void scarica(voce.id).then((d) => { if (vivo && d) { setDettagli(d); setUltimo(d.cartelli[0] ?? null); } });
    }
    // i prossimi (e il precedente, per chi torna indietro) si preparano da soli
    const avanti = setTimeout(() => {
      for (const v of [voci[i + 1], voci[i + 2], voci[i + 3], voci[i - 1]]) if (v) void scarica(v.id);
    }, pronto ? 0 : 400);
    return () => { vivo = false; clearTimeout(avanti); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, formato]);

  useEffect(() => {
    if (posizionato.current || !dettagli) return;
    posizionato.current = true;
    if (window.innerWidth > 760) return;
    // il mezzo secondo serve al cartello per prendere la sua altezza vera:
    // prima la pagina e' piu' corta e lo scorrimento si ferma a meta'
    const t = setTimeout(() => {
      const testa = document.querySelector(".reparto-appeso");
      if (testa && window.scrollY < 60) window.scrollTo(0, window.scrollY + testa.getBoundingClientRect().top);
    }, 500);
    return () => clearTimeout(t);
  }, [dettagli]);

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
  // mentre arriva il nuovo cartello resta in vista il precedente, sbiadito e nello stesso punto
  const cartello = dettagli?.cartelli[0] ?? ultimo;
  const attesa = !dettagli;
  const scala = cartello ? Math.min(2, 330 / cartello.format.w, spazio > 0 ? spazio / cartello.format.h : 99) : 1;
  const altezzaCartello = cartello ? Math.round(cartello.format.h * scala) : 320;

  const inCoda = (tipo: "dopo" | "arrivo") => startTransition(async () => {
    const r = await mettiInCoda(scopeParam, tipo, JSON.stringify([{ offerId: voce.id, impostazioni: { [`formato_${voce.id}`]: formato } }]));
    if (r.ok) {
      setStato((p) => ({ ...p, [voce.id]: { ...p[voce.id], inCoda: tipo } }));
      setEsito(tipo === "dopo" ? "✓ Confermato: lo stampi dopo, in blocco, da Stampa cartelli." : "✓ Segnato come merce in arrivo.");
      setTimeout(() => vai(1), 900);
    } else setEsito("Non sono riuscito a salvarlo.");
  });
  const escludi = () => startTransition(async () => {
    const r = await toggleZooNoPrintInline(voce.id, scopeParam);
    if (r.ok) { setStato((p) => ({ ...p, [voce.id]: { ...p[voce.id], escluso: r.escluso } })); setEsito(r.escluso ? "Cartello escluso dalla stampa." : "Cartello rimesso fra quelli da stampare."); }
  });

  return (
    <div
      className="reparto"
      style={altezzaBarra ? { paddingBottom: altezzaBarra } : undefined}
      onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX === null) return;
        const dx = e.changedTouches[0].clientX - touchX;
        if (Math.abs(dx) > 70) vai(dx < 0 ? 1 : -1);
        setTouchX(null);
      }}
    >
      {/* resta appesa in cima allo schermo: davanti allo scaffale si deve sempre
          sapere di che prodotto si sta parlando, e con che giacenza */}
      <div className="reparto-appeso">
        <div className="reparto-testa">
          <span className="vol-numero">{i + 1} / {voci.length}</span>
          <strong style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{voce.nome}</strong>
          {s.inCoda === "dopo" && <span className="pill pill-green">in coda</span>}
          {s.inCoda === "arrivo" && <span className="pill pill-amber">in arrivo</span>}
          {s.stampato && <span className="pill pill-gray">stampato</span>}
          {s.escluso && <span className="pill pill-red">escluso</span>}
        </div>
        <div className="reparto-info">
          {voce.marca}{voce.animale ? ` · ${voce.animale}` : ""}{voce.caratteristica ? ` · ${voce.caratteristica}` : ""}
          {" · "}{voce.nCodici > 1 ? `${voce.nCodici} codici` : voce.ean}
          {voce.giacenza !== undefined && <> · <strong>giacenza {voce.giacenza}</strong></>}
          {voce.codiceGestionale && <> · cod. {voce.codiceGestionale}</>}
        </div>
      </div>

      <div className={`reparto-cartello${attesa ? " attesa" : ""}`} style={{ minHeight: altezzaCartello }}>
        {cartello
          ? <Cartello format={cartello.format} layout={cartello.layout} fields={fields} values={cartello.values} scale={scala} />
          : <div className="card" style={{ padding: 20, textAlign: "center", color: "var(--muted)" }}>Preparo il cartello…</div>}
      </div>

      <div className="reparto-barra">
      <div className="reparto-formato">
        <label className="hint" style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
          Formato
          <select value={formato} onChange={(e) => setFormato(e.target.value)}>
            {formati.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <button type="button" className={`btn btn-sm ${impostazioniAperte ? "" : "btn-outline"}`} onClick={() => setImpostazioniAperte((v) => !v)}
          title="Prezzi, testi e segnalazione al gestore">
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

      {/* tutte e tre sulla stessa riga, con la stampa larga il doppio; quella
          scelta resta colorata, così tornando indietro si vede cosa si è deciso */}
      <div className="reparto-azioni">
        <button type="button" className={`btn btn-outline azione-secondaria${s.inCoda === "arrivo" ? " scelto-ambra" : ""}`}
          disabled={pending} onClick={() => inCoda("arrivo")}>
          <span>Merce</span><span>in arrivo</span>
        </button>
        {!consorzio && (
          <button type="button" className={`btn btn-outline azione-secondaria${s.escluso ? " scelto-rosso" : ""}`}
            disabled={pending} onClick={escludi}>
            {s.escluso ? <><span>Escluso</span><span>rimetti</span></> : <><span>Non</span><span>stampare</span></>}
          </button>
        )}
        <button type="button" className={`btn azione-principale${s.inCoda === "dopo" ? " scelto-verde" : ""}`}
          disabled={pending} onClick={() => inCoda("dopo")}>
          {s.inCoda === "dopo"
            ? <><span>✓ In coda</span><span>di stampa</span></>
            : <><span>✓ Confermato,</span><span>stampa dopo</span></>}
        </button>
      </div>
      {esito && <div className="alert alert-green" style={{ margin: "6px 0" }}>{esito}</div>}

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
      </div>
    </div>
  );
}
