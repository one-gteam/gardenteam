"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Un pulsante che fa un'azione e scrive accanto il suo esito (anche quando
 * riesce: "Collegata: 12 messaggi…", "3 articoli importati"). Le azioni
 * rispondono { ok, error } e usano `error` anche per il messaggio buono.
 */
export default function EsitoAzione({ azione, etichetta }: { azione: () => Promise<{ ok: boolean; error?: string }>; etichetta: string }) {
  const [pending, startTransition] = useTransition();
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  const router = useRouter();
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" className="btn btn-outline btn-sm" disabled={pending}
        onClick={() => startTransition(async () => {
          const r = await azione().catch(() => ({ ok: false, error: "Non riuscito: riprova." }));
          setEsito({ ok: r.ok, testo: r.error ?? (r.ok ? "Fatto" : "Non riuscito") });
          router.refresh();
        })}>
        {pending ? "…" : etichetta}
      </button>
      {esito && <span style={{ fontSize: 13, fontWeight: 600, color: esito.ok ? "var(--green-700)" : "var(--red)" }}>{esito.testo}</span>}
    </span>
  );
}
