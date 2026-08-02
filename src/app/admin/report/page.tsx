import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import Header from "@/components/Header";
import InsegnaLogo from "@/components/InsegnaLogo";
import { courseStats, scopeUsers, scopeCourses, storeRanking, coursesForUser, getProgress, isCourseCompleted } from "@/lib/logic";
import { buildReportRows, parseColumns, REPORT_COLUMNS, STATO_LABELS, ReportColumn } from "@/lib/customReport";

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ col?: string | string[]; reparto?: string; insegna?: string; corso?: string; stato?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "student") redirect("/studente");
  const sp = await searchParams;

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

  // ---------- report personalizzato ----------
  const canSystem = user.role === "system_admin" || user.role === "course_manager";
  const selectedColumns = parseColumns(sp.col);
  const filters = { reparto: sp.reparto, insegna: sp.insegna, corso: sp.corso, stato: sp.stato };
  const reportRows = buildReportRows(db, user, filters);
  const reportDepartments = db.departments.filter(
    (d) => canSystem || (!d.tenantId && !d.storeId) || d.tenantId === user.tenantId || d.storeId === user.storeId
  );
  const reportCourses = scopeCourses(db, user);
  const csvQuery = new URLSearchParams();
  selectedColumns.forEach((c) => csvQuery.append("col", c));
  Object.entries(filters).forEach(([k, v]) => v && csvQuery.set(k, v));

  return (
    <div>
      <Header user={user} active="report" />
      <div className="container">
        <h1>Report e analytics</h1>
        <p className="subtitle">
          Andamento della formazione nel tuo ambito. Più sotto il report personalizzato: scegli le colonne, filtra ed esporta in CSV.
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

        <div className="section">
          <div className="section-head">
            <h2>🧮 Report personalizzato</h2>
            <span className="hint">{reportRows.length} righe</span>
          </div>
          <div className="card">
            <form method="get" style={{ marginBottom: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 14 }}>
                <label className="field" style={{ marginBottom: 0 }}>
                  Reparto
                  <select name="reparto" defaultValue={sp.reparto ?? ""}>
                    <option value="">Tutti</option>
                    {reportDepartments.map((d) => <option key={d.id} value={d.id}>{d.emoji} {d.name}</option>)}
                  </select>
                </label>
                {canSystem && (
                  <label className="field" style={{ marginBottom: 0 }}>
                    Insegna
                    <select name="insegna" defaultValue={sp.insegna ?? ""}>
                      <option value="">Tutte</option>
                      {db.tenants.map((t) => <option key={t.id} value={t.id}>{t.emoji} {t.name}</option>)}
                    </select>
                  </label>
                )}
                <label className="field" style={{ marginBottom: 0 }}>
                  Corso
                  <select name="corso" defaultValue={sp.corso ?? ""}>
                    <option value="">Tutti</option>
                    {reportCourses.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.title}</option>)}
                  </select>
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  Stato
                  <select name="stato" defaultValue={sp.stato ?? ""}>
                    <option value="">Tutti</option>
                    <option value="completato">✓ Completato</option>
                    <option value="in_corso">In corso</option>
                    <option value="non_iniziato">Non iniziato</option>
                  </select>
                </label>
              </div>

              <p className="hint" style={{ margin: "0 0 6px" }}>Colonne da mostrare:</p>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
                {REPORT_COLUMNS.map((c) => (
                  <label key={c.key} className="checkbox-row" style={{ fontSize: 13 }}>
                    <input type="checkbox" name="col" value={c.key} defaultChecked={selectedColumns.includes(c.key as ReportColumn)} />
                    {c.label}
                  </label>
                ))}
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn btn-sm" type="submit">🔍 Applica</button>
                <a className="btn btn-outline btn-sm" href={`/api/report/csv?${csvQuery.toString()}`}>⬇ Esporta CSV</a>
              </div>
            </form>

            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>{selectedColumns.map((c) => <th key={c}>{REPORT_COLUMNS.find((rc) => rc.key === c)!.label}</th>)}</tr>
                </thead>
                <tbody>
                  {reportRows.length === 0 && (
                    <tr><td colSpan={selectedColumns.length} className="empty">Nessuna riga con questi filtri.</td></tr>
                  )}
                  {reportRows.slice(0, 300).map((r, i) => (
                    <tr key={`${r.userId}_${i}`}>
                      {selectedColumns.map((c) => (
                        <td key={c}>
                          {c === "stato" ? (
                            <span className={`pill ${r.stato === "completato" ? "pill-green" : r.stato === "in_corso" ? "pill-blue" : "pill-gray"}`}>
                              {STATO_LABELS[r.stato]}
                            </span>
                          ) : c === "percento" ? (
                            `${r.percento}%`
                          ) : (
                            r[c]
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {reportRows.length > 300 && (
                <p className="hint" style={{ marginTop: 8 }}>
                  Mostrate le prime 300 righe su {reportRows.length}: usa i filtri o esporta in CSV per vedere tutto.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
