"use client";

import { useEffect, useState, useTransition } from "react";
import { creaCartelloNuovo } from "@/lib/zoo-actions";

/** Un layout che si può scegliere per un cartello (vedi layoutScegliibili). */
export interface LayoutScelta {
  id: string;
  formatId: string;
  nome: string;
  tipologie: string[];
  proprio: boolean;
}

/** Il tipo di cartello che si capisce dalla promozione scritta: serve solo per avvisare. */
export const TIPO_MECCANICA_NOME = "Promo a meccanica (3x2)";
export const TIPO_SCONTO_NOME = "Promo a sconto (20%)";
const pareSconto = (t: string) => /%/.test(t);

/** Le voci della tendina dei layout di un formato, con l'automatico in testa. */
export function OpzioniLayout({ layouts, formatId }: { layouts: LayoutScelta[]; formatId: string }) {
  return (
    <>
      <option value="">Automatico (dal tipo di offerta)</option>
      {layouts.filter((l) => l.formatId === formatId).map((l) => (
        <option key={l.id} value={l.id}>{l.nome}{l.proprio ? " — vostro" : ""}</option>
      ))}
    </>
  );
}

/**
 * Avviso quando la promozione chiede un layout che per quel formato non c'è:
 * un 3x2 in A4 senza layout 3x2 usciva come "A SOLI" e non si capiva perché.
 */
export function avvisoLayout(layouts: LayoutScelta[], formatId: string, formatoNome: string, meccanica: string, layoutId: string): string {
  if (layoutId || !meccanica.trim()) return "";
  // uno sconto con il prezzo esce col layout a meccanica: basta uno dei due
  const tipi = pareSconto(meccanica) ? [TIPO_SCONTO_NOME, TIPO_MECCANICA_NOME] : [TIPO_MECCANICA_NOME];
  const tipo = tipi[0];
  const adatto = (l: LayoutScelta) => l.tipologie.some((t) => tipi.includes(t));
  if (layouts.some((l) => l.formatId === formatId && adatto(l))) return "";
  const altri = layouts.filter(adatto);
  return `Per ${formatoNome} non c'è un layout «${tipo}»: il cartello userebbe quello a prezzo. `
    + (altri.length > 0 ? "Scegli un altro formato, un layout qui sotto, oppure crealo in Layout (Copia su…)." : "Scegli un layout qui sotto oppure crealo in Layout.");
}

/**
 * Un cartello fatto da zero, per quello che il volantino non ha: si salva
 * fra le offerte in corso dell'insegna/PV (o di tutti, se lo si condivide) e
 * finisce subito fra i selezionati, pronto da stampare.
 */
