"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CardLayout, PrintField, PrintFormat } from "@/lib/stampe";
import Cartello from "./Cartello";
import StampaPicker, { type StampaPickerProps } from "./StampaPicker";
import PersonalizzaTabella, { type RigaPersonalizza } from "./PersonalizzaTabella";

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
 * Elenco, selezione, anteprima e tabella "Personalizza" di Stampa cartelli,
 * tenuti insieme dal browser. Ogni cambio di selezione (o di prezzo, formato,
 * campi) chiede al server solo i dati dei cartelli scelti e li ridisegna qui:
 * niente più ricaricamento della pagina a ogni "Aggiorna anteprima", e la
 * tabella per personalizzare i testi compare appena si spunta un'offerta.
 */
export default function StampaWorkspace({
  picker, dettagliUrl, fields, scopeParam,
}: {
  picker: Omit<StampaPickerProps, "onChange">;
  /** Indirizzo dell'anteprima dal vivo (senza parametri). */
  dettagliUrl: string;
  fields: PrintField[];
  scopeParam: string;
}) {
  const [query, setQuery] = useState<string>("");
  const [dati, setDati] = useState<Dettagli | null>(null);
  const [caricamento, setCaricamento] = useState(false);
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

  return (
    <>
      <div className="stampa-griglia">
        <StampaPicker {...picker} onChange={(q) => setQuery(q)} onPreview={() => carica(query)} />
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
                {caricamento ? "Preparo l’anteprima…" : "L’anteprima compare appena selezioni un prodotto."}
              </p>
            </div>
          )}
          {anteprima.length > 0 && (dati?.cartelli.length ?? 0) > 2 && (
            <p className="hint">Anteprima dei primi 2 cartelli su {dati!.cartelli.length}: in stampa escono tutti.</p>
          )}
        </div>
      </div>

      {dati && (
        <PersonalizzaTabella
          righe={dati.righe}
          scopeType={dati.scopeType}
          scopeLabel={dati.scopeLabel}
          scopeParam={scopeParam}
          categorieAnimali={dati.categorieAnimali}
          caratteristicheProdotto={dati.caratteristicheProdotto}
          condizioniStandard={dati.condizioniStandard}
          onRefresh={() => carica(query)}
        />
      )}
    </>
  );
}
