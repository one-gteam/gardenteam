"use client";

import { useEffect, useState, useTransition } from "react";
import type { CardLayout, PrintField, PrintFormat } from "@/lib/stampe";
import Cartello from "./Cartello";
import InlineEdit from "./InlineEdit";
import InlineSelect from "./InlineSelect";
import {
  updateParentFieldInline, setParentTagScoped, setOfferTextScoped, setPvPriceInline, setPvListinoInline, updateOfferFieldInline,
  toggleZooNoPrint, aggiornaCartelloProprio, condividiCartelloProprio, eliminaCartelloProprio,
} from "@/lib/zoo-actions";
import type { CampoCartelloProprio } from "@/lib/zoo-actions";

interface Valore { value: string; custom: boolean }

/** I testi di un cartello: arrivano da /stampe/zoo/stampa/dettagli. */
export interface RigaPersonalizza {
  id: string;
  ean: string;
  descrizione: string;
  parentId?: string;
  nome?: Valore;
  desc?: Valore;
  animale?: Valore;
  caratt?: Valore;
  descOfferta: Valore;
  cond: Valore;
  prezzoPromo: string;
  prezzoListino?: string;
  meccanica?: string;
  pv?: string;
  pvListino?: string;
  listinoGestionale?: string;
  giacenza?: number;
  codiceGestionale?: string;
  escluso: boolean;
  /** Cartello proprio: mia = l'ha fatto questo ambito e lo può correggere. */
  propria?: { mia: boolean; condivisa: boolean; titolo: string; descCartello: string; marca: string; autore: string };
}

/**
 * Il pannello "Testi del cartello" di Stampa cartelli: si apre da una riga dei
 * selezionati, sul lato destro, per quel solo prodotto. Sopra c'è il cartello
 * com'è adesso, sotto i suoi testi: ogni salvataggio richiede i dati aggiornati
 * (onRefresh) e il cartello si ridisegna, senza ricaricare la pagina.
 */
