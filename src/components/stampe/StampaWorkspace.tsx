"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CardLayout, PrintField, PrintFormat } from "@/lib/stampe";
import Cartello from "./Cartello";
import StampaPicker, { type StampaPickerProps } from "./StampaPicker";
import PersonalizzaPannello, { type RigaPersonalizza } from "./PersonalizzaPannello";
import { mettiInCoda } from "@/lib/zoo-actions";

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
  picker, dettagliUrl, fields, scopeParam,
}: {
  picker: Omit<StampaPickerProps, "onChange" | "onQueue" | "onPersonalizza">;
  /** Indirizzo dell'anteprima dal vivo (senza parametri). */
  dettagliUrl: string;
  fields: PrintField[];
  scopeParam: string;
}) {
  const [query, setQuery] = useState<string>("");
  const [dati, setDati] = useState<Dettagli | null>(null);
  const [caricamento, setCaricamento] = useState(false);
  const [personalizzaId, setPersonalizzaId] = useState<string | null>(null);
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
  const chiudiPannello = useCallback(() => setPersonalizzaId(null), []);

  return (
    <>
      <div className="stampa-griglia">
        <StampaPicker {...picker} onChange={(q) => setQuery(q)}
          onQueue={(stato, voci) => mettiInCoda(scopeParam, stato, voci)}
          onPersonalizza={(id) => setPersonalizzaId(id)} />
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
        />
      )}
    </>
  );
}
