import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import Header from "@/components/Header";
import CourseCard from "@/components/CourseCard";
import InsegnaLogo from "@/components/InsegnaLogo";
import { BADGE_DEFS, userSites } from "@/lib/types";
import {
  coursesForUser,
  getProgress,
  isCourseCompleted,
  courseCompletion,
  dueDate,
  expiringCourses,
  storeLeaderboard,
  storeRanking,
  isNewHire,
} from "@/lib/logic";

export default async function StudentDashboard() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!userSites(user).includes("academy")) redirect("/stampe");
  const db = await getDb();

  const myCourses = coursesForUser(db, user);
  const tenant = db.tenants.find((t) => t.id === user.tenantId);
  const store = db.stores.find((s) => s.id === user.storeId);
  const dept = db.departments.find((d) => d.id === user.departmentId);

  const sections = [
    { key: "sistema", title: "🏛️ Formazione Garden Team (sistema)", hint: "Corsi del consorzio, comuni a tutte le insegne" },
    { key: "insegna", title: `${tenant?.emoji ?? "🏬"} Formazione ${tenant?.name ?? "di insegna"}`, hint: "Corsi della tua insegna" },
    { key: "punto_vendita", title: `📍 Il tuo punto vendita${store ? ` — ${store.city}` : ""}`, hint: "Corsi specifici del tuo negozio" },
  ] as const;

  const completedCourses = myCourses.filter((c) => isCourseCompleted(c, getProgress(db, user.id, c.id)));
  const inProgressCourses = myCourses.filter((c) => {
    const p = getProgress(db, user.id, c.id);
    return p && p.completedLessons.length > 0 && !isCourseCompleted(c, p);
  });
  const expiring = expiringCourses(db, user);
  const myCerts = db.certificates.filter((c) => c.userId === user.id);

  const myPaths = db.paths.filter((p) => {
    if (p.onlyNewHires && !isNewHire(user)) return false;
    if (p.departments && (!user.departmentId || !p.departments.includes(user.departmentId))) return false;
    if (p.tenantId && p.tenantId !== user.tenantId) return false;
    return true;
  });

  const leaderboard = user.storeId ? storeLeaderboard(db, user.storeId).slice(0, 5) : [];
  const ranking = storeRanking(db).slice(0, 5);

  return (
    <div>
      <Header user={user} active="studente" />
      <div className="container">
        <h1>Ciao {user.firstName} 👋</h1>
        <p className="subtitle">
          {user.jobTitle}
          {dept ? ` · Reparto ${dept.name}` : ""} — hai <strong>{user.points} punti</strong>
          {isNewHire(user) && " · 🚀 percorso neoassunti attivo"}
        </p>

        {db.settings.welcome && (
          <div className="alert" style={{ background: "var(--green-900)", color: "#fff", display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ background: "#fff", borderRadius: 6, padding: "2px 8px", display: "inline-flex" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={db.settings.logoUrl} alt="" style={{ height: 20 }} />
            </span>
            <span>{db.settings.welcome}</span>
          </div>
        )}
        {tenant?.welcome && (
          <div className="alert" style={{ background: "#fff", border: `2px solid ${tenant.color}`, display: "flex", gap: 10, alignItems: "center" }}>
            {tenant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tenant.logoUrl} alt={tenant.name} style={{ height: 28, maxWidth: 90, objectFit: "contain" }} />
            ) : (
              <span>{tenant.emoji}</span>
            )}
            <span>{tenant.welcome}</span>
          </div>
        )}
        {store?.welcome && (
          <div className="alert alert-green">📍 <strong>{store.name}:</strong> {store.welcome}</div>
        )}

        {expiring.length > 0 && (
          <div className="alert alert-amber">
            ⏰ <strong>Hai {expiring.length} corsi obbligatori da completare:</strong>{" "}
            {expiring.map((e, i) => (
              <span key={e.course.id}>
                {i > 0 && ", "}
                <a href={`/corso/${e.course.id}`}>{e.course.title}</a> (entro {e.due!.toLocaleDateString("it-IT")})
              </span>
            ))}
          </div>
        )}

        <div className="grid grid-4">
          <div className="card stat"><div className="num">{myCourses.length}</div><div className="lbl">Corsi assegnati</div></div>
          <div className="card stat"><div className="num">{inProgressCourses.length}</div><div className="lbl">In corso</div></div>
          <div className="card stat"><div className="num">{completedCourses.length}</div><div className="lbl">Completati</div></div>
          <div className="card stat"><div className="num">{myCerts.length}</div><div className="lbl">Certificati</div></div>
        </div>

        {myPaths.length > 0 && (
          <div className="section">
            <div className="section-head">
              <h2>🧭 I tuoi percorsi formativi</h2>
              <span className="hint">assegnati automaticamente in base al tuo profilo</span>
            </div>
            <div className="grid grid-2">
              {myPaths.map((p) => {
                const pathCourses = p.courseIds
                  .map((id) => db.courses.find((c) => c.id === id)!)
                  .filter(Boolean);
                const done = pathCourses.filter((c) => isCourseCompleted(c, getProgress(db, user.id, c.id))).length;
                const pct = Math.round((done / pathCourses.length) * 100);
                return (
                  <div key={p.id} className="card">
                    <h3>
                      {p.emoji} {p.title}
                    </h3>
                    <p style={{ color: "var(--muted)", fontSize: 13.5, margin: "4px 0 12px" }}>{p.description}</p>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="progress-label">
                      {done} di {pathCourses.length} moduli completati ({pct}%)
                    </div>
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 5 }}>
                      {pathCourses.map((c, i) => {
                        const cDone = isCourseCompleted(c, getProgress(db, user.id, c.id));
                        return (
                          <a key={c.id} href={`/corso/${c.id}`} className="lesson-item" style={{ padding: "6px 8px" }}>
                            <span className={`lesson-check ${cDone ? "done" : ""}`}>{cDone ? "✓" : i + 1}</span>
                            {c.title}
                          </a>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {sections.map((sec) => {
          const list = myCourses.filter((c) => c.level === sec.key);
          if (list.length === 0) return null;
          return (
            <div className="section" key={sec.key}>
              <div className="section-head">
                <h2>{sec.title}</h2>
                <span className="hint">{sec.hint}</span>
              </div>
              <div className="grid grid-2">
                {list.map((c) => (
                  <CourseCard key={c.id} course={c} prog={getProgress(db, user.id, c.id)} due={dueDate(c, user)} />
                ))}
              </div>
            </div>
          );
        })}

        <div className="section grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <div className="card">
            <h2>🎖️ I tuoi badge</h2>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 10 }}>
              {Object.entries(BADGE_DEFS).map(([key, b]) => (
                <div key={key} className={`badge-tile ${user.badges.includes(key) ? "" : "locked"}`} title={b.desc}>
                  <span className="b-emoji">{b.emoji}</span>
                  <span>{b.label}</span>
                </div>
              ))}
            </div>
          </div>

          {leaderboard.length > 0 && (
            <div className="card">
              <h2>🏅 Classifica del negozio</h2>
              {leaderboard.map((u, i) => (
                <div key={u.id} className="rank-row">
                  <span className={`rank-pos ${i === 0 ? "gold" : ""}`}>{i + 1}</span>
                  <span style={{ flex: 1, fontWeight: u.id === user.id ? 800 : 500 }}>
                    {u.firstName} {u.lastName} {u.id === user.id && "← tu"}
                  </span>
                  <span className="pill pill-amber">{u.points} pt</span>
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <h2>🏆 Sfida tra negozi</h2>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 8px" }}>
              Classifica per completamento corsi obbligatori
            </p>
            {ranking.map((r, i) => (
              <div key={r.store.id} className="rank-row">
                <span className={`rank-pos ${i === 0 ? "gold" : ""}`}>{i + 1}</span>
                <span style={{ flex: 1, fontWeight: r.store.id === user.storeId ? 800 : 500, display: "flex", alignItems: "center", gap: 6 }}>
                  <InsegnaLogo tenant={r.tenant} height={15} /> {r.store.name} {r.store.id === user.storeId && "← il tuo"}
                </span>
                <span className="pill pill-green">{r.compliance}%</span>
              </div>
            ))}
          </div>
        </div>

        {myCerts.length > 0 && (
          <div className="section">
            <div className="section-head">
              <h2>📜 I tuoi certificati</h2>
            </div>
            <div className="card">
              <table className="data">
                <thead>
                  <tr><th>Corso</th><th>Data</th><th></th></tr>
                </thead>
                <tbody>
                  {myCerts.map((cert) => {
                    const c = db.courses.find((x) => x.id === cert.courseId);
                    return (
                      <tr key={cert.id}>
                        <td>{c?.emoji} {c?.title}</td>
                        <td>{new Date(cert.issuedAt).toLocaleDateString("it-IT")}</td>
                        <td><a className="btn btn-outline btn-sm" href={`/certificato/${cert.id}`}>Vedi certificato</a></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {db.settings.supportEmail && (
          <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, marginTop: 40 }}>
            Problemi o domande sulla formazione? Scrivi a{" "}
            <a href={`mailto:${db.settings.supportEmail}`}>{db.settings.supportEmail}</a>
          </p>
        )}
      </div>
    </div>
  );
}
