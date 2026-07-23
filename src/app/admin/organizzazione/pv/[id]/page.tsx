import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import Header from "@/components/Header";
import { updateStore } from "@/lib/actions";
import { ROLE_LABELS } from "@/lib/types";

export default async function StorePage({
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

  const db = await getDb();
  const s = db.stores.find((x) => x.id === id);
  if (!s) notFound();
  const t = db.tenants.find((x) => x.id === s.tenantId)!;
  const canEdit =
    user.role === "system_admin" ||
    (user.role === "group_admin" && user.tenantId === s.tenantId) ||
    (user.role === "store_admin" && user.storeId === id);
  if (!canEdit) redirect("/admin");

  const storeUsers = db.users.filter((u) => u.storeId === id);
  const staff = storeUsers.length;
  const privileged = storeUsers.filter((u) => u.role !== "student");
  const students = storeUsers.filter((u) => u.role === "student");
  const action = updateStore.bind(null, id);

  return (
    <div>
      <Header user={user} active="organizzazione" />
      <div className="container" style={{ maxWidth: 780 }}>
        <div style={{ marginBottom: 8 }}>
          <Link href="/admin/organizzazione">← Torna all&apos;organizzazione</Link>
        </div>
        <h1>{t.emoji} {s.name}</h1>
        <p className="subtitle" style={{ marginTop: 6 }}>
          {t.name}{s.city ? ` · ${s.city}` : ""} · {staff} collaboratori
        </p>

        {salvato && <div className="alert alert-green">✓ Modifiche salvate.</div>}

        <div className="card">
          <h2>Personalizzazione punto vendita</h2>
          <form action={action}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
              <label className="field">
                Nome punto vendita
                <input type="text" name="name" defaultValue={s.name} required />
              </label>
              <label className="field">
                Città
                <input type="text" name="city" defaultValue={s.city} placeholder="es. Rosà (VI)" />
              </label>
            </div>
            <label className="field">
              Messaggio di benvenuto per gli studenti del punto vendita
              <textarea name="welcome" rows={2} defaultValue={s.welcome ?? ""} placeholder="Compare in evidenza nella home degli studenti di questo negozio" />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label className="field">
                🔑 Parola segreta per l&apos;auto-registrazione
                <input type="text" name="secretWord" defaultValue={s.secretWord ?? ""} placeholder={t.secretWord ? `vuota = usa quella di insegna (${t.secretWord})` : "es. negozio2026"} />
              </label>
              <label className="field">
                ✉️ Email che riceve le richieste di registrazione
                <input type="email" name="approvalEmail" defaultValue={s.approvalEmail ?? ""} placeholder={t.approvalEmail ? `vuota = usa ${t.approvalEmail}` : "es. negozio@insegna.it"} />
              </label>
            </div>
            <button className="btn" type="submit">💾 Salva punto vendita</button>
          </form>
        </div>

        <div className="section">
          <div className="section-head"><h2>🔑 Utenti con privilegi ({privileged.length})</h2></div>
          <div className="card table-wrap">
            <table className="data">
              <thead><tr><th>Nome</th><th>Ruolo</th><th>Stato</th></tr></thead>
              <tbody>
                {privileged.length === 0 && <tr><td colSpan={3} className="empty">Nessun utente con privilegi in questo punto vendita.</td></tr>}
                {privileged.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <a href={`/admin/utenti/${u.id}`} style={{ color: "inherit" }}><strong>{u.lastName} {u.firstName}</strong></a>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>{u.email}</div>
                    </td>
                    <td>{ROLE_LABELS[u.role]}</td>
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
              <thead><tr><th>Nome</th><th>Reparto</th><th>Punti</th><th>Stato</th></tr></thead>
              <tbody>
                {students.length === 0 && <tr><td colSpan={4} className="empty">Nessuno studente in questo punto vendita.</td></tr>}
                {students.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <a href={`/admin/utenti/${u.id}`} style={{ color: "inherit" }}><strong>{u.lastName} {u.firstName}</strong></a>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>{u.email}</div>
                    </td>
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
