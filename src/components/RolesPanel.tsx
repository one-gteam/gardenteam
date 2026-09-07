"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type MouseEvent, type ReactNode } from "react";
import { deleteUsers, quickSetRole, quickSetSites, quickToggleActive, setTenantUserDelegation } from "@/lib/actions";
import { ROLE_LABELS, Role, SITE_LABELS, SiteId } from "@/lib/types";

const SITES: SiteId[] = ["academy", "arredo", "zoo", "piante"];
const COLUMN_ORDER_KEY = "agt_ruoli_col_order";

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

interface Column {
  key: string;
  label: string;
  cell: (u: RowUser) => ReactNode;
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastIndex, setLastIndex] = useState<number | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);

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

  // ---------- colonne, riordinabili trascinando l'intestazione ----------
  const baseColumns = useMemo<Column[]>(() => {
    const cols: Column[] = [
      {
        key: "nome",
        label: "Collaboratore",
        cell: (u) => (
          <a href={`/admin/utenti/${u.id}`} style={{ color: "inherit" }}>
            <strong>{u.nome}</strong>
          </a>
        ),
      },
    ];
    if (showInsegna) cols.push({ key: "insegna", label: "Insegna", cell: (u) => u.insegna });
    cols.push(
      { key: "pv", label: "Punto vendita", cell: (u) => u.pv },
      {
        key: "ruolo",
        label: "Ruolo",
        cell: (u) =>
          u.editabile && assignableRoles.includes(u.ruolo) ? (
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
          ),
      },
      {
        key: "aree",
        label: "Aree",
        cell: (u) => (
          <span style={{ whiteSpace: "nowrap" }}>
            {SITES.map((site) => (
              <label key={site} style={{ fontSize: 12.5, display: "inline-flex", gap: 4, alignItems: "center", marginRight: 10 }}>
                <input
                  type="checkbox"
                  checked={u.sites.includes(site)}
                  disabled={!u.editabile || pending}
                  onChange={() => toggleSite(u, site)}
                />
                {SITE_LABELS[site]}
              </label>
            ))}
          </span>
        ),
      },
      {
        key: "stato",
        label: "Stato",
        cell: (u) =>
          u.editabile ? (
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
          ),
      }
    );
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInsegna, assignableRoles, pending]);

  const [order, setOrder] = useState<string[]>(baseColumns.map((c) => c.key));

  // carica l'ordine salvato (per browser, non sincronizzato tra dispositivi) e lo riconcilia
  // con le colonne effettivamente disponibili ora (es. "insegna" compare solo per il Consorzio)
  useEffect(() => {
    let saved: string[] = [];
    try {
      saved = JSON.parse(localStorage.getItem(COLUMN_ORDER_KEY) ?? "[]");
    } catch {
      saved = [];
    }
    const known = baseColumns.map((c) => c.key);
    const reconciled = [...saved.filter((k) => known.includes(k)), ...known.filter((k) => !saved.includes(k))];
    setOrder(reconciled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInsegna]);

  const columns = order.map((k) => baseColumns.find((c) => c.key === k)).filter((c): c is Column => !!c);

  const moveColumn = (fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    setOrder((prev) => {
      const next = prev.filter((k) => k !== fromKey);
      const toIndex = next.indexOf(toKey);
      next.splice(toIndex, 0, fromKey);
      try {
        localStorage.setItem(COLUMN_ORDER_KEY, JSON.stringify(next));
      } catch {
        // storage non disponibile (privata/bloccata): l'ordine resta solo per questa sessione
      }
      return next;
    });
  };

  // ---------- selezione righe, con estensione a intervallo tenendo Maiusc ----------
  const selectableRows = users.filter((u) => u.editabile);
  const allSelected = selectableRows.length > 0 && selectableRows.every((u) => selected.has(u.id));

  const handleRowCheck = (e: MouseEvent<HTMLInputElement>, id: string, index: number) => {
    const checked = (e.target as HTMLInputElement).checked;
    setSelected((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && lastIndex !== null) {
        const [from, to] = lastIndex < index ? [lastIndex, index] : [index, lastIndex];
        for (let i = from; i <= to; i++) {
          const row = users[i];
          if (!row.editabile) continue;
          if (checked) next.add(row.id);
          else next.delete(row.id);
        }
      } else if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
    setLastIndex(index);
  };

  const toggleAll = () => {
    setSelected((prev) => {
      if (allSelected) return new Set();
      return new Set(selectableRows.map((u) => u.id));
    });
  };

  const handleDelete = () => {
    if (selected.size === 0) return;
    const nomi = users.filter((u) => selected.has(u.id)).map((u) => u.nome);
    const conferma = window.confirm(
      `Cancellare definitivamente ${selected.size} ${selected.size === 1 ? "utente" : "utenti"}?\n\n${nomi.join(", ")}\n\n` +
        "Corsi, progressi e certificati collegati vengono rimossi. L'operazione non è reversibile — se vuoi solo bloccare " +
        "l'accesso, usa \"Cessato\" invece di cancellare."
    );
    if (!conferma) return;
    run(async () => {
      const res = await deleteUsers([...selected]);
      if (res.ok) setSelected(new Set());
      return res;
    });
  };

  return (
    <div>
      {deleghe.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ marginBottom: 4 }}>Chi gestisce gli utenti dei punti vendita?</h2>
          <p className="hint" style={{ margin: "0 0 12px" }}>
            Ogni insegna sceglie tra due modalità. <strong>Anche i punti vendita</strong>: l&apos;amministratore
            di ciascun punto vendita crea, modifica e disattiva da solo gli utenti del proprio negozio.{" "}
            <strong>Solo l&apos;insegna</strong>: i punti vendita vedono i propri utenti in sola lettura e ogni
            modifica passa dall&apos;amministratore di insegna. Si può cambiare in qualsiasi momento.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {deleghe.map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <strong style={{ minWidth: 160 }}>{t.nome}</strong>
                <label style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 13.5 }}>
                  <input
                    type="radio"
                    name={`delega_${t.id}`}
                    checked={t.delegata}
                    disabled={pending}
                    onChange={() => run(() => setTenantUserDelegation(t.id, true))}
                  />
                  Anche i punti vendita
                </label>
                <label style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 13.5 }}>
                  <input
                    type="radio"
                    name={`delega_${t.id}`}
                    checked={!t.delegata}
                    disabled={pending}
                    onChange={() => run(() => setTenantUserDelegation(t.id, false))}
                  />
                  Solo l&apos;insegna
                </label>
                <span className={`pill ${t.delegata ? "pill-green" : "pill-amber"}`}>
                  {t.delegata ? "PV autonomi" : "centralizzata"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {errore && <div className="alert alert-amber">{errore}</div>}

      {selected.size > 0 && (
        <div className="card" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 12, padding: "10px 14px" }}>
          <strong>{selected.size} {selected.size === 1 ? "selezionato" : "selezionati"}</strong>
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => setSelected(new Set())}>
            Deseleziona
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={pending}
            onClick={handleDelete}
            style={{ color: "var(--red)", borderColor: "var(--red)", marginLeft: "auto" }}
          >
            Cancella definitivamente
          </button>
        </div>
      )}

      <p className="hint" style={{ margin: "0 0 8px" }}>
        Clic su una casella e poi Maiusc+clic su un&apos;altra per selezionare un intervallo. Trascina l&apos;intestazione di una colonna per riordinarla.
      </p>

      <div className="card table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  disabled={selectableRows.length === 0}
                  onChange={toggleAll}
                  title="Seleziona tutti"
                />
              </th>
              {columns.map((c) => (
                <th
                  key={c.key}
                  draggable
                  onDragStart={() => setDragKey(c.key)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragKey) moveColumn(dragKey, c.key);
                    setDragKey(null);
                  }}
                  onDragEnd={() => setDragKey(null)}
                  style={{ cursor: "grab", userSelect: "none", opacity: dragKey === c.key ? 0.4 : 1 }}
                  title="Trascina per riordinare"
                >
                  ⠿ {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u, index) => (
              <tr key={u.id} style={{ opacity: u.attivo ? 1 : 0.55 }}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(u.id)}
                    disabled={!u.editabile}
                    onClick={(e) => handleRowCheck(e, u.id, index)}
                    onChange={() => {}}
                  />
                </td>
                {columns.map((c) => (
                  <td key={c.key}>{c.cell(u)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
