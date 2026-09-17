"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CardLayout, PrintField, PrintFormat } from "@/lib/stampe";
import Cartello from "./Cartello";
import StampaPicker, { EVENTO_SELEZIONA, type StampaPickerProps } from "./StampaPicker";
import NuovoCartello from "./NuovoCartello";
import PersonalizzaPannello, { type RigaPersonalizza } from "./PersonalizzaPannello";
import { duplicaCartelloInline, mettiInCoda } from "@/lib/zoo-actions";

interface Dettagli {
  scopeType: string;
  scopeLabel: string;
  cartelli: { id: string; format: PrintFormat; layout: CardLayout; values: Record<string, string> }[];
  righe: RigaPersonalizza[];
  categorieAnimali: string[];
  caratteristicheProdotto: string[];
  condizioniStandard: string[];
}

/**
 * Elenco, selezione e anteprima di Stampa cartelli, tenuti insieme dal browser.
 * Ogni cambio di selezione (o di prezzo, formato, campi) chiede al server solo
 * i dati dei cartelli scelti e li ridisegna qui: l'anteprima si aggiorna da
 * sola. I testi di un cartello si correggono dal pannello "Testi" della sua
 * riga, che si apre di lato e ridisegna il cartello a ogni salvataggio.
 */
export default function StampaWorkspace({
  picker, dettagliUrl, fields, scopeParam, scopeLabel, condizioniStandard,
}: {
  picker: Omit<StampaPickerProps, "onChange" | "onQueue" | "onPersonalizza" | "onDuplica" | "nuovoCartello">;
  /** Nome dell'ambito e condizioni pronte: servono al pannello "Nuovo cartello". */
  scopeLabel: string;
  condizioniStandard: string[];
  /** Indirizzo dell'anteprima dal vivo (senza parametri). */
  dettagliUrl: string;
  fields: PrintField[];
  scopeParam: string;
}) {
  const [query, setQuery] = useState<string>("");
  const [dati, setDati] = useState<Dettagli | null>(null);
  const [caricamento, setCaricamento] = useState(false);
  const [personalizzaId, setPersonalizzaId] = useState<string | null>(null);
  const [nuovo, setNuovo] = useState(false);
  const [avviso, setAvviso] = useState("");
  const router = useRouter();
  const ultimaRichiesta = useRef(0);

  const carica = useCallback(async (q: string) => {
    if (!q) { setDati(null); return; }
    const n = ++ultimaRichiesta.current;
    setCaricamento(true);
    try {
      const r = await fetch(`${dettagliUrl}?${q}`);
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as Dettagli;
      if (n === ultimaRichiesta.current) setDati(d);
    } catch {
      if (n === ultimaRichiesta.current) setDati(null);
    } finally {
      if (n === ultimaRichiesta.current) setCaricamento(false);
    }
  }, [dettagliUrl]);

  // la selezione cambia spesso (clic, Shift+clic, un prezzo digitato): si aspetta un attimo prima di chiedere
  useEffect(() => {
    const t = setTimeout(() => carica(query), 350);
    return () => clearTimeout(t);
  }, [query, carica]);

  const anteprima = dati?.cartelli.slice(0, 2) ?? [];
  // chiudendo il pannello si aggiorna l'elenco (un titolo corretto, un cartello condiviso)
  const chiudiPannello = useCallback(() => { setPersonalizzaId(null); router.refresh(); }, [router]);
  const chiudiNuovo = useCallback(() => setNuovo(false), []);

  /** Un cartello proprio appena nato entra fra i selezionati e si apre coi suoi testi. */
  const appenaCreato = (id: string, al?: string) => {
    window.dispatchEvent(new CustomEvent(EVENTO_SELEZIONA, { detail: { id, al } }));
    setPersonalizzaId(id);
    // dopo che la selezione è finita nell'indirizzo: il server deve sapere che il nuovo cartello è scelto
    setTimeout(() => router.refresh(), 150);
  };
  const duplica = async (id: string) => {
    setAvviso("");
    const r = await duplicaCartelloInline(id, scopeParam).catch(() => ({ ok: false, id: undefined }));
    if (r.ok && r.id) appenaCreato(r.id, id);
    else setAvviso("Non sono riuscito a duplicare il cartello.");
  };

  return (
    <>
      <div className="stampa-griglia">
        <StampaPicker {...picker} onChange={(q) => setQuery(q)}
          onQueue={(stato, voci) => mettiInCoda(scopeParam, stato, voci)}
          onPersonalizza={(id) => setPersonalizzaId(id)}
          onDuplica={duplica}
          nuovoCartello={
            <button type="button" className="btn btn-sm" onClick={() => setNuovo(true)}
              title="Un cartello fuori dal volantino, fatto da zero">
              ＋ Nuovo cartello
            </button>
          } />
        <div>
          {anteprima.map((c) => (
            <div key={c.id} style={{ marginBottom: 12, overflow: "hidden" }}>
              {/* la colonna è stretta: il cartello si scala per starci, qualunque formato sia */}
              <Cartello format={c.format} layout={c.layout} fields={fields} values={c.values}
                scale={Math.min(2.4, 280 / c.format.w)} />
            </div>
          ))}
          {anteprima.length === 0 && (
            <div className="card">
              <p className="empty">
                {caricamento ? "Preparo l’anteprima…" : "L’anteprima compare appena selezioni un prodotto e si aggiorna da sola."}
              </p>
            </div>
          )}
          {anteprima.length > 0 && (
            <p className="hint">
              {(dati?.cartelli.length ?? 0) > 2 ? `Anteprima dei primi 2 cartelli su ${dati!.cartelli.length}: in stampa escono tutti. ` : ""}
              Si aggiorna da sola a ogni modifica{caricamento ? "…" : "."}
            </p>
          )}
        </div>
      </div>

      {personalizzaId && (
        <PersonalizzaPannello
          riga={dati?.righe.find((r) => r.id === personalizzaId)}
          cartello={dati?.cartelli.find((c) => c.id === personalizzaId)}
          fields={fields}
          scopeType={dati?.scopeType ?? ""}
          scopeLabel={dati?.scopeLabel ?? ""}
          scopeParam={scopeParam}
          categorieAnimali={dati?.categorieAnimali ?? []}
          caratteristicheProdotto={dati?.caratteristicheProdotto ?? []}
          condizioniStandard={dati?.condizioniStandard ?? []}
          onRefresh={() => carica(query)}
          onClose={chiudiPannello}
          onDuplica={duplica}
          onEliminato={(id) => window.dispatchEvent(new CustomEvent(EVENTO_SELEZIONA, { detail: { id, togli: true } }))}
        />
      )}
      {nuovo && (
        <NuovoCartello
          scopeParam={scopeParam}
          scopeLabel={scopeLabel}
          consorzio={scopeParam.startsWith("system")}
          condizioniStandard={condizioniStandard}
          onClose={chiudiNuovo}
          onCreato={(id) => { setNuovo(false); appenaCreato(id); }}
        />
      )}
      {avviso && <div className="alert alert-amber" style={{ marginTop: 10 }}>{avviso}</div>}
    </>
  );
}
