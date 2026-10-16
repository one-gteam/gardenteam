"use client";

import { useState } from "react";

type Area = "academy" | "arredo" | "zoo" | "piante";
const AREE: { id: Area; nome: string }[] = [
  { id: "academy", nome: "Academy" }, { id: "arredo", nome: "Arredo" }, { id: "zoo", nome: "Zoo" }, { id: "piante", nome: "Piante" },
];
// le aree proposte per ogni ruolo: si possono sempre cambiare prima di approvare
const PROPOSTE: Record<string, Area[]> = {
  student: ["academy"], dept_head: ["academy", "arredo", "zoo"], grafico: ["academy", "arredo", "zoo"],
  manager: ["academy", "arredo", "zoo"], store_admin: ["academy", "arredo", "zoo", "piante"], group_admin: ["academy", "arredo", "zoo", "piante"],
};

/**
 * Ruolo e aree di chi chiede la registrazione, scelti da chi approva: corsista
 * (come prima), oppure capo reparto, grafico, gestore, amministratore di PV o
 * d'insegna. Sta dentro il modulo «Approva» della riga (attributo form).
 */
export default function RuoloApprovazione({ formId, ruoli, proposto }: {
  formId: string; ruoli: { value: string; label: string }[]; proposto: string;
}) {
  const [ruolo, setRuolo] = useState(proposto);
  const [aree, setAree] = useState<Area[]>(PROPOSTE[proposto] ?? ["academy"]);
  const cambia = (r: string) => { setRuolo(r); setAree(PROPOSTE[r] ?? ["academy"]); };
  return (
    <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
      <select form={formId} name="role" value={ruolo} onChange={(e) => cambia(e.target.value)} aria-label="Ruolo" style={{ marginTop: 0 }}>
        {ruoli.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12 }}>
        {AREE.map((a) => (
          <label key={a.id} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" form={formId} name="sites" value={a.id} checked={aree.includes(a.id)}
              onChange={(e) => setAree((x) => e.target.checked ? [...x, a.id] : x.filter((y) => y !== a.id))} />
            {a.nome}
          </label>
        ))}
      </div>
      {ruolo === "manager" && <span className="hint" style={{ fontSize: 11 }}>Il gestore gestisce le aree spuntate, sulla versione del Consorzio.</span>}
      {ruolo === "group_admin" && <span className="hint" style={{ fontSize: 11 }}>Diventa amministratore di tutta l&apos;insegna, non solo del punto vendita.</span>}
    </div>
  );
}
