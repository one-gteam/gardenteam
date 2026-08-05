"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { quickSetRole, quickSetSites, quickToggleActive, setTenantUserDelegation } from "@/lib/actions";
import { ROLE_LABELS, Role, SiteId } from "@/lib/types";

interface RowUser {
  id: string;
  nome: string;
  ruolo: Role;
  insegna: string;
  pv: string;
  attivo: boolean;
  sites: SiteId[]; // aree effettive (default per ruolo già risolto dal server)
  editabile: boolean; // dentro il perimetro di chi guarda (e non se stesso)
}

interface DelegaTenant {
  id: string;
  nome: string;
  delegata: boolean;
}

/**
 * Gestione utenti e ruoli per tutte le aree, a cascata: il Consorzio vede tutto,
 * l'insegna i propri, il punto vendita i propri (se l'insegna glielo concede).
 * Ruolo, aree e stato si cambiano in riga, senza ricaricare la pagina.
 */
export default function RolesPanel({
  users,
  assignableRoles,
  deleghe,
  showInsegna,
}: {
  users: RowUser[];
  assignableRoles: Role[];
  deleghe: DelegaTenant[]; // vuoto = chi guarda non gestisce deleghe
  showInsegna: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errore, setErrore] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      setErrore(res.ok ? "" : res.error ?? "Operazione non riuscita");
      router.refresh();
    });

  const toggleSite = (u: RowUser, site: SiteId) => {
    const next = u.sites.includes(site) ? u.sites.filter((s) => s !== site) : [...u.sites, site];
    run(() => quickSetSites(u.id, next));
  };

  return (
    <div>
      {deleghe.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ marginBottom: 4 }}>Delega ai punti vendita</h2>
          <p className="hint" style={{ margin: "0 0 10px" }}>
            Con la delega attiva, l&apos;amministratore di un punto vendita gestisce da solo utenti e ruoli del
            proprio negozio; senza, può solo consultare e ogni modifica passa dall&apos;insegna.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {deleghe.map((t) => (
              <label key={t.id} className="checkbox-row" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={t.delegata}
                  disabled={pending}
                  onChange={(e) => run(() => setTenantUserDelegation(t.id, e.target.checked))}
                />
                <strong>{t.nome}</strong> — i punti vendita gestiscono i propri utenti
              </label>
            ))}
          </div>
        </div>
      )}

      {errore && <div className="alert alert-amber">{errore}</div>}

      <div className="card table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Collaboratore</th>
              {showInsegna && <th>Insegna</th>}
              <th>Punto vendita</th>
              <th>Ruolo</th>
              <th>Aree</th>
              <th>Stato</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ opacity: u.attivo ? 1 : 0.55 }}>
                <td>
                  <a href={`/admin/utenti/${u.id}`} style={{ color: "inherit" }}><strong>{u.nome}</strong></a>
                </td>
                {showInsegna && <td>{u.insegna}</td>}
                <td>{u.pv}</td>
                <td>
                  {u.editabile && assignableRoles.includes(u.ruolo) ? (
                    <select
                      value={u.ruolo}
                      disabled={pending}
                      onChange={(e) => run(() => quickSetRole(u.id, e.target.value as Role))}
                      style={{ marginTop: 0, minWidth: 190 }}
                    >
                      {assignableRoles.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="pill pill-gray">{ROLE_LABELS[u.ruolo]}</span>
                  )}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {(["academy", "stampe"] as SiteId[]).map((site) => (
                    <label key={site} style={{ fontSize: 12.5, display: "inline-flex", gap: 4, alignItems: "center", marginRight: 12 }}>
                      <input
                        type="checkbox"
                        checked={u.sites.includes(site)}
                        disabled={!u.editabile || pending}
                        onChange={() => toggleSite(u, site)}
                      />
                      {site === "academy" ? "Academy" : "Stampe"}
                    </label>
                  ))}
                </td>
                <td>
                  {u.editabile ? (
                    <button
                      type="button"
                      className={`btn btn-sm ${u.attivo ? "btn-outline" : ""}`}
                      disabled={pending}
                      onClick={() => run(() => quickToggleActive(u.id))}
                      title={u.attivo ? "Blocca l'accesso (cessazione)" : "Riattiva l'accesso"}
                    >
                      {u.attivo ? "Attivo" : "Cessato"}
                    </button>
                  ) : (
                    <span className={`pill ${u.attivo ? "pill-green" : "pill-red"}`}>{u.attivo ? "Attivo" : "Cessato"}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
