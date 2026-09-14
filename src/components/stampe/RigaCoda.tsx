"use client";

import { useState, useTransition, type ReactNode } from "react";
import { togliDallaCodaInline } from "@/lib/zoo-actions";

/**
 * Una riga della coda di stampa. La ✕ toglie il cartello dalla coda senza
 * ricaricare la pagina: la riga sparisce e il resto dell'elenco resta dov'è.
 */
export default function RigaCoda({
  id, scopeParam, contatoreId, children,
}: {
  id: string;
  scopeParam: string;
  /** id della pastiglia col numero, da tenere allineata senza ricaricare */
  contatoreId?: string;
  children: ReactNode;
}) {
  const [via, setVia] = useState(false);
  const [errore, setErrore] = useState(false);
  const [pending, startTransition] = useTransition();
  if (via) return null;
  return (
    <li>
      {children}
      {errore && <span className="hint" style={{ color: "var(--red)" }}>non tolto</span>}
      <button type="button" className="btn btn-outline btn-sm" disabled={pending} title="Togli dalla coda"
        onClick={() => startTransition(async () => {
          const r = await togliDallaCodaInline(id, scopeParam);
          if (!r.ok) { setErrore(true); return; }
          setVia(true);
          /* il numero nel titolo della sezione lo disegna il server: senza
             ricaricare la pagina lo aggiorniamo qui, altrimenti resta indietro */
          const conta = contatoreId ? document.getElementById(contatoreId) : null;
          if (conta) conta.textContent = String(Math.max(0, Number(conta.textContent) - 1));
        })}>
        ✕
      </button>
    </li>
  );
}
