"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cambiaFotoArea, ripristinaFotoArea } from "@/lib/actions";

/**
 * Sulla scheda di un'area in "Scegli": l'amministratore di sistema cambia la
 * foto di copertina (o torna a quella di serie). Sta sopra la foto, fuori dal
 * link, così il clic non fa entrare nell'area.
 */
export default function CambiaFotoArea({ chiave, personalizzata }: { chiave: string; personalizzata: boolean }) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [errore, setErrore] = useState("");

  const carica = (f: File) => {
    const fd = new FormData();
    fd.append("foto", f);
    setErrore("");
    startTransition(async () => {
      const r = await cambiaFotoArea(chiave, fd).catch(() => ({ ok: false, error: "Caricamento non riuscito" }));
      if (!r.ok) setErrore(r.error ?? "Non riuscito");
      else router.refresh();
      if (file.current) file.current.value = "";
    });
  };

  return (
    <div className="foto-area-comandi">
      <input ref={file} type="file" accept="image/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) carica(f); }} />
      <button type="button" className="foto-area-btn" disabled={pending} title="Cambia la foto di quest'area (per tutti)"
        onClick={() => file.current?.click()}>
        {pending ? "…" : "📷 Cambia foto"}
      </button>
      {personalizzata && (
        <button type="button" className="foto-area-btn" disabled={pending} title="Torna alla foto di serie"
          onClick={() => startTransition(async () => {
            const r = await ripristinaFotoArea(chiave).catch(() => ({ ok: false, error: "Non riuscito" }));
            if (!r.ok) setErrore(r.error ?? "Non riuscito"); else router.refresh();
          })}>
          ↺
        </button>
      )}
      {errore && <span className="foto-area-errore">{errore}</span>}
    </div>
  );
}
