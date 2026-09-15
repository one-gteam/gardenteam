"use client";

import { useRef, useState, useTransition } from "react";

/**
 * Pulsante di riga che fa la sua azione e toglie la riga dall'elenco, senza
 * ricaricare la pagina: "Rimetti in coda", "Sistemato", "Rimetti in stampa",
 * "Arrivata". Prima ognuno di questi ricaricava tutta la pagina e si perdeva
 * il punto in cui si stava lavorando.
 */
export default function RigaAzione({
  azione, etichetta, titolo, contatoreId,
}: {
  /** azione server già legata ai suoi parametri: risponde { ok } */
  azione: () => Promise<{ ok: boolean }>;
  etichetta: string;
  titolo?: string;
  /** id (anche più d'uno, separati da virgola) delle pastiglie col numero da scalare */
  contatoreId?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [errore, setErrore] = useState(false);
  const rif = useRef<HTMLButtonElement>(null);

  const esegui = () => startTransition(async () => {
    const r = await azione();
    if (!r?.ok) { setErrore(true); return; }
    const riga = rif.current?.closest("tr");
    const sotto = riga?.nextElementSibling as HTMLElement | null;
    // la riga del pannello dettagli sta sotto e non ha dati propri: va via con lei
    if (sotto && !sotto.hasAttribute("data-nome")) sotto.style.display = "none";
    if (riga) riga.style.display = "none";
    for (const cid of (contatoreId ?? "").split(",").filter(Boolean)) {
      const conta = document.getElementById(cid);
      if (conta) conta.textContent = String(Math.max(0, Number(conta.textContent) - 1));
    }
  });

  return (
    <>
      {errore && <span className="hint" style={{ color: "var(--red)" }}>non riuscito</span>}
      <button ref={rif} type="button" className="btn btn-outline btn-sm" disabled={pending} title={titolo} onClick={esegui}>
        {pending ? "…" : etichetta}
      </button>
    </>
  );
}
