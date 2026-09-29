"use client";

import { useState } from "react";
import type { PermessoRuolo, Role, SiteId } from "@/lib/types";
import { CATALOGO, puoFare, type Profilo } from "@/lib/permessi-catalogo";

const AREE: { id: SiteId; nome: string }[] = [
  { id: "academy", nome: "Formazione" }, { id: "arredo", nome: "Cartelli Arredo" },
  { id: "zoo", nome: "Offerte Zoo" }, { id: "piante", nome: "Piante" },
];

/**
 * "Prova un profilo": si sceglie ruolo, dove è collocata la persona e quali
 * aree ha, e si legge cosa può fare, area per area, con il perché. Usa la
 * tabella dei permessi in vigore e lo stesso catalogo della pagina.
 */
export default function ProvaProfilo({
  matrice, etichetteRuoli,
}: {
  matrice: Record<Role, Record<PermessoRuolo, boolean>>;
  etichetteRuoli: Record<Role, string>;
}) {
  const [p, setP] = useState<Profilo>({ role: "manager", livello: "insegna", aree: ["zoo"], gestite: ["zoo"], editorVolantino: false });
  const perm = (r: Role, k: PermessoRuolo) => matrice[r]?.[k] ?? false;
  const alterna = (lista: SiteId[], a: SiteId) => (lista.includes(a) ? lista.filter((x) => x !== a) : [...lista, a]);

  return (
    <div>
      <div className="prova-profilo-scelte">
        <label className="field" style={{ marginBottom: 0 }}>
          Ruolo
          <select value={p.role} onChange={(e) => setP({ ...p, role: e.target.value as Role })}>
            {(Object.keys(etichetteRuoli) as Role[]).map((r) => <option key={r} value={r}>{etichetteRuoli[r]}</option>)}
          </select>
        </label>
        <label className="field" style={{ marginBottom: 0 }}>
          Collocato
          <select value={p.livello} onChange={(e) => setP({ ...p, livello: e.target.value as Profilo["livello"] })}>
            <option value="consorzio">al Consorzio</option>
            <option value="insegna">in un&apos;insegna</option>
            <option value="pv">in un punto vendita</option>
          </select>
        </label>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>Aree abilitate</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {AREE.map((a) => (
              <label key={a.id} style={{ fontSize: 13, display: "flex", gap: 4, alignItems: "center" }}>
                <input type="checkbox" checked={p.aree.includes(a.id)} onChange={() => setP({ ...p, aree: alterna(p.aree, a.id) })} />
                {a.nome}
                {p.role === "manager" && p.aree.includes(a.id) && (
                  <span className={`pill ${p.gestite.includes(a.id) ? "pill-green" : "pill-gray"}`} style={{ cursor: "pointer", fontSize: 10.5 }}
                    onClick={(e) => { e.preventDefault(); setP({ ...p, gestite: alterna(p.gestite, a.id) }); }}
                    title="Per il gestore: clic per dire se questa area la gestisce o la usa soltanto">
                    {p.gestite.includes(a.id) ? "gestisce" : "usa"}
                  </span>
                )}
              </label>
            ))}
          </div>
        </div>
        <label style={{ fontSize: 13, display: "flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" checked={!!p.editorVolantino} onChange={(e) => setP({ ...p, editorVolantino: e.target.checked })} />
          fra gli editor del volantino Zoo
        </label>
      </div>

      <div className="prova-profilo-esito">
        {CATALOGO.map((sez) => {
          const esiti = sez.capacita.map((c) => ({ c, e: puoFare(c, sez.area, p, perm) }));
          const si = esiti.filter((x) => x.e.si).length;
          return (
            <div key={sez.area} className="card" style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <strong>{sez.icona} {sez.titolo}</strong>
                <span className="hint">{si} di {esiti.length}</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 3 }}>
                {esiti.map(({ c, e }) => (
                  <li key={c.testo} style={{ fontSize: 12.5, display: "flex", gap: 6, opacity: e.si ? 1 : 0.55 }}>
                    <span style={{ color: e.si ? "var(--green-700)" : "#999", fontWeight: 800 }}>{e.si ? "✓" : "✕"}</span>
                    <span>
                      {c.testo}
                      <span className="hint" style={{ fontSize: 11 }}> — {e.perche}{c.nota ? ` (${c.nota})` : ""}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