export default function PersonalizzaPannello({
  riga, cartello, fields, scopeType, scopeLabel, scopeParam, categorieAnimali, caratteristicheProdotto, condizioniStandard,
  onRefresh, onClose, onDuplica, onEliminato,
}: {
  riga?: RigaPersonalizza;
  cartello?: { format: PrintFormat; layout: CardLayout; values: Record<string, string> };
  fields: PrintField[];
  scopeType: string;
  scopeLabel: string;
  scopeParam: string;
  categorieAnimali: string[];
  caratteristicheProdotto: string[];
  condizioniStandard: string[];
  onRefresh: () => void;
  onClose: () => void;
  /** Duplica il cartello in uno proprio e apre quello. */
  onDuplica?: (id: string) => void;
  /** Il cartello proprio è stato eliminato. */
  onEliminato?: (id: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const consorzio = scopeType === "system";

  // Esc chiude, come ci si aspetta da un pannello
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const Campo = ({ label, nota, children }: { label: string; nota?: string; children: React.ReactNode }) => (
    <div className="pannello-campo">
      <div className="pannello-etichetta">{label}{nota && <span className="hint" style={{ marginLeft: 6, fontWeight: 400 }}>{nota}</span>}</div>
      {children}
    </div>
  );
  const Personalizzato = ({ v, testo = "personalizzato" }: { v?: Valore; testo?: string }) =>
    v?.custom ? <span className="pill pill-orange" style={{ marginLeft: 6 }}>{testo}</span> : null;

  return (
    <>
      <div className="pannello-velo" onClick={onClose} />
      <aside className="pannello-lato" role="dialog" aria-label="Testi del cartello">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <h2 style={{ margin: 0, flex: 1, fontSize: 17 }}>
            {consorzio ? "Testi del cartello (versione Consorzio)" : `Testi del cartello per ${scopeLabel}`}
          </h2>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose} title="Chiudi (Esc)">✕</button>
        </div>
        {!riga ? (
          <p className="empty">Preparo i testi…</p>
        ) : (
          <>
            {!riga.propria?.mia && <p className="hint" style={{ margin: "0 0 10px" }}>
              {consorzio
                ? "Stai modificando i testi comuni a tutte le insegne. Prezzo di partenza e prezzo promo sono dati dell'offerta, validi per tutti."
                : `Le modifiche valgono solo per i cartelli di ${scopeLabel}: la versione del Consorzio resta intatta. Prezzo e prezzo di partenza scritti qui sono i vostri per questo articolo, su tutti i cartelli; quelli del solo cartello di oggi si cambiano nella tabella dei selezionati.`}
            </p>}
            {cartello && (
              <div className="pannello-anteprima">
                <Cartello format={cartello.format} layout={cartello.layout} fields={fields} values={cartello.values}
                  scale={Math.min(2.4, 300 / cartello.format.w)} />
              </div>
            )}
            <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 10px" }}>
              {riga.descrizione} · {riga.ean}
              {riga.giacenza !== undefined && <> · giacenza {riga.giacenza}{riga.codiceGestionale ? ` · cod. ${riga.codiceGestionale}` : ""}</>}
            </div>

            {onDuplica && !riga.propria?.mia && (
              <div className="pannello-avviso">
                <span>
                  {riga.propria
                    ? <>Cartello condiviso da {riga.propria.autore || "un'altra insegna"}: per cambiarlo fanne una copia vostra.</>
                    : <>Serve un cartello diverso, senza toccare questo? Fanne una copia e correggi quella.</>}
                </span>
                <button type="button" className="btn btn-sm" onClick={() => onDuplica(riga.id)}>⧉ Duplica e modifica</button>
              </div>
            )}
            {riga.propria?.mia ? (
              <CartelloProprio riga={riga} scopeParam={scopeParam} consorzio={consorzio} onRefresh={onRefresh}
                condizioniStandard={condizioniStandard} onDuplica={onDuplica}
                onEliminato={() => { onEliminato?.(riga.id); onClose(); }} Campo={Campo} />
            ) : (<>
            <Campo label="Titolo (prodotto padre)">
              {riga.parentId && riga.nome ? (
                <>
                  <InlineEdit value={riga.nome.value} onSaved={onRefresh}
                    onSave={updateParentFieldInline.bind(null, riga.parentId, "nome", scopeParam)} />
                  <Personalizzato v={riga.nome} />
                </>
              ) : <span className="hint">{riga.descrizione} (senza padre)</span>}
            </Campo>
            <Campo label="Descrizione sul cartello">
              {riga.parentId && riga.desc ? (
                <>
                  <InlineEdit value={riga.desc.value} multiline placeholder="descrizione per il cartello…" onSaved={onRefresh}
                    onSave={updateParentFieldInline.bind(null, riga.parentId, "descCartello", scopeParam)} />
                  <Personalizzato v={riga.desc} testo="personalizzata" />
                </>
              ) : <span className="pill pill-gray">—</span>}
            </Campo>
            <Campo label="Descrizione dell'offerta">
              <InlineEdit value={riga.descOfferta.value} multiline placeholder="descrizione dell'offerta…" onSaved={onRefresh}
                onSave={setOfferTextScoped.bind(null, riga.id, "descrizione", scopeParam)} />
              <Personalizzato v={riga.descOfferta} testo="personalizzata" />
            </Campo>
            <div className="pannello-riga">
              <Campo label="Animale">
                {riga.parentId && riga.animale ? (
                  <>
                    <InlineSelect value={riga.animale.value} options={categorieAnimali} onSaved={onRefresh}
                      onSave={setParentTagScoped.bind(null, riga.parentId, "animale", scopeParam)} />
                    <Personalizzato v={riga.animale} />
                  </>
                ) : <span className="pill pill-gray">—</span>}
              </Campo>
              <Campo label="Caratteristica">
                {riga.parentId && riga.caratt ? (
                  <>
                    <InlineSelect value={riga.caratt.value} options={caratteristicheProdotto} onSaved={onRefresh}
                      onSave={setParentTagScoped.bind(null, riga.parentId, "prodotto", scopeParam)} />
                    <Personalizzato v={riga.caratt} testo="personalizzata" />
                  </>
                ) : <span className="pill pill-gray">—</span>}
              </Campo>
            </div>
            <div className="pannello-riga">
              <Campo label="Prezzo promo" nota={consorzio ? undefined : "vostro, su tutti i cartelli"}>
                {consorzio ? (
                  <InlineEdit value={riga.prezzoPromo} placeholder="es. 9,99" onSaved={onRefresh}
                    onSave={updateOfferFieldInline.bind(null, riga.id, "prezzoPromo")} />
                ) : (
                  <>
                    <InlineEdit value={riga.pv ?? ""} placeholder={riga.prezzoPromo} onSaved={onRefresh}
                      onSave={setPvPriceInline.bind(null, riga.ean, scopeParam)} />
                    {riga.pv
                      ? <span className="pill pill-orange">vostro prezzo</span>
                      : <span className="hint">Consorzio: € {riga.prezzoPromo || "—"}</span>}
                  </>
                )}
              </Campo>
              <Campo label="Prezzo di partenza">
                {consorzio ? (
                  <InlineEdit value={riga.prezzoListino ?? ""} placeholder="es. 12,99" onSaved={onRefresh}
                    onSave={updateOfferFieldInline.bind(null, riga.id, "prezzoListino")} />
                ) : (
                  <>
                    <InlineEdit value={riga.pvListino ?? ""} placeholder={riga.prezzoListino || "A SOLI"} onSaved={onRefresh}
                      onSave={setPvListinoInline.bind(null, riga.ean, scopeParam)} />
                    {riga.pvListino
                      ? <span className="pill pill-orange">vostro</span>
                      : riga.listinoGestionale
                        ? <span className="hint" title="Prezzo di vendita del vostro gestionale: è quello che si stampa come prezzo di partenza">dal gestionale: € {riga.listinoGestionale}</span>
                        : <span className="hint">Consorzio: {riga.prezzoListino ? `€ ${riga.prezzoListino}` : "A SOLI"}</span>}
                  </>
                )}
              </Campo>
            </div>
            <Campo label="Meccanica" nota={consorzio ? "es. 3x2, 1+1" : "la decide il Consorzio"}>
              {consorzio ? (
                <InlineEdit value={riga.meccanica ?? ""} placeholder="es. 3x2" onSaved={onRefresh}
                  onSave={updateOfferFieldInline.bind(null, riga.id, "meccanica")} />
              ) : <span style={{ fontSize: 13 }}>{riga.meccanica || "—"}</span>}
            </Campo>
            <Campo label="Condizioni">
              {condizioniStandard.length > 0 && (
                <InlineSelect value={condizioniStandard.includes(riga.cond.value) ? riga.cond.value : ""}
                  options={condizioniStandard} vuoto="— scegli una condizione pronta —" onSaved={onRefresh}
                  onSave={setOfferTextScoped.bind(null, riga.id, "condizioni", scopeParam)} />
              )}
              <InlineEdit value={riga.cond.value} placeholder="oppure scrivi le tue condizioni…" onSaved={onRefresh}
                onSave={setOfferTextScoped.bind(null, riga.id, "condizioni", scopeParam)} />
              <Personalizzato v={riga.cond} testo="personalizzate" />
            </Campo>
            </>)}
            {!consorzio && !riga.propria?.mia && (
              <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px dashed var(--line)" }}>
                <button type="button" className="btn btn-outline btn-sm" disabled={pending}
                  style={riga.escluso ? undefined : { color: "var(--red)", borderColor: "var(--red)" }}
                  title={riga.escluso ? "Rimettilo fra i cartelli da stampare" : "Escludi questo cartello: l'offerta resta valida per gli altri punti vendita"}
                  onClick={() => startTransition(async () => {
                    // l'azione fa un redirect pensato per il form: qui basta ricaricare i dati
                    try { await toggleZooNoPrint(riga.id, scopeParam, "/stampe/zoo/stampa"); } catch { /* redirect */ }
                    onRefresh();
                  })}>
                  {riga.escluso ? "Escluso ✕ — rimetti in stampa" : "Non stampare questo cartello"}
                </button>
              </div>
            )}
          </>
        )}
      </aside>
    </>
  );
}

/**
 * I campi di un cartello proprio: si scrivono sull'offerta, non sul padre, così
 * una copia si corregge senza toccare l'originale.
 */
function CartelloProprio({
  riga, scopeParam, consorzio, condizioniStandard, onRefresh, onDuplica, onEliminato, Campo,
}: {
  riga: RigaPersonalizza;
  scopeParam: string;
  consorzio: boolean;
  condizioniStandard: string[];
  onRefresh: () => void;
  onDuplica?: (id: string) => void;
  onEliminato: () => void;
  Campo: (p: { label: string; nota?: string; children: React.ReactNode }) => React.ReactElement;
}) {
  const [pending, startTransition] = useTransition();
  const [condivisa, setCondivisa] = useState(riga.propria?.condivisa ?? false);
  const [conferma, setConferma] = useState(false);
  const salva = (campo: CampoCartelloProprio) => aggiornaCartelloProprio.bind(null, riga.id, scopeParam, campo);
  return (
    <>
      <div className="pannello-avviso verde">
        <span>
          {consorzio
            ? "Cartello fatto dal Consorzio: lo vedono e lo stampano tutti."
            : "Cartello vostro: le correzioni valgono solo per lui, l'originale non cambia."}
        </span>
      </div>
      <Campo label="Titolo del cartello">
        <InlineEdit value={riga.propria?.titolo || riga.descrizione} onSaved={onRefresh} onSave={salva("titolo")} />
      </Campo>
      <Campo label="Descrizione sul cartello">
        <InlineEdit value={riga.propria?.descCartello ?? ""} multiline placeholder="due righe sul prodotto…"
          onSaved={onRefresh} onSave={salva("descCartello")} />
      </Campo>
      <Campo label="Descrizione dell'offerta">
        <InlineEdit value={riga.descOfferta.value} multiline onSaved={onRefresh} onSave={salva("descrizione")} />
      </Campo>
      <div className="pannello-riga">
        <Campo label="Marca">
          <InlineEdit value={riga.propria?.marca ?? ""} placeholder="quella dell'articolo" onSaved={onRefresh} onSave={salva("marca")} />
        </Campo>
        <Campo label="Promozione" nota="3x2, sconto 20%…">
          <InlineEdit value={riga.meccanica ?? ""} placeholder="es. 3x2" onSaved={onRefresh} onSave={salva("meccanica")} />
        </Campo>
      </div>
      <div className="pannello-riga">
        <Campo label="Prezzo promo">
          <InlineEdit value={riga.prezzoPromo} placeholder="es. 9,99" onSaved={onRefresh} onSave={salva("prezzoPromo")} />
        </Campo>
        <Campo label="Prezzo di partenza" nota="vuoto = A SOLI">
          <InlineEdit value={riga.prezzoListino ?? ""} placeholder="es. 12,99" onSaved={onRefresh} onSave={salva("prezzoListino")} />
        </Campo>
      </div>
      <Campo label="Condizioni">
        {condizioniStandard.length > 0 && (
          <InlineSelect value={condizioniStandard.includes(riga.cond.value) ? riga.cond.value : ""}
            options={condizioniStandard} vuoto="— scegli una condizione pronta —" onSaved={onRefresh}
            onSave={salva("condizioni")} />
        )}
        <InlineEdit value={riga.cond.value} placeholder="oppure scrivi le condizioni…" onSaved={onRefresh} onSave={salva("condizioni")} />
      </Campo>
      <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px dashed var(--line)", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {!consorzio && (
          <label className="interruttore-grande" title="Lo vedono e lo stampano tutte le insegne e i punti vendita; lo correggete solo voi">
            <input type="checkbox" checked={condivisa} disabled={pending}
              onChange={(e) => {
                const v = e.target.checked;
                setCondivisa(v);
                startTransition(async () => {
                  const r = await condividiCartelloProprio(riga.id, scopeParam, v).catch(() => ({ ok: false }));
                  if (!r.ok) setCondivisa(!v); else onRefresh();
                });
              }} />
            Condividi con tutto il Consorzio
          </label>
        )}
        {onDuplica && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onDuplica(riga.id)}>⧉ Duplica</button>
        )}
        <span style={{ flex: 1 }} />
        {conferma ? (
          <>
            <span className="hint">Eliminarlo davvero?</span>
            <button type="button" className="btn btn-sm btn-rosso" disabled={pending}
              onClick={() => startTransition(async () => {
                const r = await eliminaCartelloProprio(riga.id, scopeParam).catch(() => ({ ok: false }));
                if (r.ok) onEliminato();
              })}>
              Sì, elimina
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setConferma(false)}>No</button>
          </>
        ) : (
          <button type="button" className="btn btn-outline btn-sm" style={{ color: "var(--red)", borderColor: "var(--red)" }}
            onClick={() => setConferma(true)}>
            Elimina cartello
          </button>
        )}
      </div>
    </>
  );
}
