"use client";

import { useEffect, useState, useTransition } from "react";
import { creaCartelloNuovo } from "@/lib/zoo-actions";

/**
 * Un cartello fatto da zero, per quello che il volantino non ha: si salva
 * fra le offerte in corso dell'insegna/PV (o di tutti, se lo si condivide) e
 * finisce subito fra i selezionati, pronto da stampare.
 */
export default function NuovoCartello({
  scopeParam, scopeLabel, consorzio, condizioniStandard, onCreato, onClose,
}: {
  scopeParam: string;
  scopeLabel: string;
  consorzio: boolean;
  condizioniStandard: string[];
  onCreato: (id: string) => void;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [errore, setErrore] = useState("");

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
      onCreato(r.id);
    });
  };

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
            <label className="field">Codice a barre<input type="text" name="ean" inputMode="numeric" placeholder="se c'è in catalogo, prende foto e dati" /></label>
          </div>
          <div className="pannello-riga">
            <label className="field">Prezzo promo<input type="text" name="prezzoPromo" inputMode="decimal" placeholder="4,99" /></label>
            <label className="field">Prezzo di partenza<input type="text" name="prezzoListino" inputMode="decimal" placeholder="vuoto = A SOLI" /></label>
          </div>
          <label className="field">Promozione<input type="text" name="meccanica" placeholder="3x2, 1+1, sconto 20%… (al posto del prezzo o insieme)" /></label>
          <label className="field">
            Condizioni
            <input type="text" name="condizioni" list="condizioni-pronte" placeholder="fino a esaurimento scorte" />
            <datalist id="condizioni-pronte">
              {condizioniStandard.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
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
