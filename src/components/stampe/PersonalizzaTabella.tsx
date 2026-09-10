"use client";

import { useTransition } from "react";
import InlineEdit from "./InlineEdit";
import InlineSelect from "./InlineSelect";
import {
  updateParentFieldInline, setParentTagScoped, setOfferTextScoped, setPvPriceInline, updateOfferFieldInline,
  toggleZooNoPrint,
} from "@/lib/zoo-actions";

interface Valore { value: string; custom: boolean }

/** Una riga della tabella: arriva da /stampe/zoo/stampa/dettagli. */
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
  escluso: boolean;
}

/**
 * La tabella "Personalizza per <ambito>" di Stampa cartelli, resa dal browser:
 * compare appena si seleziona un'offerta, senza aspettare "Aggiorna anteprima",
 * e ogni salvataggio richiede solo i dati aggiornati (onRefresh), non la pagina.
 */
export default function PersonalizzaTabella({
  righe, scopeType, scopeLabel, scopeParam, categorieAnimali, caratteristicheProdotto, condizioniStandard, onRefresh,
}: {
  righe: RigaPersonalizza[];
  scopeType: string;
  scopeLabel: string;
  scopeParam: string;
  categorieAnimali: string[];
  caratteristicheProdotto: string[];
  condizioniStandard: string[];
  onRefresh: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const consorzio = scopeType === "system";
  if (righe.length === 0) return null;

  return (
    <div className="card" style={{ marginTop: 16, padding: 14 }}>
      <h2 style={{ marginTop: 0 }}>{consorzio ? "Testi del cartello (versione Consorzio)" : `Personalizza per ${scopeLabel}`}</h2>
      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 10px" }}>
        {consorzio
          ? "Stai modificando i testi comuni a tutte le insegne. Prezzo di partenza e prezzo promo sono dati dell'offerta, validi per tutti."
          : `Le modifiche qui sotto valgono solo per i cartelli di ${scopeLabel}: la versione del Consorzio resta intatta. Il prezzo scritto qui è il vostro prezzo per quell'articolo; quello del solo cartello si cambia nella tabella "Selezionati".`}
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Titolo (padre)</th>
              <th className="col-wide">Descrizione offerta</th>
              <th className="col-wide">Descrizione (cartello)</th>
              <th>Animale</th>
              <th>Caratteristica</th>
              <th>Prezzo</th>
              <th>Prezzo di partenza</th>
              <th>Meccanica</th>
              <th>Condizioni</th>
              {!consorzio && <th className="no-print">Stampa</th>}
            </tr>
          </thead>
          <tbody>
            {righe.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.parentId && r.nome ? (
                    <>
                      <InlineEdit value={r.nome.value} onSaved={onRefresh}
                        onSave={updateParentFieldInline.bind(null, r.parentId, "nome", scopeParam)} />
                      {r.nome.custom && <span className="pill pill-orange">personalizzato</span>}
                    </>
                  ) : (
                    <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.descrizione} (senza padre)</span>
                  )}
                </td>
                <td className="col-wide">
                  <InlineEdit value={r.descOfferta.value} multiline placeholder="descrizione dell'offerta…" onSaved={onRefresh}
                    onSave={setOfferTextScoped.bind(null, r.id, "descrizione", scopeParam)} />
                  {r.descOfferta.custom && <span className="pill pill-orange">personalizzata</span>}
                </td>
                <td className="col-wide">
                  {r.parentId && r.desc ? (
                    <>
                      <InlineEdit value={r.desc.value} multiline placeholder="descrizione per il cartello…" onSaved={onRefresh}
                        onSave={updateParentFieldInline.bind(null, r.parentId, "descCartello", scopeParam)} />
                      {r.desc.custom && <span className="pill pill-orange">personalizzata</span>}
                    </>
                  ) : <span className="pill pill-gray">—</span>}
                </td>
                <td>
                  {r.parentId && r.animale ? (
                    <>
                      <InlineSelect value={r.animale.value} options={categorieAnimali} onSaved={onRefresh}
                        onSave={setParentTagScoped.bind(null, r.parentId, "animale", scopeParam)} />
                      {r.animale.custom && <span className="pill pill-orange">personalizzato</span>}
                    </>
                  ) : <span className="pill pill-gray">—</span>}
                </td>
                <td>
                  {r.parentId && r.caratt ? (
                    <>
                      <InlineSelect value={r.caratt.value} options={caratteristicheProdotto} onSaved={onRefresh}
                        onSave={setParentTagScoped.bind(null, r.parentId, "prodotto", scopeParam)} />
                      {r.caratt.custom && <span className="pill pill-orange">personalizzata</span>}
                    </>
                  ) : <span className="pill pill-gray">—</span>}
                </td>
                <td>
                  {consorzio ? (
                    <InlineEdit value={r.prezzoPromo} placeholder="es. 9,99" onSaved={onRefresh}
                      onSave={updateOfferFieldInline.bind(null, r.id, "prezzoPromo")} />
                  ) : (
                    <>
                      <InlineEdit value={r.pv ?? ""} placeholder={r.prezzoPromo} onSaved={onRefresh}
                        onSave={setPvPriceInline.bind(null, r.ean, scopeParam)} />
                      {r.pv
                        ? <span className="pill pill-orange">vostro prezzo</span>
                        : <span className="hint">Consorzio: € {r.prezzoPromo || "—"}</span>}
                    </>
                  )}
                </td>
                <td>
                  {/*
                    Il prezzo di partenza e la meccanica sono dati dell'offerta, comuni a tutti:
                    li corregge il Consorzio. Gli altri ambiti li vedono, e lo cambiano solo
                    sul singolo cartello dalla tabella "Selezionati".
                  */}
                  {consorzio ? (
                    <InlineEdit value={r.prezzoListino ?? ""} placeholder="es. 12,99" onSaved={onRefresh}
                      onSave={updateOfferFieldInline.bind(null, r.id, "prezzoListino")} />
                  ) : (
                    <span style={{ fontSize: 12 }}>{r.prezzoListino ? `€ ${r.prezzoListino}` : "A SOLI"}</span>
                  )}
                </td>
                <td>
                  {consorzio ? (
                    <InlineEdit value={r.meccanica ?? ""} placeholder="es. 3x2" onSaved={onRefresh}
                      onSave={updateOfferFieldInline.bind(null, r.id, "meccanica")} />
                  ) : (
                    <span style={{ fontSize: 12 }}>{r.meccanica || "—"}</span>
                  )}
                </td>
                <td>
                  {condizioniStandard.length > 0 && (
                    <InlineSelect value={condizioniStandard.includes(r.cond.value) ? r.cond.value : ""}
                      options={condizioniStandard} vuoto="— scegli una condizione pronta —" onSaved={onRefresh}
                      onSave={setOfferTextScoped.bind(null, r.id, "condizioni", scopeParam)} />
                  )}
                  <InlineEdit value={r.cond.value} placeholder="oppure scrivi le tue condizioni…" onSaved={onRefresh}
                    onSave={setOfferTextScoped.bind(null, r.id, "condizioni", scopeParam)} />
                  {r.cond.custom && <span className="pill pill-orange">personalizzate</span>}
                </td>
                {!consorzio && (
                  <td className="no-print" style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="btn btn-outline btn-sm" disabled={pending}
                      title={r.escluso ? "Rimettilo fra i cartelli da stampare" : "Escludi questo cartello: l'offerta resta valida per gli altri punti vendita"}
                      onClick={() => startTransition(async () => {
                        // l'azione fa un redirect pensato per il form: qui basta ricaricare i dati
                        try { await toggleZooNoPrint(r.id, scopeParam, "/stampe/zoo/stampa"); } catch { /* redirect */ }
                        onRefresh();
                      })}>
                      {r.escluso ? "Escluso ✕" : "Non stampare"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
