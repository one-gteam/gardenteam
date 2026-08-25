"use client";

import { useState } from "react";

/**
 * Campo di testo modificabile direttamente in una cella di tabella, con
 * salvataggio automatico al perdere il fuoco (nessun pulsante "Salva"): `onSave`
 * è una server action già "legata" (bind) ai suoi parametri fissi, così questo
 * componente resta generico e riusabile per qualunque campo.
 */
export default function InlineEdit({
  value, onSave, multiline, placeholder,
}: {
  value: string;
  onSave: (value: string) => Promise<{ ok: boolean }>;
  multiline?: boolean;
  placeholder?: string;
}) {
  const [v, setV] = useState(value);
  const [stato, setStato] = useState<"" | "salvo" | "ok" | "errore">("");

  const save = async () => {
    if (v === value) return;
    setStato("salvo");
    try {
      const res = await onSave(v);
      setStato(res.ok ? "ok" : "errore");
    } catch {
      setStato("errore");
    }
    setTimeout(() => setStato((s) => (s === "salvo" ? s : "")), 1500);
  };

  const style: React.CSSProperties = {
    fontSize: 12.5, width: "100%", marginTop: 0, padding: "3px 5px",
    border: "1px solid transparent", borderRadius: 4, background: "transparent", resize: "vertical",
  };

  return (
    <span style={{ display: "block", position: "relative" }}>
      {multiline ? (
        <textarea rows={2} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={save} style={style} />
      ) : (
        <input value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={save} style={style} />
      )}
      {stato === "salvo" && <span style={{ fontSize: 9.5, color: "var(--muted)" }}>salvataggio…</span>}
      {stato === "ok" && <span style={{ fontSize: 9.5, color: "var(--green-700)" }}>✓ salvato</span>}
      {stato === "errore" && <span style={{ fontSize: 9.5, color: "#a33" }}>errore nel salvataggio</span>}
    </span>
  );
}
