"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assegnaFocusInline, selezionaOfferteInline, votaOfferteInline } from "@/lib/zoo-actions";

/*
 * Scelta offerte Volantino: "Proponi", "Non tratto" e "Aggiungi al volantino"
 * senza ricaricare la pagina. Prima ogni clic rimandava in cima all'elenco e
 * si perdeva il punto in cui si era arrivati.
 *
 * Il voto dato in blocco dalle spunte arriva alle righe con l'evento
 * "voto-offerte", così i pulsanti si accendono anche senza ricaricare.
 */
const EVENTO = "voto-offerte";
type Tipo = "preferita" | "nontrattato";

export function VotoOfferta({
  ids, scopeParam, proposta, nonTrattata,
}: {
  ids: string[];
  scopeParam: string;
  proposta: boolean;
  nonTrattata: boolean;
}) {
  const [pref, setPref] = useState(proposta);
  const [non, setNon] = useState(nonTrattata);
  const [errore, setErrore] = useState(false);
  /*
   * Lo stato sullo schermo è quello giusto: cambia al clic, e i salvataggi
   * partono in fila (Next manda le azioni una alla volta). I pulsanti non si
   * disabilitano: dopo ogni voto il server ridisegna la pagina, e aspettare lui
   * per il clic successivo faceva perdere i clic.
   */

  useEffect(() => {
    const ascolta = (e: Event) => {
      const d = (e as CustomEvent<{ ids: string[]; tipo: Tipo }>).detail;
      if (!d.ids.some((id) => ids.includes(id))) return;
      if (d.tipo === "preferita") { setPref(true); setNon(false); } else { setNon(true); setPref(false); }
    };
    window.addEventListener(EVENTO, ascolta);
    return () => window.removeEventListener(EVENTO, ascolta);
  }, [ids]);

  const vota = (tipo: Tipo) => {
    const attivo = tipo === "preferita" ? !pref : !non;
    // si aggiorna subito lo schermo, poi si salva; se non riesce si torna indietro
    const prima = { pref, non };
    if (tipo === "preferita") { setPref(attivo); if (attivo) setNon(false); }
    else { setNon(attivo); if (attivo) setPref(false); }
    setErrore(false);
    votaOfferteInline(ids, tipo, attivo, scopeParam)
      .catch(() => ({ ok: false }))
      .then((r) => { if (!r.ok) { setPref(prima.pref); setNon(prima.non); setErrore(true); } });
  };

  const multi = ids.length > 1;
  return (
    <>
      <button type="button" className={`btn btn-sm ${pref ? "" : "btn-outline"}`}
        onClick={() => vota("preferita")}
        title={multi ? "Proponi tutte le varianti (clic di nuovo per togliere il tuo voto)" : "La proporrei nel volantino (clic di nuovo per togliere)"}>
        {pref ? "✓ Proposta" : "Proponi"}
      </button>{" "}
      <button type="button" className={`btn btn-sm ${non ? "btn-rosso" : "btn-outline"}`}
        onClick={() => vota("nontrattato")}
        title={multi ? "Non tratto nessuna variante (clic di nuovo per togliere)" : "Non ho in vendita questo prodotto (clic di nuovo per togliere)"}>
        {non ? "✕ Non trattata" : "Non tratto"}
      </button>
      {errore && <span className="hint" style={{ color: "var(--red)", marginLeft: 4 }}>non salvato</span>}
    </>
  );
}

/** I pulsanti sopra la tabella: votano le righe spuntate, senza ricaricare. */
export function VotoSpuntate({ scopeParam, formId, focus }: {
  scopeParam: string; formId: string;
  /** Solo per il Consorzio: i focus già usati nel volantino; attiva «Dai questo focus alle spuntate». */
  focus?: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [esito, setEsito] = useState("");
  const [testoFocus, setTestoFocus] = useState("");
  const router = useRouter();

  const daiFocus = () => {
    const spunte = [...document.querySelectorAll<HTMLInputElement>(`input[name="zsel"][form="${formId}"]:checked`)];
    const ids = spunte.map((c) => c.value);
    if (ids.length === 0) { setEsito("Spunta prima almeno una riga."); return; }
    startTransition(async () => {
      const r = await assegnaFocusInline(ids, testoFocus).catch(() => ({ ok: false, n: 0 }));
      if (!r.ok) { setEsito("Non sono riuscito a salvare il focus."); return; }
      for (const c of spunte) c.checked = false;
      setEsito(testoFocus.trim() ? `✓ Focus «${testoFocus.trim()}» su ${r.n} offerte.` : `✓ Focus tolto a ${r.n} offerte.`);
      router.refresh();
    });
  };

  const vota = (tipo: Tipo) => {
    const spunte = [...document.querySelectorAll<HTMLInputElement>(`input[name="zsel"][form="${formId}"]:checked`)];
    const ids = spunte.map((c) => c.value);
    if (ids.length === 0) { setEsito("Spunta prima almeno una riga."); return; }
    startTransition(async () => {
      const r = await votaOfferteInline(ids, tipo, true, scopeParam).catch(() => ({ ok: false, n: 0 }));
      if (!r.ok) { setEsito("Non sono riuscito a salvare il voto."); return; }
      window.dispatchEvent(new CustomEvent(EVENTO, { detail: { ids, tipo } }));
      for (const c of spunte) c.checked = false;
      setEsito(`✓ ${tipo === "preferita" ? "Proposte" : "Segnate non trattate"} ${r.n} offerte.`);
    });
  };

  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
      <button type="button" className="btn btn-sm" disabled={pending} onClick={() => vota("preferita")}>
        Proponi le offerte spuntate
      </button>
      <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => vota("nontrattato")}>
        Segna spuntate come non trattate
      </button>
      {focus && (
        <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
          <input list="focus-volantino" value={testoFocus} onChange={(e) => setTestoFocus(e.target.value)}
            placeholder="focus… (anche uno già usato)" style={{ marginTop: 0, fontSize: 12.5, padding: "4px 7px", width: 220 }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); daiFocus(); } }} />
          <datalist id="focus-volantino">{focus.map((x) => <option key={x} value={x} />)}</datalist>
          <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={daiFocus}
            title="Lo stesso focus a tutte le righe spuntate; vuoto = toglie il focus">
            Dai questo focus alle spuntate
          </button>
        </span>
      )}
      {esito && <span className="hint">{esito}</span>}
    </div>
  );
}

/** "Aggiungi / ✓ Nel volantino" del Consorzio, per una riga (anche di più varianti). */
export function SceltaVolantino({ ids, dentro, parziale }: { ids: string[]; dentro: boolean; parziale?: string }) {
  const [sel, setSel] = useState(dentro);
  const cambia = () => {
    const nuovo = !sel;
    setSel(nuovo);
    selezionaOfferteInline(ids, nuovo).catch(() => ({ ok: false })).then((r) => { if (!r.ok) setSel(!nuovo); });
  };
  return (
    <button type="button" className={`btn btn-sm ${sel ? "" : "btn-outline"}`} onClick={cambia}>
      {sel ? "✓ Nel volantino" : parziale ?? (ids.length > 1 ? "Aggiungi tutte" : "Aggiungi")}
    </button>
  );
}
