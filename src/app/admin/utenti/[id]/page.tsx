import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import Header from "@/components/Header";
import { updateUser, toggleUserActive } from "@/lib/actions";
import { ROLE_LABELS, Role, userSites } from "@/lib/types";
import { coursesForUser, getProgress, isCourseCompleted } from "@/lib/logic";

export default async function EditUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ salvato?: string }>;
}) {
  const admin = await getCurrentUser();
  if (!admin) redirect("/login");
  if (admin.role === "student") redirect("/studente");
  const { id } = await params;
  const { salvato } = await searchParams;

  const db = await getDb();
  const u = db.users.find((x) => x.id === id);
  if (!u) notFound();

  const canEdit =
    admin.role === "system_admin" ||
    (admin.role === "group_admin" && u.tenantId === admin.tenantId) ||
    (admin.role === "store_admin" && u.storeId === admin.storeId);
  if (!canEdit) redirect("/admin/utenti");

  const assignableRoles: Role[] =
    admin.role === "system_admin"
      ? ["system_admin", "group_admin", "store_admin", "dept_head", "course_manager", "student"]
      : admin.role === "group_admin"
        ? ["store_admin", "dept_head", "student"]
        : ["dept_head", "student"];

  const selectableStores =
    admin.role === "system_admin"
      ? db.stores
      : admin.role === "group_admin"
        ? db.stores.filter((s) => s.tenantId === admin.tenantId)
        : db.stores.filter((s) => s.id === admin.storeId);

  const assigned = coursesForUser(db, u);
  const done = assigned.filter((c) => isCourseCompleted(c, getProgress(db, u.id, c.id)));
  const action = updateUser.bind(null, u.id);

  return (
    <div>
      <Header user={admin} active="utenti" />
      <div className="container" style={{ maxWidth: 780 }}>
        <div style={{ marginBottom: 8 }}>
          <Link href="/admin/utenti">← Torna ai collaboratori</Link>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0 }}>✏️ {u.firstName} {u.lastName}</h1>
          {u.active !== false ? <span className="pill pill-green">Attivo</span> : <span className="pill pill-red">Cessato</span>}
          {!u.passwordHash && <span className="pill pill-amber">Account non ancora attivato</span>}
        </div>
        <p className="subtitle" style={{ marginTop: 6 }}>
          {ROLE_LABELS[u.role]} · {done.length}/{assigned.length} corsi completati · {u.points} punti
        </p>

        {salvato && <div className="alert alert-green">✓ Modifiche salvate.</div>}

        <div className="card">
          <form action={action}>
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
                Ruolo
                <select name="role" defaultValue={u.role}>
                  {assignableRoles.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                  {!assignableRoles.includes(u.role) && <option value={u.role}>{ROLE_LABELS[u.role]}</option>}
                </select>
              </label>
              <label className="field">
                Punto vendita
                <select name="storeId" defaultValue={u.storeId ?? ""}>
                  {admin.role === "system_admin" && <option value="">— Nessuno (ruolo di consorzio/insegna) —</option>}
                  {selectableStores.map((s) => {
                    const t = db.tenants.find((x) => x.id === s.tenantId)!;
                    return <option key={s.id} value={s.id}>{t.name} — {s.name}</option>;
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
              <label className="field">
                Data assunzione
                <input type="date" name="hireDate" defaultValue={u.hireDate} />
              </label>
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
              <div style={{ display: "flex", gap: 20, marginTop: 6 }}>
                <label className="checkbox-row" style={{ margin: 0 }}>
                  <input type="checkbox" name="siteAcademy" defaultChecked={userSites(u).includes("academy")} /> 🎓 Academy
                </label>
                <label className="checkbox-row" style={{ margin: 0 }}>
                  <input type="checkbox" name="siteStampe" defaultChecked={userSites(u).includes("stampe")} /> 🖨️ Stampe
                </label>
              </div>
              <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 10px" }}>
                Con una sola macroarea l&apos;utente entra direttamente lì dopo il login; con più di una sceglie dalla pagina iniziale.
              </p>
            </div>
            {(u.birthDate || u.taxCode) && (
              <p style={{ fontSize: 13, color: "var(--muted)" }}>
                Dati da registrazione: {u.birthDate ? `nato/a il ${new Date(u.birthDate).toLocaleDateString("it-IT")}` : ""}{u.birthDate && u.taxCode ? " · " : ""}{u.taxCode ? `CF ${u.taxCode}` : ""}
              </p>
            )}
            <button className="btn" type="submit">💾 Salva collaboratore</button>
          </form>
        </div>

        {u.id !== admin.id && u.role !== "system_admin" && (
          <div className="section">
            <div className="card" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <h3 style={{ margin: 0 }}>{u.active !== false ? "Cessazione" : "Riattivazione"}</h3>
                <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>
                  {u.active !== false
                    ? "Blocca immediatamente l'accesso alla piattaforma (lo storico formativo resta)."
                    : "Ripristina l'accesso alla piattaforma."}
                </p>
              </div>
              <form action={toggleUserActive.bind(null, u.id)}>
                <button className="btn btn-outline" type="submit" style={u.active !== false ? { color: "var(--red)", borderColor: "var(--red)" } : {}}>
                  {u.active !== false ? "🔒 Disattiva accesso" : "🔓 Riattiva accesso"}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