export default function NuovoCartello({
  scopeParam, scopeLabel, consorzio, condizioniStandard, layouts, formats, formatoIniziale, onCreato, onClose,
}: {
  scopeParam: string;
  scopeLabel: string;
  consorzio: boolean;
  condizioniStandard: string[];
  layouts: LayoutScelta[];
  formats: { id: string; name: string }[];
  formatoIniziale: string;
  onCreato: (id: string, formato: string) => void;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [errore, setErrore] = useState("");
  const [formato, setFormato] = useState(formatoIniziale);
  const [layoutId, setLayoutId] = useState("");
  const [meccanica, setMeccanica] = useState("");
  // 3x2, 1+1: si chiede solo il prezzo del pezzo (gli sconti in % restano a prezzi)
  const aMeccanica = meccanica.trim() !== "" && !pareSconto(meccanica);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const invia = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const dati = new FormData(e.currentTarget);
    setErrore("");
    startTransition(async () => {
      const r = await creaCartelloNuovo(scopeParam, dati).catch(() => ({ ok: false, errore: "Non sono riuscito a salvarlo: riprova." }));
      if (!r.ok || !("id" in r) || !r.id) { setErrore(r.errore ?? "Non sono riuscito a salvarlo."); return; }
      onCreato(r.id, formato);
    });
  };

  const nomeFormato = formats.find((f) => f.id === formato)?.name ?? formato;
  const avviso = avvisoLayout(layouts, formato, nomeFormato, meccanica, layoutId);

  return (
    <>
      <div className="pannello-velo" onClick={onClose} />
      <aside className="pannello-lato" role="dialog" aria-label="Nuovo cartello">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <h2 style={{ margin: 0, flex: 1, fontSize: 17 }}>Nuovo cartello</h2>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose} title="Chiudi (Esc)">✕</button>
        </div>
        <p className="hint" style={{ margin: "0 0 10px" }}>
          {consorzio
            ? "Un cartello fuori dal volantino, fatto dal Consorzio: lo vedono e lo stampano tutti."
            : `Un cartello fuori dal volantino: si salva fra le offerte in corso di ${scopeLabel}. Se serve anche agli altri, condividilo con tutto il Consorzio.`}
        </p>
        <form onSubmit={invia} className="form-nuovo-cartello">
          <label className="field">Titolo *<input type="text" name="titolo" required placeholder="es. Crocchette Adult Pollo" autoFocus /></label>
          <label className="field">Descrizione sul cartello<textarea name="descCartello" rows={2} placeholder="due righe sul prodotto" /></label>
          <div className="pannello-riga">
            <label className="field">Marca<input type="text" name="marca" placeholder="es. Monge" /></label>
            <label className="field">
              Contenuto
              <input type="text" name="contenuto" placeholder="12 kg, 400 g, 1,5 l" title="Serve a calcolare il prezzo al kg o al litro" />
            </label>
          </div>
          <label className="field">Codice a barre<input type="text" name="ean" inputMode="numeric" placeholder="se è in catalogo prende foto, animale e contenuto" /></label>
          <label className="field">
            Promozione
            <input type="text" name="meccanica" value={meccanica} onChange={(e) => setMeccanica(e.target.value)}
              placeholder="3x2, 1+1, sconto 20%… (vuoto = offerta a prezzo)" />
          </label>
          {aMeccanica ? (
            <label className="field">
              Prezzo del pezzo
              <input type="text" name="prezzoListino" inputMode="decimal" placeholder="1,15" />
              <span className="hint">Il prezzo di un pezzo: col {meccanica.trim()} il cliente ne paga meno.</span>
            </label>
          ) : (
            <div className="pannello-riga">
              <label className="field">Prezzo promo<input type="text" name="prezzoPromo" inputMode="decimal" placeholder="4,99" /></label>
              <label className="field">Prezzo di partenza<input type="text" name="prezzoListino" inputMode="decimal" placeholder="vuoto = A SOLI" /></label>
            </div>
          )}
          <label className="field">
            Condizioni
            <input type="text" name="condizioni" list="condizioni-pronte" placeholder="fino a esaurimento scorte" />
            <datalist id="condizioni-pronte">
              {condizioniStandard.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>

          <div className="riquadro-stampa">
            <div className="pannello-riga">
              <label className="field">
                Formato di stampa
                <select value={formato} onChange={(e) => { setFormato(e.target.value); setLayoutId(""); }}>
                  {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>
              <label className="field">
                Layout
                <select name="layoutId" value={layoutId} onChange={(e) => setLayoutId(e.target.value)}>
                  <OpzioniLayout layouts={layouts} formatId={formato} />
                </select>
              </label>
            </div>
            <p className="hint" style={{ margin: 0, fontSize: 11.5 }}>
              Automatico: 3x2 e sconti prendono il loro layout, gli altri quello a prezzo barrato o «A SOLI».
            </p>
            {avviso && <div className="alert alert-amber" style={{ margin: "8px 0 0" }}>{avviso}</div>}
          </div>

          <label className="field">Foto<input type="file" name="foto" accept="image/*" /></label>
          {!consorzio && (
            <label className="interruttore-grande" style={{ marginTop: 6 }}>
              <input type="checkbox" name="condivisa" value="1" />
              Condividi con tutto il Consorzio
            </label>
          )}
          {errore && <div className="alert alert-amber" style={{ marginTop: 10 }}>{errore}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button className="btn" type="submit" disabled={pending}>{pending ? "Salvo…" : "Crea e seleziona"}</button>
            <button className="btn btn-outline" type="button" onClick={onClose}>Annulla</button>
          </div>
        </form>
      </aside>
    </>
  );
}
