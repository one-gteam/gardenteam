import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import Header from "@/components/Header";
import RuoliHeader from "@/components/RuoliHeader";
import { updateUser, toggleUserActive, reinviaAccesso } from "@/lib/actions";
import ModuloAutoSalva from "@/components/ModuloAutoSalva";
import { PulsanteAzione } from "@/components/AzioneSenzaRicarica";
import { ROLE_LABELS, userSites, ruoloEsteso, type User } from "@/lib/types";
import { coursesForUser, getProgress, isCourseCompleted, canManageUsers, scopeUsers, assignableRolesFor, livelloGestioneUtenti } from "@/lib/logic";

/**
 * Il dettaglio di una persona: anagrafica, ruolo, collocazione, aree, stato e
 * la mail di accesso. Lo stesso in Utenti e ruoli (area «ruoli», con la sua
 * intestazione) e nei Collaboratori dell'Academy (area «academy»).
 */
export default async function DettaglioUtente({ admin, id, salvato, area }: { admin: User; id: string; salvato?: string; area: "ruoli" | "academy" }) {
  const db = await getDb();
  const u = db.users.find((x) => x.id === id);
  if (!u) notFound();
  const indietro = area === "ruoli" ? "/ruoli" : "/admin/utenti";

  // chi può aprirla: le persone del suo ambito, come nella tabella
  const nelloScope = scopeUsers(db, admin).some((x) => x.id === u.id);
  if (!nelloScope) redirect(indietro);
  const gestore = canManageUsers(db, admin);
  const assignableRoles = assignableRolesFor(admin);
  const livello = livelloGestioneUtenti(db, admin);
  const selectableStores = livello === "consorzio" ? db.stores
    : livello === "insegna" ? db.stores.filter((s) => s.tenantId === admin.tenantId)
    : db.stores.filter((s) => s.id === admin.storeId);

  const assigned = coursesForUser(db, u);
  const done = assigned.filter((c) => isCourseCompleted(c, getProgress(db, u.id, c.id)));
  const action = updateUser.bind(null, u.id);
  const mailAccesso = [...db.emails].reverse().find((e) => e.userId === u.id && ["benvenuto", "benvenuto_gtone", "reimposta"].includes(e.type));
  const quando = (iso: string) => new Date(iso).toLocaleString("it-IT", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });

  return (
    <div>
      {area === "ruoli" ? <RuoliHeader user={admin} active="ruoli" /> : <Header user={admin} active="utenti" />}
      <div className="container" style={{ maxWidth: 780 }}>
        <div style={{ marginBottom: 8 }}>
          <Link href={indietro}>← Torna {area === "ruoli" ? "a Utenti e ruoli" : "ai collaboratori"}</Link>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0 }}>{u.firstName} {u.lastName}</h1>
          {u.active !== false ? <span className="pill pill-green">Attivo</span> : <span className="pill pill-red">Cessato</span>}
          {!u.passwordHash && <span className="pill pill-amber">Account non ancora attivato</span>}
        </div>
        <p className="subtitle" style={{ marginTop: 6 }}>
          {ruoloEsteso(u)}{(u.ruoliExtra ?? []).length > 0 && <> · anche {(u.ruoliExtra ?? []).map((p) => ruoloEsteso({ ...u, role: p.role, manages: p.manages })).join(", ")}</>}
          {userSites(u).includes("academy") && <> · {done.length}/{assigned.length} corsi completati · {u.points} punti</>}
        </p>
        {area === "academy" && gestore && u.id !== admin.id && (
          <p className="hint" style={{ margin: "-6px 0 16px" }}>
            Ruoli e aree si gestiscono anche in <a href={`/ruoli/utenti/${u.id}`}>Utenti e ruoli</a>.
          </p>
        )}

        {salvato && <div className="alert alert-green">✓ Modifiche salvate.</div>}

        <div className="card">
          <ModuloAutoSalva azione={action}>
            <fieldset disabled={!gestore} style={{ border: "none", padding: 0, margin: 0 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label className="field">Nome<input type="text" name="firstName" defaultValue={u.firstName} required /></label>
                <label className="field">Cognome<input type="text" name="lastName" defaultValue={u.lastName} required /></label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label className="field">Email<input type="email" name="email" defaultValue={u.email} required /></label>
                <label className="field">Mansione<input type="text" name="jobTitle" defaultValue={u.jobTitle ?? ""} /></label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
                <label className="field">
                  Ruolo principale
                  <select name="role" defaultValue={u.role}>
                    {assignableRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    {!assignableRoles.includes(u.role) && <option value={u.role}>{ruoloEsteso(u)}</option>}
                  </select>
                </label>
                <label className="field">
                  Punto vendita
                  <select name="storeId" defaultValue={u.storeId ?? ""}>
                    {admin.role === "system_admin" && <option value="">— Nessuno (ruolo di consorzio/insegna) —</option>}
                    {selectableStores.map((s) => {
                      const t = db.tenants.find((x) => x.id === s.tenantId);
                      return <option key={s.id} value={s.id}>{t?.name ?? "?"} — {s.name}</option>;
                    })}
                  </select>
                </label>
                {admin.role === "system_admin" && (
                  <label className="field">
                    Insegna (se senza PV)
                    <select name="tenantId" defaultValue={u.tenantId ?? ""}>
                      <option value="">— Consorzio —</option>
                      {db.tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </label>
                )}
                <label className="field">
                  Reparto
                  <select name="departmentId" defaultValue={u.departmentId ?? ""}>
                    <option value="">— Nessuno —</option>
                    {db.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </label>
                <label className="field">Data assunzione<input type="date" name="hireDate" defaultValue={u.hireDate} /></label>
                <label className="field">
                  Genere (per i testi email)
                  <select name="gender" defaultValue={u.gender ?? ""}>
                    <option value="">Non specificato</option>
                    <option value="m">Maschile</option>
                    <option value="f">Femminile</option>
                  </select>
                </label>
              </div>
              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 4 }}>
                <strong style={{ fontSize: 14 }}>Macroaree accessibili</strong>
                <input type="hidden" name="sitesForm" value="1" />
                <div style={{ display: "flex", gap: 20, marginTop: 6, flexWrap: "wrap" }}>
                  <label className="checkbox-row" style={{ margin: 0 }}><input type="checkbox" name="siteAcademy" defaultChecked={userSites(u).includes("academy")} /> Academy</label>
                  <label className="checkbox-row" style={{ margin: 0 }}><input type="checkbox" name="siteArredo" defaultChecked={userSites(u).includes("arredo")} /> Cartelli Arredo</label>
                  <label className="checkbox-row" style={{ margin: 0 }}><input type="checkbox" name="siteZoo" defaultChecked={userSites(u).includes("zoo")} /> Offerte Zoo</label>
                  <label className="checkbox-row" style={{ margin: 0 }}><input type="checkbox" name="sitePiante" defaultChecked={userSites(u).includes("piante")} /> Cartelli Piante</label>
                </div>
                <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 10px" }}>
                  Con una sola macroarea l&apos;utente entra direttamente lì dopo il login; con più di una sceglie dalla pagina iniziale.
                  {area === "ruoli" && " Gli altri ruoli si aggiungono dalla tabella di Utenti e ruoli, colonna «Altri ruoli»."}
                </p>
              </div>
              {(u.birthDate || u.taxCode) && (
                <p style={{ fontSize: 13, color: "var(--muted)" }}>
                  Dati da registrazione: {u.birthDate ? `nato/a il ${new Date(u.birthDate).toLocaleDateString("it-IT")}` : ""}{u.birthDate && u.taxCode ? " · " : ""}{u.taxCode ? `CF ${u.taxCode}` : ""}
                </p>
              )}
            </fieldset>
          </ModuloAutoSalva>
        </div>

        {gestore && u.id !== admin.id && u.active !== false && (
          <div className="section">
            <div className="card" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <h3 style={{ margin: 0 }}>Mail di accesso</h3>
                <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>
                  {u.passwordHash
                    ? "Manda a questa persona una mail con l'indirizzo per entrare e il link per reimpostare la password (vale 24 ore)."
                    : "L'account non è ancora attivato: rimanda la mail di benvenuto con il link per scegliere la password (vale 7 giorni)."}
                  {mailAccesso && <><br />Ultima mail di accesso: {quando(mailAccesso.date)} a {mailAccesso.to}{mailAccesso.status === "errore" ? " (non consegnata)" : ""}.</>}
                </p>
              </div>
              <PulsanteAzione azione={reinviaAccesso.bind(null, u.id)} className="btn btn-outline" conferma={`Mandare la mail di accesso a ${u.email}?`}>
                {u.passwordHash ? "Manda mail di accesso" : "Rimanda mail di registrazione"}
              </PulsanteAzione>
            </div>
          </div>
        )}

        {gestore && u.id !== admin.id && u.role !== "system_admin" && (
          <div className="section">
            <div className="card" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <h3 style={{ margin: 0 }}>{u.active !== false ? "Cessazione" : "Riattivazione"}</h3>
                <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>
                  {u.active !== false ? "Blocca immediatamente l'accesso alla piattaforma (lo storico formativo resta)." : "Ripristina l'accesso alla piattaforma."}
                </p>
              </div>
              <PulsanteAzione azione={toggleUserActive.bind(null, u.id)} className="btn btn-outline"
                style={u.active !== false ? { color: "var(--red)", borderColor: "var(--red)" } : {}}
                conferma={u.active !== false ? `Bloccare l'accesso di ${u.firstName} ${u.lastName}?` : undefined}>
                {u.active !== false ? "Disattiva accesso" : "Riattiva accesso"}
              </PulsanteAzione>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
