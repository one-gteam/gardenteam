"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Scelta di più valori in una cella di tabella (es. gli animali di un padre:
 * «Cane, Gatto» per una ciotola). Si apre un piccolo elenco di spunte; si salva
 * a ogni spunta, come le altre celle modificabili. `onSave` è l'azione già legata.
 */
export default function InlineMulti({
  values, options, onSave, vuoto = "—",
}: {
  values: string[];
  options: string[];
  onSave: (values: string[]) => Promise<{ ok: boolean }>;
  vuoto?: string;
}) {
  const [v, setV] = useState(values);
  const [aperto, setAperto] = useState(false);
  const [stato, setStato] = useState<"" | "salvo" | "errore">("");
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { setV(values); }, [values.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!aperto) return;
    const fuori = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAperto(false); };
    document.addEventListener("mousedown", fuori);
    return () => document.removeEventListener("mousedown", fuori);
  }, [aperto]);

  const alterna = async (o: string) => {
    const prima = v;
    const prossimi = v.includes(o) ? v.filter((x) => x !== o) : [...v, o];
    setV(prossimi);
    setStato("salvo");
    const r = await onSave(prossimi).catch(() => ({ ok: false }));
    if (!r.ok) { setV(prima); setStato("errore"); } else setStato("");
  };

  return (
    <span ref={ref} style={{ position: "relative", display: "inline-block", minWidth: 90 }}>
      <button type="button" onClick={() => setAperto(!aperto)} className="multi-btn"
        title="Clic per scegliere uno o più valori">
        {v.length ? v.join(", ") : vuoto} <span style={{ opacity: 0.6 }}>▾</span>
      </button>
      {aperto && (
        <span className="multi-menu">
          {options.map((o) => (
            <label key={o}>
              <input type="checkbox" checked={v.includes(o)} onChange={() => alterna(o)} /> {o}
            </label>
          ))}
        </span>
      )}
      {stato === "salvo" && <span style={{ fontSize: 9.5, color: "var(--muted)", display: "block" }}>salvataggio…</span>}
      {stato === "errore" && <span style={{ fontSize: 9.5, color: "#a33", display: "block" }}>non salvato</span>}
    </span>
  );
}
