import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import Header from "@/components/Header";
import { importUsersCsv, toggleUserActive, approveRegistration, rejectRegistration } from "@/lib/actions";
import { scopeUsers, coursesForUser, getProgress, isCourseCompleted, isNewHire } from "@/lib/logic";
import { ROLE_LABELS } from "@/lib/types";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    import?: string;
    approvato?: string;
    rifiutato?: string;
    q?: string;
    insegna?: string;
    pv?: string;
    reparto?: string;
    gruppo?: string;
    da?: string;
    a?: string;
    minPunti?: string;
    minCompletati?: string;
    stato?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "student") redirect("/studente");
  const sp = await searchParams;
  const { import: imported, approvato, rifiutato } = sp;

  const db = await getDb();
  const allUsers = scopeUsers(db, user).sort((a, b) => a.lastName.localeCompare(b.lastName));

  // ---------- filtri ----------
  const q = (sp.q ?? "").trim().toLowerCase();
  const minPunti = Number(sp.minPunti) || 0;
  const minCompletati = Number(sp.minCompletati) || 0;
  const completedCount = (u: (typeof allUsers)[number]) =>
    coursesForUser(db, u).filter((c) => isCourseCompleted(c, getProgress(db, u.id, c.id))).length;
  const users = allUsers.filter((u) => {
    if (q && !(`${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(q))) return false;
    if (sp.insegna && u.tenantId !== sp.insegna) return false;
    if (sp.pv && u.storeId !== sp.pv) return false;
    if (sp.reparto && u.departmentId !== sp.reparto) return false;
    if (sp.gruppo && !u.groupIds?.includes(sp.gruppo)) return false;
    if (sp.da && u.hireDate < sp.da) return false;
    if (sp.a && u.hireDate > sp.a) return false;
    if (sp.stato === "attivi" && u.active === false) return false;
    if (sp.stato === "cessati" && u.active !== false) return false;
    if (minPunti > 0 && u.points < minPunti) return false;
    if (minCompletati > 0 && completedCount(u) < minCompletati) return false;
    return true;
  });
  const hasFilters = !!(q || sp.insegna || sp.pv || sp.reparto || sp.gruppo || sp.da || sp.a || sp.stato || minPunti || minCompletati);

  const filterStores =
    user.role === "system_admin"
      ? db.stores.filter((s) => !sp.insegna || s.tenantId === sp.insegna)
      : user.role === "group_admin"
        ? db.stores.filter((s) => s.tenantId === user.tenantId)
        : db.stores.filter((s) => s.id === user.storeId);

  const canImport = ["system_admin", "group_admin", "store_admin"].includes(user.role);
  const pending = db.registrations.filter((r) => {
    if (r.status !== "pending") return false;
    if (user.role === "system_admin") return true;
    if (user.role === "group_admin") return r.tenantId === user.tenantId;
    if (user.role === "store_admin") return r.storeId === user.storeId;
    return false;
  });

  return (
    <div>
      <Header user={user} active="utenti" />
      <div className="container">
        <h1>Collaboratori</h1>
        <p className="subtitle">
          {hasFilters ? `${users.length} risultati su ${allUsers.length} persone` : `${allUsers.length} persone nel tuo ambito di gestione`}
        </p>

        <div className="card" style={{ marginBottom: 20 }}>
          <form method="get" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, alignItems: "end" }}>
            <label className="field" style={{ marginBottom: 0 }}>
              Cerca (nome, email)
              <input type="text" name="q" defaultValue={sp.q ?? ""} placeholder="es. Rossi" />
            </label>
            {user.role === "system_admin" && (
              <label className="field" style={{ marginBottom: 0 }}>
                Insegna
                <select name="insegna" defaultValue={sp.insegna ?? ""}>
                  <option value="">Tutte</option>
                  {db.tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            )}
            {user.role !== "store_admin" && (
              <label className="field" style={{ marginBottom: 0 }}>
                Punto vendita
                <select name="pv" defaultValue={sp.pv ?? ""}>
                  <option value="">Tutti</option>
                  {filterStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}
            <label className="field" style={{ marginBottom: 0 }}>
              Reparto
              <select name="reparto" defaultValue={sp.reparto ?? ""}>
                <option value="">Tutti</option>
                {db.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              Gruppo
              <select name="gruppo" defaultValue={sp.gruppo ?? ""}>
                <option value="">Tutti</option>
                {db.groups.map((g) => <option key={g.id} value={g.id}>{g.emoji} {g.name}</option>)}
              </select>
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              Assunti dal
              <input type="date" name="da" defaultValue={sp.da ?? ""} />
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              Assunti fino al
              <input type="date" name="a" defaultValue={sp.a ?? ""} />
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              Corsi completati (min)
              <input type="text" name="minCompletati" defaultValue={sp.minCompletati ?? ""} placeholder="es. 2" />
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              Punti (min)
              <input type="text" name="minPunti" defaultValue={sp.minPunti ?? ""} placeholder="es. 100" />
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              Stato
              <select name="stato" defaultValue={sp.stato ?? ""}>
                <option value="">Tutti</option>
                <option value="attivi">Solo attivi</option>
                <option value="cessati">Solo cessati</option>
              </select>
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-sm" type="submit">🔍 Filtra</button>
              {hasFilters && <a className="btn btn-outline btn-sm" href="/admin/utenti">Azzera</a>}
            </div>
          </form>
        </div>

        {imported !== undefined && Number(imported) > 0 && (
          <div className="alert alert-green">✓ Importati <strong>{imported}</strong> nuovi collaboratori.</div>
        )}
        {imported === "0" && (
          <div className="alert alert-amber">Nessun collaboratore importato: controlla il formato del CSV.</div>
        )}
        {approvato && <div className="alert alert-green">✓ Richiesta approvata: il collaboratore è stato creato e ha ricevuto l&apos;email di benvenuto.</div>}
        {rifiutato && <div className="alert alert-amber">Richiesta rifiutata.</div>}

        {pending.length > 0 && (
          <div className="card" style={{ marginBottom: 20, borderColor: "var(--amber)" }}>
            <h2>🔔 Richieste di registrazione in attesa ({pending.length})</h2>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Richiedente</th><th>Punto vendita</th><th>Dati</th><th>Reparto</th><th></th></tr>
                </thead>
                <tbody>
                  {pending.map((r) => {
                    const store = db.stores.find((s) => s.id === r.storeId);
                    const approve = approveRegistration.bind(null, r.id);
                    const reject = rejectRegistration.bind(null, r.id);
                    return (
                      <tr key={r.id}>
                        <td>
                          <strong>{r.lastName} {r.firstName}</strong>
                          <div style={{ fontSize: 12, color: "var(--muted)" }}>{r.email}</div>
                        </td>
                        <td>{store?.name}</td>
                        <td style={{ fontSize: 12.5 }}>
                          {r.birthDate ? `Nato/a ${new Date(r.birthDate).toLocaleDateString("it-IT")}` : "—"}
                          <div style={{ color: "var(--muted)" }}>{r.taxCode || ""}</div>
                        </td>
                        <td>
                          <form action={approve} id={`approve_${r.id}`}>
                            <select name="departmentId" defaultValue={r.departmentId ?? ""}>
                              <option value="">— Reparto —</option>
                              {db.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                          </form>
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button className="btn btn-sm" type="submit" form={`approve_${r.id}`}>✓ Approva</button>{" "}
                          <form action={reject} style={{ display: "inline" }}>
                            <button className="btn btn-outline btn-sm" type="submit" style={{ color: "var(--red)", borderColor: "var(--red)" }}>Rifiuta</button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "8px 0 0" }}>
              All&apos;approvazione il collaboratore viene creato come studente neoassunto: i percorsi (es. Onboarding) si assegnano automaticamente.
            </p>
          </div>
        )}

        <div className="card table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Nome</th><th>Ruolo</th><th>Insegna / PV</th><th>Reparto</th><th>Assunzione</th><th>Formazione</th><th>Punti</th><th>Stato</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const tenant = db.tenants.find((t) => t.id === u.tenantId);
                const store = db.stores.find((s) => s.id === u.storeId);
                const dept = db.departments.find((d) => d.id === u.departmentId);
                const assigned = coursesForUser(db, u);
                const done = assigned.filter((c) => isCourseCompleted(c, getProgress(db, u.id, c.id))).length;
                const pct = assigned.length ? Math.round((done / assigned.length) * 100) : 0;
                return (
                  <tr key={u.id}>
                    <td>
                      <a href={`/admin/utenti/${u.id}`} style={{ color: "inherit" }}>
                        <strong>{u.lastName} {u.firstName}</strong>
                      </a>
                      {isNewHire(u) && <span className="pill pill-blue" style={{ marginLeft: 6 }}>Neoassunto</span>}
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>{u.email}</div>
                    </td>
                    <td>{ROLE_LABELS[u.role]}</td>
                    <td>
                      {tenant ? `${tenant.emoji} ${tenant.name}` : "Consorzio"}
                      {store && <div style={{ fontSize: 12, color: "var(--muted)" }}>{store.name}</div>}
                    </td>
                    <td>{dept ? `${dept.emoji} ${dept.name}` : "—"}</td>
                    <td>{new Date(u.hireDate).toLocaleDateString("it-IT")}</td>
                    <td style={{ minWidth: 130 }}>
                      <div className="progress-track" style={{ width: 90, display: "inline-block", verticalAlign: "middle" }}>
                        <div className="progress-fill" style={{ width: `${pct}%` }} />
                      </div>{" "}
                      <span style={{ fontSize: 12.5 }}>{done}/{assigned.length}</span>
                    </td>
                    <td><span className="pill pill-amber">{u.points}</span></td>
                    <td>
                      {u.active !== false ? (
                        <span className="pill pill-green">Attivo</span>
                      ) : (
                        <span className="pill pill-red">Cessato</span>
                      )}
                      {u.id !== user.id && u.role !== "system_admin" && (
                        <form action={toggleUserActive.bind(null, u.id)} style={{ display: "inline", marginLeft: 6 }}>
                          <button
                            className="btn btn-outline btn-sm"
                            type="submit"
                            title={u.active !== false ? "Blocca l'accesso (cessazione)" : "Riattiva l'accesso"}
                          >
                            {u.active !== false ? "Disattiva" : "Riattiva"}
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {canImport && (
          <div className="section">
            <div className="section-head">
              <h2>📥 Importazione massiva da CSV</h2>
              <span className="hint">una riga per collaboratore</span>
            </div>
            <div className="card">
              <p style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 0 }}>
                Formato: <code>Nome; Cognome; Email; Reparto; Mansione; Data assunzione (AAAA-MM-GG); Genere (M/F)</code>.
                I nuovi utenti vengono creati come studenti {user.storeId ? "nel tuo punto vendita" : user.tenantId ? "nella tua insegna" : "nella prima insegna disponibile"}.
                In produzione: caricamento file Excel/CSV e sincronizzazione automatica dal gestionale HR via API.
              </p>
              <form action={importUsersCsv}>
                <textarea
                  name="csv"
                  rows={5}
                  placeholder={"Mario; Bruni; m.bruni@verdevivo.it; Piante & Fiori; Addetto vendita; 2026-07-01\nLucia; Ferri; l.ferri@verdevivo.it; Casse; Cassiera; 2026-06-15"}
                  style={{ fontFamily: "Consolas, monospace", fontSize: 13 }}
                />
                <div style={{ marginTop: 10 }}>
                  <button className="btn" type="submit">Importa collaboratori</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
