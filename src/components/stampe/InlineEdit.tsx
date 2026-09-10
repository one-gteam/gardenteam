"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Campo di testo modificabile direttamente in una cella di tabella, con
 * salvataggio automatico al perdere il fuoco (nessun pulsante "Salva"): `onSave`
 * è una server action già "legata" (bind) ai suoi parametri fissi, così questo
 * componente resta generico e riusabile per qualunque campo.
 */
export default function InlineEdit({
  value, onSave, multiline, placeholder, aggiornaPagina, onSaved,
}: {
  value: string;
  onSave: (value: string) => Promise<{ ok: boolean }>;
  multiline?: boolean;
  placeholder?: string;
  /**
   * Ricarica i dati della pagina dopo il salvataggio. Serve dove accanto al campo
   * c'è qualcosa che deve seguirlo — l'anteprima del cartello in Stampa — e resta
   * spento altrove, perché sulle tabelle da centinaia di righe un ricaricamento
   * ad ogni correzione si sentirebbe.
   */
  aggiornaPagina?: boolean;
  /** Chiamato dopo un salvataggio riuscito (per chi ricarica i dati da sé, senza router.refresh). */
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [v, setV] = useState(value);
  const [stato, setStato] = useState<"" | "salvo" | "ok" | "errore">("");

  const save = async () => {
    if (v === value) return;
    setStato("salvo");
    try {
      const res = await onSave(v);
      setStato(res.ok ? "ok" : "errore");
      if (res.ok && aggiornaPagina) router.refresh();
      if (res.ok) onSaved?.();
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
