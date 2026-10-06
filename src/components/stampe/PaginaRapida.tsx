"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Colonna "Pagina" di Scelta offerte Volantino: le pagine dell'animale della
 * riga sono pulsanti (un clic e via), «no volantino» pure; tutte le altre
 * restano in una tendina. `onSave` è l'azione già legata alle offerte della riga.
 */
export default function PaginaRapida({
  value, suggerite, tutte, noVolantino, onSave,
}: {
  value: string;
  /** Pagine da proporre come pulsanti (quelle con il nome dell'animale della riga). */
  suggerite: { id: string; nome: string }[];
  tutte: { id: string; nome: string }[];
  noVolantino: string;
  onSave: (value: string) => Promise<{ ok: boolean }>;
}) {
  const router = useRouter();
  const [v, setV] = useState(value);
  const [errore, setErrore] = useState(false);
  const [pending, startTransition] = useTransition();

  const scegli = (next: string) => {
    const prima = v;
    setV(next);
    setErrore(false);
    startTransition(async () => {
      const r = await onSave(next).catch(() => ({ ok: false }));
      if (!r.ok) { setV(prima); setErrore(true); return; }
      router.refresh(); // i contatori per pagina in alto seguono la scelta
    });
  };

  const nomeDi = (id: string) => tutte.find((p) => p.id === id)?.nome;
  const altre = tutte.filter((p) => !suggerite.some((s) => s.id === p.id));
  const pill = (id: string, testo: string, titolo: string) => (
    <button key={id} type="button" className={`pill ${v === id ? "pill-blue" : "pill-gray"}`}
      style={{ cursor: "pointer", border: "none", fontSize: 11, padding: "2px 8px" }} title={titolo} disabled={pending}
      onClick={() => scegli(v === id ? "" : id)}>
      {testo}
    </button>
  );

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", minWidth: 150 }}>
      {suggerite.map((p) => pill(p.id, p.nome, "Metti in questa pagina (clic di nuovo per togliere)"))}
      {pill(noVolantino, "✕ no", "Non va sul volantino")}
      {/* pagina scelta fuori dalle proposte: si vede comunque */}
      {v && v !== noVolantino && !suggerite.some((s) => s.id === v) && (
        <span className="pill pill-blue" style={{ fontSize: 11 }}>{nomeDi(v) ?? v}</span>
      )}
      {altre.length > 0 && (
        <select value={altre.some((p) => p.id === v) ? v : ""} onChange={(e) => scegli(e.target.value)} disabled={pending}
          style={{ marginTop: 0, fontSize: 11, padding: "2px 4px", maxWidth: 120 }} aria-label="Altra pagina">
          <option value="">altra…</option>
          {altre.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      )}
      {errore && <span className="hint" style={{ color: "var(--red)" }}>non salvato</span>}
    </div>
  );
}
