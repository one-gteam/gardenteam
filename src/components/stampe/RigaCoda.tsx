"use client";

import { useState, useTransition, type ReactNode } from "react";
import { togliDallaCodaInline } from "@/lib/zoo-actions";

/**
 * Una riga della coda di stampa. La ✕ toglie il cartello dalla coda senza
 * ricaricare la pagina: la riga sparisce e il resto dell'elenco resta dov'è.
 */
export default function RigaCoda({
  id, scopeParam, contatoreId, tabella = false, dati, children,
}: {
  id: string;
  scopeParam: string;
  /** valori della riga (marca, fornitore…): diventano data-* e servono all'ordinamento */
  dati?: Record<string, string>;
  /** id (anche più d'uno, separati da virgola) delle pastiglie col numero, da tenere allineate senza ricaricare */
  contatoreId?: string;
  /** true = riga di tabella (i figli sono già celle), false = riga di elenco */
  tabella?: boolean;
  children: ReactNode;
}) {
  const [via, setVia] = useState(false);
  const [errore, setErrore] = useState(false);
  const [pending, startTransition] = useTransition();
  if (via) return null;
  const bottone = (
    <>
      {errore && <span className="hint" style={{ color: "var(--red)" }}>non tolto</span>}
      <button type="button" className="btn btn-outline btn-sm" disabled={pending} title="Togli dalla coda"
        onClick={() => startTransition(async () => {
          const r = await togliDallaCodaInline(id, scopeParam);
          if (!r.ok) { setErrore(true); return; }
          setVia(true);
          /* il numero nel titolo della sezione lo disegna il server: senza
             ricaricare la pagina lo aggiorniamo qui, altrimenti resta indietro */
          for (const cid of (contatoreId ?? "").split(",").filter(Boolean)) {
            const conta = document.getElementById(cid);
            if (conta) conta.textContent = String(Math.max(0, Number(conta.textContent) - 1));
          }
        })}>
        ✕
      </button>
    </>
  );
  if (tabella) {
    const attributi = Object.fromEntries(Object.entries(dati ?? {}).map(([k, v]) => [`data-${k}`, v]));
    return (
      <tr {...attributi}>
        {children}
        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{bottone}</td>
      </tr>
    );
  }
  return (
    <li>
      {children}
      {bottone}
    </li>
  );
}
