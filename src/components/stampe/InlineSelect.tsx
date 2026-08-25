"use client";

import { useState } from "react";

/**
 * Menu a tendina modificabile direttamente in una cella di tabella, con
 * salvataggio automatico alla scelta (nessun pulsante "Salva"). Come
 * `InlineEdit`, `onSave` è una server action già "legata" ai suoi parametri.
 */
export default function InlineSelect({
  value, options, onSave, vuoto = "—",
}: {
  value: string;
  options: string[];
  onSave: (value: string) => Promise<{ ok: boolean }>;
  vuoto?: string;
}) {
  const [v, setV] = useState(value);
  const [stato, setStato] = useState<"" | "salvo" | "errore">("");

  const change = async (next: string) => {
    setV(next);
    setStato("salvo");
    try {
      const res = await onSave(next);
      setStato(res.ok ? "" : "errore");
    } catch {
      setStato("errore");
    }
  };

  return (
    <span style={{ display: "block" }}>
      <select
        value={v}
        onChange={(e) => change(e.target.value)}
        disabled={stato === "salvo"}
        style={{ fontSize: 11.5, marginTop: 0, padding: "2px 4px", width: "100%", maxWidth: 140 }}
      >
        <option value="">{vuoto}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {stato === "errore" && <span style={{ fontSize: 9.5, color: "#a33" }}>errore</span>}
    </span>
  );
}
