"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { programmaIncontro } from "@/lib/zoo-incontri";

/**
 * Dashboard: si fissa un incontro di una squadra (Zoo, Comunicazione) con
 * data, ora, partecipanti e un testo (es. il link di Teams); se si vuole parte
 * una mail a ciascun partecipante. Per ogni squadra si ripropongono le persone
 * dell'ultima volta.
 */
export default function ProgrammaIncontro({
  campaignId, squadre, ricordati, colleghi,
}: {
  campaignId: string;
  squadre: string[];
  /** le persone dell'ultimo incontro di ciascuna squadra */
  ricordati: Record<string, string[]>;
  colleghi: { id: string; nome: string; email: string }[];
}) {
  const router = useRouter();
  const [squadra, setSquadra] = useState(squadre[0]);
  const [scelti, setScelti] = useState<string[]>(ricordati[squadre[0]] ?? []);
  const [aperto, setAperto] = useState(false);
  const [esito, setEsito] = useState("");
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setScelti(ricordati[squadra] ?? []); }, [squadra]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!aperto) return;
    const fuori = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAperto(false); };
    document.addEventListener("mousedown", fuori);
    return () => document.removeEventListener("mousedown", fuori);
  }, [aperto]);
  const nomi = scelti.map((id) => colleghi.find((c) => c.id === id)?.nome).filter(Boolean) as string[];

  return (
    <form className="card prog-incontro" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      fd.set("squadra", squadra);
      fd.delete("partecipanti");
      for (const id of scelti) fd.append("partecipanti", id);
      startTransition(async () => {
        const r = await programmaIncontro(campaignId, fd).catch(() => ({ ok: false, error: "errore di rete" }));
        setEsito(r.ok ? (r.error ?? "Incontro fissato.") : r.error ?? "non riuscito");
        if (r.ok) { (e.target as HTMLFormElement).reset(); router.refresh(); }
      });
    }}>
      <strong style={{ fontSize: 13.5 }}>Fissa un incontro</strong>
      <div className="prog-griglia">
        <label className="field" style={{ marginBottom: 0 }}>Squadra
          <select value={squadra} onChange={(e) => setSquadra(e.target.value)}>
            {squadre.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="field" style={{ marginBottom: 0 }}>Quando<input type="datetime-local" name="quando" required /></label>
        <label className="field" style={{ marginBottom: 0 }}>Durata
          <select name="durata" defaultValue="60">
            {[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h${m % 60 ? " 30" : ""}`}</option>)}
          </select>
        </label>
        <div className="field" style={{ marginBottom: 0, position: "relative" }} ref={ref}>
          Chi partecipa
          <button type="button" className="multi-btn" style={{ border: "1px solid var(--line)", background: "#fff", width: "100%", marginTop: 2, padding: "6px 8px" }}
            onClick={() => setAperto(!aperto)}>
            {nomi.length ? nomi.join(", ") : "scegli le persone"} ▾
          </button>
          {aperto && (
            <span className="multi-menu" style={{ maxHeight: 300, overflowY: "auto" }}>
              {colleghi.map((c) => (
                <label key={c.id}>
                  <input type="checkbox" checked={scelti.includes(c.id)}
                    onChange={() => setScelti((x) => x.includes(c.id) ? x.filter((y) => y !== c.id) : [...x, c.id])} /> {c.nome}
                </label>
              ))}
            </span>
          )}
        </div>
      </div>
      <label className="field" style={{ marginBottom: 6 }}>Testo per i partecipanti (facoltativo: ordine del giorno, link di Teams…)
        <textarea name="testo" rows={2} placeholder="es. Scelta offerte di dicembre — link Teams: https://teams.microsoft.com/…" />
      </label>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12.5 }}>
          <input type="checkbox" name="invia" value="1" defaultChecked /> manda la mail ai partecipanti
        </label>
        <button className="btn btn-sm" type="submit" disabled={pending || scelti.length === 0}>{pending ? "Salvo…" : "Fissa l'incontro"}</button>
        {esito && <span className="hint" style={{ fontWeight: 700 }}>{esito}</span>}
      </div>
    </form>
  );
}
