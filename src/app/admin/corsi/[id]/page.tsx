import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import Header from "@/components/Header";
import LessonsPanel from "@/components/LessonsPanel";
import SessionsPanel from "@/components/SessionsPanel";
import CourseShareBar from "@/components/CourseShareBar";
import { updateCourse, deleteCourse, saveQuestion, deleteQuestion } from "@/lib/actions";
import { courseVisibleTo } from "@/lib/logic";
import { DEFAULT_WATCH_THRESHOLD, LEVEL_LABELS } from "@/lib/types";

export default async function EditCoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ salvato?: string; creato?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "student") redirect("/studente");
  const { id } = await params;
  const { salvato, creato } = await searchParams;

  const db = await getDb();
  const course = db.courses.find((c) => c.id === id);
  if (!course) notFound();

  const canSystem = user.role === "system_admin" || user.role === "course_manager";
  const canEdit =
    canSystem ||
    (user.role === "group_admin" && course.level !== "sistema" && course.tenantId === user.tenantId) ||
    (user.role === "store_admin" && course.level === "punto_vendita" && course.storeId === user.storeId);

  if (!canEdit) {
    return (
      <div>
        <Header user={user} active="corsi" />
        <div className="container">
          <div style={{ marginBottom: 8 }}>
            <Link href="/admin/corsi">← Torna al catalogo</Link>
          </div>
          <h1>{course.emoji} {course.title}</h1>
          <div className="alert alert-amber">
            Non hai i permessi per modificare questo corso di livello <strong>{LEVEL_LABELS[course.level]}</strong>.
            {course.level === "sistema" && " I corsi di sistema sono gestiti dal consorzio."}
          </div>
        </div>
      </div>
    );
  }

  const updateAction = updateCourse.bind(null, course.id);
  const deleteAction = deleteCourse.bind(null, course.id);
  const addQuestionAction = saveQuestion.bind(null, course.id, null);
  // quante persone riceveranno la convocazione di un'edizione programmata
  const destinatari = db.users.filter(
    (u) => u.active !== false && (u.role === "student" || u.role === "dept_head") && courseVisibleTo(course, u)
  );
  const recipients = destinatari.length;

  // Visione effettiva dei video: una riga per collaboratore che ha aperto il corso
  const threshold = db.settings.watchThreshold ?? DEFAULT_WATCH_THRESHOLD;
  const videoLessons = course.lessons.filter((l) => l.type === "video" && l.videoUrl);
  // destinatari attuali + chiunque abbia già lavorato sul corso (può non essere più
  // fra i destinatari, ad es. un corso riservato ai neoassunti)
  const conProgresso = db.users.filter(
    (u) => !destinatari.some((d) => d.id === u.id) &&
      db.progress.some((p) => p.userId === u.id && p.courseId === course.id)
  );
  const watchRows = [...destinatari, ...conProgresso]
    .map((u) => {
      const prog = db.progress.find((p) => p.userId === u.id && p.courseId === course.id);
      const cells = videoLessons.map((l) => {
        const v = prog?.views?.find((x) => x.lessonId === l.id);
        // quota realmente vista (tempo riprodotto / durata), non il punto raggiunto
        const seen = v && v.durationSec ? Math.min(100, Math.round((v.secondsWatched / v.durationSec) * 100)) : null;
        return {
          lessonId: l.id,
          percent: v ? (seen ?? 0) : null,
          reached: v?.maxPercent ?? null,
          minutes: v ? Math.round(v.secondsWatched / 60) : 0,
          manual: prog?.completedLessons.includes(l.id) ?? false,
        };
      });
      return {
        user: u,
        storeName: db.stores.find((s) => s.id === u.storeId)?.name ?? "",
        cells,
        touched: cells.some((c) => c.percent !== null || c.manual),
      };
    })
    .filter((r) => r.touched);

  return (
    <div>
      <Header user={user} active="corsi" />
      <div className="container">
        <div style={{ marginBottom: 8 }}>
          <Link href="/admin/corsi">← Torna al catalogo</Link>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0 }}>{course.emoji} {course.title}</h1>
          <span className="pill pill-blue">{LEVEL_LABELS[course.level]}</span>
        </div>
        <p className="subtitle" style={{ marginTop: 6 }}>
          {course.lessons.length} lezioni · {course.quiz.length} domande quiz · {recipients} destinatari
        </p>

        <CourseShareBar courseId={course.id} />

        {creato && <div className="alert alert-green">✓ Corso creato: ora aggiungi lezioni e quiz qui sotto.</div>}
        {salvato && <div className="alert alert-green">✓ Modifiche salvate.</div>}

        {/* ---------- Dati corso ---------- */}
        <div className="card" style={{ maxWidth: 760 }}>
          <h2>Dati del corso</h2>
          <form action={updateAction}>
            <div style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 12 }}>
              <label className="field">
                Emoji
                <input type="text" name="emoji" defaultValue={course.emoji} maxLength={4} />
              </label>
              <label className="field">
                Titolo
                <input type="text" name="title" defaultValue={course.title} required />
              </label>
            </div>
            <label className="field">
              Descrizione
              <textarea name="description" rows={2} defaultValue={course.description} />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              <label className="field">
                Categoria
                <input type="text" name="category" defaultValue={course.category} />
              </label>
              <label className="field">
                Livello
                <select name="level" defaultValue={course.level}>
                  {canSystem && <option value="sistema">Sistema (tutti)</option>}
                  <option value="insegna">Insegna</option>
                  <option value="punto_vendita">Punto vendita</option>
                </select>
              </label>
              <label className="field">
                Reparto destinatario
                <select name="department" defaultValue={course.departments?.[0] ?? ""}>
                  <option value="">Tutti i reparti</option>
                  {db.departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Gruppo destinatario
                <select name="group" defaultValue={course.groups?.[0] ?? ""}>
                  <option value="">Nessun gruppo (tutti)</option>
                  {db.groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.emoji} {g.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              <label className="field">
                Soglia quiz (%)
                <input type="text" name="passScore" defaultValue={String(course.passScore)} />
              </label>
              <label className="field">
                Punti al completamento
                <input type="text" name="points" defaultValue={String(course.points)} />
              </label>
              <label className="field">
                Scadenza (giorni, se obbligatorio)
                <input type="text" name="dueDays" defaultValue={course.dueDays ? String(course.dueDays) : "60"} />
              </label>
            </div>
            <label className="checkbox-row">
              <input type="checkbox" name="mandatory" defaultChecked={course.mandatory} /> Corso obbligatorio
            </label>
            <label className="checkbox-row">
              <input type="checkbox" name="newHires" defaultChecked={!!course.onlyNewHires} /> Riservato ai neoassunti (ultimi 90 giorni)
            </label>
            <label className="checkbox-row">
              <input type="checkbox" name="sequential" defaultChecked={!!course.sequential} /> Corso bloccato: le lezioni si sbloccano una alla volta, in ordine
            </label>
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 4 }}>
              <strong style={{ fontSize: 14 }}>Copertina del corso</strong>
              {course.coverUrl && (
                <div style={{ margin: "8px 0" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={course.coverUrl} alt="Copertina" style={{ maxWidth: 260, maxHeight: 120, borderRadius: 10, objectFit: "cover" }} />
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label className="field">
                  Carica immagine
                  <input type="file" name="cover" accept="image/*" style={{ marginTop: 4 }} />
                </label>
                <label className="field">
                  …oppure URL immagine
                  <input type="text" name="coverUrl" defaultValue={course.coverUrl ?? ""} placeholder="https://…" />
                </label>
              </div>
              {course.coverUrl && (
                <label className="checkbox-row">
                  <input type="checkbox" name="removeCover" /> Rimuovi copertina (torna all&apos;emoji)
                </label>
              )}
            </div>
            <button className="btn" type="submit">Salva dati corso</button>
          </form>
        </div>

        {/* ---------- Lezioni ---------- */}
        <div className="section">
          <div className="section-head">
            <h2>Lezioni ({course.lessons.length})</h2>
            <span className="hint">apri una lezione per modificarla · le modifiche si salvano senza ricaricare</span>
          </div>
          <LessonsPanel courseId={course.id} lessons={course.lessons} passScore={course.passScore} />
        </div>

        {/* ---------- Edizioni in programma ---------- */}
        <div className="section">
          <div className="section-head">
            <h2>Corso in programma ({(course.sessions ?? []).length})</h2>
            <span className="hint">date in calendario, link Zoom e convocazioni automatiche</span>
          </div>
          <SessionsPanel
            courseId={course.id}
            sessions={course.sessions ?? []}
            recipients={recipients}
          />
        </div>


        {/* ---------- Chi ha visto davvero i video ---------- */}
        {videoLessons.length > 0 && (
          <div className="section">
            <div className="section-head">
              <h2>Visione dei video</h2>
              <span className="hint">
                minuti realmente riprodotti, non il punto dove è arrivata la barra · completamento automatico
                al {threshold}% · «man.» = segnata a mano senza guardare
              </span>
            </div>
            <div className="card table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Collaboratore</th>
                    {videoLessons.map((l) => (
                      <th key={l.id} style={{ fontSize: 12 }}>{l.title.slice(0, 28)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {watchRows.length === 0 && (
                    <tr><td colSpan={videoLessons.length + 1} className="empty">Nessuno ha ancora aperto i video di questo corso.</td></tr>
                  )}
                  {watchRows.map((row) => (
                    <tr key={row.user.id}>
                      <td>
                        <strong>{row.user.firstName} {row.user.lastName}</strong>
                        <div className="hint">{row.storeName}</div>
                      </td>
                      {row.cells.map((c) => (
                        <td key={c.lessonId} style={{ minWidth: 120 }}>
                          {c.percent === null && !c.manual ? (
                            <span className="hint">—</span>
                          ) : (
                            <>
                              <div className="watch-track" style={{ marginBottom: 3 }}>
                                <div className={`watch-fill ${c.percent !== null && c.percent >= threshold ? "done" : ""}`}
                                  style={{ width: `${c.percent ?? 0}%` }} />
                              </div>
                              <span style={{ fontSize: 12 }} title={c.reached !== null ? `arrivato fino al ${c.reached}% del video` : undefined}>
                                {c.percent !== null ? `${c.percent}% visto` : "0%"}
                                {c.minutes ? ` · ${c.minutes} min` : ""}
                                {c.manual && c.percent === null && <span className="pill pill-amber" style={{ marginLeft: 4 }}>man.</span>}
                              </span>
                            </>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ---------- Quiz ---------- */}
        <div className="section">
          <div className="section-head">
            <h2>Quiz finale ({course.quiz.length} domande)</h2>
            <span className="hint">soglia di superamento: {course.passScore}%</span>
          </div>
          {course.quiz.length === 0 && (
            <div className="alert alert-amber">
              Questo corso non ha ancora un quiz: gli studenti lo completeranno solo guardando le lezioni. Aggiungi almeno una domanda per attivare il quiz finale.
            </div>
          )}
          <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
            {course.quiz.map((q, qi) => {
              const saveQ = saveQuestion.bind(null, course.id, q.id);
              const delQ = deleteQuestion.bind(null, course.id, q.id);
              return (
                <div className="card" key={q.id}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                    <span className="rank-pos">{qi + 1}</span>
                    <strong style={{ flex: 1 }}>{q.text}</strong>
                    <form action={delQ}>
                      <button className="btn btn-outline btn-sm" type="submit" style={{ color: "var(--red)", borderColor: "var(--red)" }}>
                        Elimina
                      </button>
                    </form>
                  </div>
                  <form action={saveQ}>
                    <label className="field">
                      Domanda
                      <input type="text" name="text" defaultValue={q.text} required />
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                      {[0, 1, 2, 3].map((oi) => (
                        <label className="field" key={oi}>
                          Risposta {oi + 1} {oi === q.correct && ""}
                          <input type="text" name={`opt${oi}`} defaultValue={q.options[oi] ?? ""} />
                        </label>
                      ))}
                    </div>
                    <label className="field" style={{ maxWidth: 260 }}>
                      Risposta corretta
                      <select name="correct" defaultValue={String(q.correct)}>
                        {q.options.map((_, oi) => (
                          <option key={oi} value={oi}>Risposta {oi + 1}</option>
                        ))}
                      </select>
                    </label>
                    <button className="btn btn-sm" type="submit">Salva domanda</button>
                  </form>
                </div>
              );
            })}
          </div>

          <div className="card" style={{ marginTop: 16, background: "var(--green-50)" }}>
            <h3>Aggiungi una domanda</h3>
            <form action={addQuestionAction}>
              <label className="field">
                Domanda
                <input type="text" name="text" required placeholder="es. Quanto va annaffiata una pianta grassa?" />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                {[0, 1, 2, 3].map((oi) => (
                  <label className="field" key={oi}>
                    Risposta {oi + 1}
                    <input type="text" name={`opt${oi}`} placeholder={oi < 2 ? "obbligatoria" : "facoltativa"} />
                  </label>
                ))}
              </div>
              <label className="field" style={{ maxWidth: 260 }}>
                Risposta corretta
                <select name="correct" defaultValue="0">
                  {[0, 1, 2, 3].map((oi) => (
                    <option key={oi} value={oi}>Risposta {oi + 1}</option>
                  ))}
                </select>
              </label>
              <button className="btn btn-sm" type="submit">Aggiungi domanda</button>
            </form>
          </div>
        </div>

        {/* ---------- Zona pericolosa ---------- */}
        <div className="section">
          <div className="card" style={{ borderColor: "#f3c1a8" }}>
            <h3 style={{ color: "var(--red)" }}>Elimina corso</h3>
            <p style={{ fontSize: 13.5, color: "var(--muted)" }}>
              Rimuove il corso, i progressi degli studenti e lo toglie dai percorsi. I certificati già emessi restano nello storico.
            </p>
            <form action={deleteAction}>
              <button className="btn btn-sm" type="submit" style={{ background: "var(--red)" }}>
                Elimina definitivamente questo corso
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
