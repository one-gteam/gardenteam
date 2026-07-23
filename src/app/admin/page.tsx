import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import Header from "@/components/Header";
import InsegnaLogo from "@/components/InsegnaLogo";
import { kpis, storeRanking, courseStats } from "@/lib/logic";
import { ROLE_LABELS, userSites } from "@/lib/types";

export default async function AdminDashboard() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!userSites(user).includes("academy")) redirect("/stampe");
  if (user.role === "student") redirect("/studente");

  const db = await getDb();
  const k = kpis(db, user);
  const ranking = storeRanking(db).filter(
    (r) =>
      user.role === "system_admin" ||
      user.role === "course_manager" ||
      (user.role === "group_admin" && r.tenant.id === user.tenantId) ||
      r.store.id === user.storeId
  );
  const stats = courseStats(db, user)
    .filter((s) => s.enrolled > 0)
    .sort((a, b) => b.completed / Math.max(b.enrolled, 1) - a.completed / Math.max(a.enrolled, 1));

  const scopeLabel =
    user.role === "system_admin" || user.role === "course_manager"
      ? "tutto il consorzio"
      : user.role === "group_admin"
        ? db.tenants.find((t) => t.id === user.tenantId)?.name ?? "la tua insegna"
        : db.stores.find((s) => s.id === user.storeId)?.name ?? "il tuo punto vendita";

  return (
    <div>
      <Header user={user} active="admin" />
      <div className="container">
        <h1>Dashboard amministratore</h1>
        <p className="subtitle">
          {ROLE_LABELS[user.role]} — visibilità su <strong>{scopeLabel}</strong>
        </p>

        <div className="grid grid-4">
          <a className="card stat card-link" href="/admin/utenti"><div className="num">{k.users}</div><div className="lbl">Collaboratori →</div></a>
          <a className="card stat card-link" href="/admin/corsi"><div className="num">{k.courses}</div><div className="lbl">Corsi attivi →</div></a>
          <a className="card stat card-link" href="/admin/report"><div className="num">{k.completionRate}%</div><div className="lbl">Tasso completamento →</div></a>
          <a className="card stat card-link" href="/admin/report"><div className="num">{k.certificates}</div><div className="lbl">Certificati emessi →</div></a>
          <a className="card stat card-link" href="/admin/utenti"><div className="num">{k.activeLearners}</div><div className="lbl">Studenti attivi →</div></a>
        </div>

        <div className="section grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
          <div className="card">
            <h2>🏆 Conformità per punto vendita</h2>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 12px" }}>
              % di completamento dei corsi obbligatori assegnati
            </p>
            {ranking.map((r) => (
              <a className="bar-row bar-row-link" key={r.store.id} href="/admin/report" title={`Vedi report di ${r.store.name}`}>
                <span className="bar-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <InsegnaLogo tenant={r.tenant} height={16} /> {r.store.name}
                </span>
                <div className="bar-track">
                  <div className={`bar-fill ${r.compliance < 50 ? "amber" : ""}`} style={{ width: `${r.compliance}%` }} />
                </div>
                <span className="bar-val">{r.compliance}%</span>
              </a>
            ))}
          </div>

          <div className="card">
            <h2>📚 Completamento per corso</h2>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 12px" }}>
              Completati sul totale degli assegnati
            </p>
            {stats.slice(0, 8).map((s) => {
              const pct = s.enrolled ? Math.round((s.completed / s.enrolled) * 100) : 0;
              return (
                <a className="bar-row bar-row-link" key={s.course.id} href={`/admin/corsi/${s.course.id}`} title={`Apri «${s.course.title}»`}>
                  <span className="bar-label">{s.course.title}</span>
                  <div className="bar-track">
                    <div className={`bar-fill ${pct < 50 ? "amber" : ""}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="bar-val">{pct}%</span>
                </a>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
