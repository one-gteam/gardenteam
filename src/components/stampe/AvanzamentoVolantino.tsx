"use client";

import { useState } from "react";
import { PulsanteAzione } from "@/components/AzioneSenzaRicarica";
import { segnaPassoVolantino } from "@/lib/zoo-actions";
import type { PassoVolantino } from "@/lib/zoo";

/**
 * I passi del volantino in lavorazione, in fila: chiunque apre Offerte in corso
 * vede a che punto si è e cosa manca. I passi misurabili si spuntano da soli
 * (offerte caricate, pagine assegnate, foto, focus); gli altri li segna il
 * Consorzio a mano, e a mano può anche forzare o riaprire quelli automatici.
 * Cliccando un passo se ne apre il dettaglio: cosa manca e dove si sistema.
 */
export default function AvanzamentoVolantino({
  passi, campaignId, puoSegnare,
}: {
  passi: PassoVolantino[];
  campaignId: string;
  puoSegnare: boolean;
}) {
  const fatti = passi.filter((p) => p.fatto).length;
  const [aperto, setAperto] = useState<string | null>(null);
  const dettaglio = passi.find((p) => p.id === aperto);
  const titoloVoci: Record<string, string> = {
    offerte: "Offerte per fornitore", scelta: "Voci a volantino per destinazione", foto: "Voci a volantino ancora senza foto",
    testi: "Titoli e descrizioni delle voci a volantino", focus: "Voci a volantino senza focus", impaginazione: "Voci a volantino non ancora in pagina",
  };
  return (
    <details className="card avanzamento" open style={{ padding: "8px 12px", marginBottom: 12 }}>
      <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>A che punto siamo</strong>
        <span className="hint">{fatti} di {passi.length} passi fatti</span>
        <span style={{ flex: 1, height: 6, background: "#e7ece8", borderRadius: 99, minWidth: 80, maxWidth: 220 }}>
          <span style={{ display: "block", height: "100%", width: `${Math.round((fatti / passi.length) * 100)}%`, background: "var(--green-600, #2f8f4e)", borderRadius: 99 }} />
        </span>
      </summary>
      <ol className="avanzamento-passi">
        {passi.map((p, i) => (
          <li key={p.id} className={`${p.fatto ? "fatto" : p.prossimo ? "prossimo" : ""}${aperto === p.id ? " aperto" : ""}`}
            onClick={(e) => { if ((e.target as HTMLElement).closest("button, a")) return; setAperto(aperto === p.id ? null : p.id); }}
            style={{ cursor: "pointer" }} title="Clic per vedere il dettaglio">
            <span className="numero">{p.fatto ? "✓" : i + 1}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 12.5 }}>{p.fatto ? p.nomeFatto : p.nome}</span>
              <span className="hint" style={{ display: "block", fontSize: 11 }}>
                {p.dettaglio}
                {p.segnato && <> · segnato da {p.segnato.da} il {new Date(p.segnato.il).toLocaleDateString("it-IT")}</>}
              </span>
            </span>
            {puoSegnare && (
              <PulsanteAzione azione={segnaPassoVolantino.bind(null, campaignId, p.id, !p.fatto)} className="mini-btn"
                title={p.fatto ? "Riapri questo passo" : "Segna come fatto"}>
                {p.fatto ? "riapri" : "fatto"}
              </PulsanteAzione>
            )}
          </li>
        ))}
      </ol>
      {dettaglio && (
        <div className="avanzamento-dettaglio">
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <strong style={{ fontSize: 13 }}>{titoloVoci[dettaglio.id] ?? dettaglio.nome}</strong>
            <span className="hint">{dettaglio.voci?.length ?? 0}</span>
            {dettaglio.link && <a className="mini-btn" href={dettaglio.link.href}>{dettaglio.link.testo} →</a>}
            <button type="button" className="mini-btn" style={{ marginLeft: "auto" }} onClick={() => setAperto(null)}>chiudi</button>
          </div>
          {(dettaglio.voci?.length ?? 0) === 0
            ? <p className="hint" style={{ margin: "6px 0 0" }}>Niente da mostrare qui.</p>
            : (
              <ul>
                {dettaglio.voci!.slice(0, 200).map((v, k) => <li key={k}>{v}</li>)}
                {dettaglio.voci!.length > 200 && <li className="hint">… e altre {dettaglio.voci!.length - 200}</li>}
              </ul>
            )}
        </div>
      )}
    </details>
  );
}
