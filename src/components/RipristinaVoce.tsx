"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ripristinaVoce } from "@/lib/registro-actions";

/** Pulsante «Ripristina» di una riga del Registro modifiche. */
export default function RipristinaVoce({ id, il, prima }: { id: string; il: string; prima: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errore, setErrore] = useState("");

  const vai = (forza: boolean) => startTransition(async () => {
    setErrore("");
    const r = await ripristinaVoce(id, il, forza);
    if (r.ok) { router.refresh(); return; }
    if (r.ora !== undefined) {
      if (confirm(`${r.error}\n\nAdesso è: ${r.ora}\n\nRimettere comunque «${prima || "(vuoto)"}»?`)) vai(true);
      return;
    }
    setErrore(r.error);
  });

  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" disabled={pending}
        title="Rimette il valore di prima"
        onClick={() => { if (confirm(`Ripristinare il valore di prima?\n\n«${prima || "(vuoto)"}»`)) vai(false); }}>
        {pending ? "…" : "Ripristina"}
      </button>
      {errore && <span style={{ display: "block", color: "var(--red, #b42318)", fontSize: 11.5, marginTop: 3 }}>{errore}</span>}
    </>
  );
}
