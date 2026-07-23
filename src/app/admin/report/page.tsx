import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import Header from "@/components/Header";
import InsegnaLogo from "@/components/InsegnaLogo";
import { courseStats, scopeUsers, storeRanking, coursesForUser, getProgress, isCourseCompleted } from "@/lib/logic";

export default async function ReportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "student") redirect("/studente");

  const db = await getDb();
  const users = scopeUsers(db, user);
  const userIds = new Set(users.map((u) => u.id));
  const stats = courseStats(db, user).filter((s) => s.enrolled > 0);
  const ranking = storeRanking(db).filter(
    (r) =>
      user.role === "system_admin" ||
      user.role === "course_manager" ||
      (user.role === "group_admin" && r.tenant.id === user.tenantId) ||
      r.store.id === user.storeId
  );

  const mostViewed = [...stats].sort((a, b) => b.completed + b.inProgress - (a.completed + a.inProgress)).slice(0, 6);
  const bestRated = stats.filter((s) => s.avgRating !== null).sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0));

  // Studenti in ritardo sui corsi obbligatori
  const late = users
    .filter((u) => u.role === "student" || u.role === "dept_head")
    .map((u) => {
      const mand = coursesForUser(db, u).filter((c) => c.mandatory);
      const missing = mand.filter((c) => !isCourseCompleted(c, getProgress(db, u.id, c.id)));
      return { u, missing };
    })
    .filter((x) => x.missing.length > 0)
    .sort((a, b) => b.missing.length - a.missing.length);

  const totalCerts = db.certificates.filter((c) => userIds.has(c.userId)).length;
  const avgRatingAll = db.feedback.filter((f) => userIds.has(f.userId));

  return (
    <div>
      <Header user={user} active="report" />
      <div className="container">
        <h1>Report e analytics</h1>
        <p className="subtitle">
          Andamento della formazione nel tuo ambito — in produzione: report builder personalizzato, export Excel/CSV e invio schedulato via email.
        </p>

        <div className="grid grid-4">
          <div className="card stat"><div className="num">{totalCerts}</div><div className="lbl">Certificati emessi</div></div>
          <div className="card stat"><div className="num">{late.length}</div><div className="lbl">Studenti con obblighi aperti</div></div>
          <div className="card stat">
            <div className="num">
              {avgRatingAll.length
                ? (avgRatingAll.reduce((a, f) => a + f.rating, 0) / avgRatingAll.length).toFixed(1)
                : "—"}
            </div>
            <div className="lbl">Gradimento medio corsi</div>
          </div>
          <div className="card stat"><div className="num">{avgRatingAll.length}</div><div className="lbl">Feedback ricevuti</div></div>
        </div>

        <div className="section grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
          <div className="card">
            <h2>👀 Corsi più seguiti</h2>
            {mostViewed.map((s) => {
              const tot = s.completed + s.inProgress;
              const max = Math.max(...mostViewed.map((x) => x.completed + x.inProgress), 1);
              return (
                <div className="bar-row" key={s.course.id}>
                  <span className="bar-label">{s.course.emoji} {s.course.title}</span>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(tot / max) * 100}%` }} />
                  </div>
                  <span className="bar-val">{tot}</span>
                </div>
              );
            })}
          </div>

          <div className="card">
            <h2>⭐ Corsi più apprezzati</h2>
            {bestRated.length === 0 && <p className="empty">Ancora nessun feedback.</p>}
            {bestRated.map((s) => (
              <div className="bar-row" key={s.course.id}>
                <span className="bar-label">{s.course.emoji} {s.course.title}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${((s.avgRating ?? 0) / 5) * 100}%` }} />
                </div>
                <span className="bar-val">{s.avgRating}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="section">
          <div className="section-head">
            <h2>⏰ Solleciti: corsi obbligatori non completati</h2>
            <span className="hint">in produzione: promemoria email automatici con escalation al responsabile</span>
          </div>
          <div className="card table-wrap">
            <table className="data">
              <thead>
                <tr><th>Collaboratore</th><th>Punto vendita</th><th>Corsi mancanti</th></tr>
              </thead>
              <tbody>
                {late.length === 0 && (
                  <tr><td colSpan={3} className="empty">Nessun ritardo: tutti in regola! 🎉</td></tr>
                )}
                {late.map(({ u, missing }) => {
                  const store = db.stores.find((s) => s.id === u.storeId);
                  return (
                    <tr key={u.id}>
                      <td><strong>{u.lastName} {u.firstName}</strong></td>
                      <td>{store?.name ?? "—"}</td>
                      <td>
                        {missing.map((c) => (
                          <span key={c.id} className="pill pill-red" style={{ marginRight: 5 }}>
                            {c.emoji} {c.title}
                          </span>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="section">
          <div className="section-head">
            <h2>🏪 Dettaglio punti vendita</h2>
          </div>
          <div className="card table-wrap">
            <table className="data">
              <thead>
                <tr><th>#</th><th>Punto vendita</th><th>Insegna</th><th>Collaboratori</th><th>Conformità obbligatori</th><th>Punti totali</th></tr>
              </thead>
              <tbody>
                {ranking.map((r, i) => (
                  <tr key={r.store.id}>
                    <td><span className={`rank-pos ${i === 0 ? "gold" : ""}`}>{i + 1}</span></td>
                    <td><strong>{r.store.name}</strong></td>
                    <td><InsegnaLogo tenant={r.tenant} height={18} /> {r.tenant.name}</td>
                    <td>{r.staff}</td>
                    <td>
                      <div className="progress-track" style={{ width: 110, display: "inline-block", verticalAlign: "middle" }}>
                        <div className="progress-fill" style={{ width: `${r.compliance}%` }} />
                      </div>{" "}
                      {r.compliance}%
                    </td>
                    <td><span className="pill pill-amber">{r.points}</span></td>
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
