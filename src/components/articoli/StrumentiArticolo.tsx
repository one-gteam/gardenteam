"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { iscrizioneNewsletter, segnaLetto } from "@/lib/articoli-actions";

/** La casella "Ricevi la newsletter" nella pagina degli articoli. */
export function CasellaNewsletter({ iscritto, cadenza }: { iscritto: boolean; cadenza: string }) {
  const [on, setOn] = useState(iscritto);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <label className={`interruttore-grande ${on ? "acceso" : ""}`} title={`Ti arriva ${cadenza} un'email con gli articoli nuovi che puoi vedere`}>
      <input type="checkbox" checked={on} disabled={pending}
        onChange={(e) => {
          const v = e.target.checked;
          setOn(v);
          startTransition(async () => {
            const r = await iscrizioneNewsletter(v).catch(() => ({ ok: false }));
            if (!r.ok) setOn(!v); else router.refresh();
          });
        }} />
      <span>📬 Ricevi la newsletter {on ? `(${cadenza})` : ""}</span>
    </label>
  );
}

/** Aprendo l'articolo si segna la lettura: il "letto da" di chi pubblica si aggiorna da solo. */
export function SegnaLetto({ id }: { id: string }) {
  useEffect(() => { void segnaLetto(id); }, [id]);
  return null;
}
