import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import Header from "@/components/Header";
import { createCourse } from "@/lib/actions";
import { courseStats } from "@/lib/logic";
import { LEVEL_LABELS } from "@/lib/types";

export default async function AdminCoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ creato?: string; eliminato?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "student") redirect("/studente");
  const { creato, eliminato } = await searchParams;

  const db = await getDb();
  const stats = courseStats(db, user);
  const canSystem = user.role === "system_admin" || user.role === "course_manager";

  return (
    <div>
      <Header user={user} active="corsi" />
      <div className="container">
        <h1>Catalogo corsi</h1>
        <p className="subtitle">{stats.length} corsi nel tuo ambito</p>

        {creato && <div className="alert alert-green">✓ Corso creato. Ora puoi aggiungere lezioni e quiz.</div>}
        {eliminato && <div className="alert alert-green">✓ Corso eliminato.</div>}

        <div className="card table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Corso</th><th>Livello</th><th>Destinatari</th><th>Assegnati</th><th>Completati</th><th>Punteggio medio</th><th>Gradimento</th><th></th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => {
                const c = s.course;
                const tenant = db.tenants.find((t) => t.id === c.tenantId);
                const store = db.stores.find((st) => st.id === c.storeId);
                const depts = (c.departments ?? [])
                  .map((d) => db.departments.find((x) => x.id === d)?.name)
                  .filter(Boolean)
                  .join(", ");
                return (
                  <tr key={c.id}>
                    <td>
                      <a href={`/admin/corsi/${c.id}`} style={{ color: "inherit" }}>
                        <strong>{c.emoji} {c.title}</strong>
                      </a>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        {c.category} · {c.lessons.length} lezioni · {c.quiz.length} domande quiz
                        {c.mandatory && " · obbligatorio"}
                      </div>
                    </td>
                    <td>
                      <span className="pill pill-blue">{LEVEL_LABELS[c.level]}</span>
                      {tenant && <div style={{ fontSize: 12, color: "var(--muted)" }}>{tenant.name}</div>}
                      {store && <div style={{ fontSize: 12, color: "var(--muted)" }}>{store.name}</div>}
                    </td>
                    <td style={{ fontSize: 13 }}>
                      {depts || "Tutti i reparti"}
                      {c.onlyNewHires && <div><span className="pill pill-blue">Solo neoassunti</span></div>}
                    </td>
                    <td>{s.enrolled}</td>
                    <td>
                      {s.completed}{" "}
                      <span style={{ color: "var(--muted)", fontSize: 12 }}>
                        ({s.enrolled ? Math.round((s.completed / s.enrolled) * 100) : 0}%)
                      </span>
                    </td>
                    <td>{s.avgScore !== null ? `${s.avgScore}%` : "—"}</td>
                    <td>{s.avgRating !== null ? `⭐ ${s.avgRating}` : "—"}</td>
                    <td>
                      <a className="btn btn-outline btn-sm" href={`/admin/corsi/${c.id}`}>✏️ Modifica</a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="section">
          <div className="section-head">
            <h2>➕ Crea un nuovo corso</h2>
          </div>
          <div className="card" style={{ maxWidth: 640 }}>
            <form action={createCourse}>
              <label className="field">
                Titolo del corso
                <input type="text" name="title" required placeholder="es. Potatura delle rose" />
              </label>
              <label className="field">
                Descrizione
                <textarea name="description" rows={2} placeholder="Di cosa parla il corso?" />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <label className="field">
                  Categoria
                  <input type="text" name="category" placeholder="Prodotto" />
                </label>
                <label className="field">
                  Livello
                  <select name="level" defaultValue={canSystem ? "sistema" : "insegna"}>
                    {canSystem && <option value="sistema">Sistema (tutti)</option>}
                    <option value="insegna">Insegna</option>
                    <option value="punto_vendita">Punto vendita</option>
                  </select>
                </label>
                <label className="field">
                  Reparto (opzionale)
                  <select name="department" defaultValue="">
                    <option value="">Tutti i reparti</option>
                    {db.departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="checkbox-row">
                <input type="checkbox" name="mandatory" /> Corso obbligatorio (scadenza 60 giorni)
              </label>
              <label className="checkbox-row">
                <input type="checkbox" name="newHires" /> Riservato ai neoassunti (ultimi 90 giorni)
              </label>
              <button className="btn" type="submit">Crea corso</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
