import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import Header from "@/components/Header";
import { updateTenant } from "@/lib/actions";
import { ROLE_LABELS } from "@/lib/types";

export default async function TenantPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ salvato?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const { salvato } = await searchParams;
  const canEdit = user.role === "system_admin" || (user.role === "group_admin" && user.tenantId === id);
  if (!canEdit) redirect("/admin");

  const db = await getDb();
  const t = db.tenants.find((x) => x.id === id);
  if (!t) notFound();
  const stores = db.stores.filter((s) => s.tenantId === id);
  const action = updateTenant.bind(null, id);
  const tenantUsers = db.users.filter((u) => u.tenantId === id);
  const privileged = tenantUsers.filter((u) => u.role !== "student");
  const students = tenantUsers.filter((u) => u.role === "student");

  return (
    <div>
      <Header user={user} active="organizzazione" />
      <div className="container" style={{ maxWidth: 780 }}>
        <div style={{ marginBottom: 8 }}>
          <Link href="/admin/organizzazione">← Torna all&apos;organizzazione</Link>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {t.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={t.logoUrl} alt={t.name} style={{ height: 48, maxWidth: 150, objectFit: "contain" }} />
          ) : (
            <span style={{ fontSize: 38 }}>{t.emoji}</span>
          )}
          <h1 style={{ margin: 0 }}>{t.name}</h1>
        </div>
        <p className="subtitle" style={{ marginTop: 6 }}>
          {stores.length} punti vendita: {stores.map((s) => s.name).join(", ")}
        </p>

        {salvato && <div className="alert alert-green">✓ Modifiche salvate.</div>}

        <div className="card">
          <h2>Personalizzazione insegna</h2>
          <form action={action}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 110px", gap: 12 }}>
              <label className="field">
                Nome insegna
                <input type="text" name="name" defaultValue={t.name} required />
              </label>
              <label className="field">
                Colore
                <input type="color" name="color" defaultValue={t.color} style={{ width: "100%", height: 40, padding: 2, border: "1.5px solid var(--line)", borderRadius: 9 }} />
              </label>
              <label className="field">
                Emoji
                <input type="text" name="emoji" defaultValue={t.emoji} maxLength={4} />
              </label>
            </div>
            <label className="field">
              Logo (PNG/JPG/SVG — sostituisce l&apos;emoji nel portale)
              <input type="file" name="logo" accept="image/*" style={{ marginTop: 4 }} />
            </label>
            <label className="field">
              Messaggio di benvenuto per gli studenti dell&apos;insegna
              <textarea name="welcome" rows={2} defaultValue={t.welcome ?? ""} placeholder="Compare in evidenza nella home degli studenti della tua insegna" />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label className="field">
                🔑 Parola segreta per l&apos;auto-registrazione
                <input type="text" name="secretWord" defaultValue={t.secretWord ?? ""} placeholder="es. rosa2026 — da comunicare ai collaboratori" />
              </label>
              <label className="field">
                ✉️ Email che riceve le richieste di registrazione
                <input type="email" name="approvalEmail" defaultValue={t.approvalEmail ?? ""} placeholder="es. formazione@insegna.it" />
              </label>
            </div>
            <button className="btn" type="submit">💾 Salva insegna</button>
          </form>
        </div>

        <div className="section">
          <div className="section-head"><h2>📍 Punti vendita dell&apos;insegna</h2></div>
          <div className="grid grid-3">
            {stores.map((s) => (
              <a key={s.id} className="card card-link" href={`/admin/organizzazione/pv/${s.id}`}>
                <strong>{s.name}</strong>
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{s.city || "—"}</div>
              </a>
            ))}
          </div>
        </div>

        <div className="section">
          <div className="section-head"><h2>🔑 Utenti con privilegi ({privileged.length})</h2></div>
          <div className="card table-wrap">
            <table className="data">
              <thead><tr><th>Nome</th><th>Ruolo</th><th>Punto vendita</th><th>Stato</th></tr></thead>
              <tbody>
                {privileged.length === 0 && <tr><td colSpan={4} className="empty">Nessun utente con privilegi in questa insegna.</td></tr>}
                {privileged.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <a href={`/admin/utenti/${u.id}`} style={{ color: "inherit" }}><strong>{u.lastName} {u.firstName}</strong></a>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>{u.email}</div>
                    </td>
                    <td>{ROLE_LABELS[u.role]}</td>
                    <td>{db.stores.find((s) => s.id === u.storeId)?.name ?? "Tutta l'insegna"}</td>
                    <td>{u.active !== false ? <span className="pill pill-green">Attivo</span> : <span className="pill pill-red">Cessato</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="section">
          <div className="section-head"><h2>🎓 Studenti ({students.length})</h2></div>
          <div className="card table-wrap">
            <table className="data">
              <thead><tr><th>Nome</th><th>Punto vendita</th><th>Reparto</th><th>Punti</th><th>Stato</th></tr></thead>
              <tbody>
                {students.length === 0 && <tr><td colSpan={5} className="empty">Nessuno studente in questa insegna.</td></tr>}
                {students.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <a href={`/admin/utenti/${u.id}`} style={{ color: "inherit" }}><strong>{u.lastName} {u.firstName}</strong></a>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>{u.email}</div>
                    </td>
                    <td>{db.stores.find((s) => s.id === u.storeId)?.name ?? "—"}</td>
                    <td>{db.departments.find((d) => d.id === u.departmentId)?.name ?? "—"}</td>
                    <td><span className="pill pill-amber">{u.points}</span></td>
                    <td>{u.active !== false ? <span className="pill pill-green">Attivo</span> : <span className="pill pill-red">Cessato</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
