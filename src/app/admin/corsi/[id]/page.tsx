import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import Header from "@/components/Header";
import {
  updateCourse,
  deleteCourse,
  saveLesson,
  deleteLesson,
  moveLesson,
  saveQuestion,
  deleteQuestion,
  saveLessonQuestion,
  deleteLessonQuestion,
} from "@/lib/actions";
import { LEVEL_LABELS } from "@/lib/types";

const TYPE_OPTIONS = [
  { value: "video", label: "🎬 Video" },
  { value: "slide", label: "🖥️ Slide" },
  { value: "pdf", label: "📄 PDF" },
  { value: "testo", label: "📖 Testo / lettura" },
  { value: "quiz", label: "🧠 Quiz intermedio" },
];

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
            🔒 Non hai i permessi per modificare questo corso di livello <strong>{LEVEL_LABELS[course.level]}</strong>.
            {course.level === "sistema" && " I corsi di sistema sono gestiti dal consorzio."}
          </div>
        </div>
      </div>
    );
  }

  const updateAction = updateCourse.bind(null, course.id);
  const deleteAction = deleteCourse.bind(null, course.id);
  const addLessonAction = saveLesson.bind(null, course.id, null);
  const addQuestionAction = saveQuestion.bind(null, course.id, null);

  return (
    <div>
      <Header user={user} active="corsi" />
      <div className="container">
        <div style={{ marginBottom: 8 }}>
          <Link href="/admin/corsi">← Torna al catalogo</Link>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0 }}>✏️ {course.emoji} {course.title}</h1>
          <span className="pill pill-blue">{LEVEL_LABELS[course.level]}</span>
        </div>
        <p className="subtitle" style={{ marginTop: 6 }}>
          {course.lessons.length} lezioni · {course.quiz.length} domande quiz
        </p>

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
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 4 }}>
              <strong style={{ fontSize: 14 }}>🖼️ Copertina del corso</strong>
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
            <button className="btn" type="submit">💾 Salva dati corso</button>
          </form>
        </div>

        {/* ---------- Lezioni ---------- */}
        <div className="section">
          <div className="section-head">
            <h2>📚 Lezioni ({course.lessons.length})</h2>
            <span className="hint">modifica, riordina o elimina i contenuti</span>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
            {course.lessons.map((l, i) => {
              const saveAction = saveLesson.bind(null, course.id, l.id);
              const delAction = deleteLesson.bind(null, course.id, l.id);
              const upAction = moveLesson.bind(null, course.id, l.id, -1);
              const downAction = moveLesson.bind(null, course.id, l.id, 1);
              return (
                <div className="card" key={l.id}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
                    <span className="rank-pos">{i + 1}</span>
                    <strong style={{ flex: 1 }}>{l.title}</strong>
                    <form action={upAction}>
                      <button className="btn btn-outline btn-sm" type="submit" disabled={i === 0} title="Sposta su">↑</button>
                    </form>
                    <form action={downAction}>
                      <button className="btn btn-outline btn-sm" type="submit" disabled={i === course.lessons.length - 1} title="Sposta giù">↓</button>
                    </form>
                    <form action={delAction}>
                      <button className="btn btn-outline btn-sm" type="submit" style={{ color: "var(--red)", borderColor: "var(--red)" }}>
                        🗑 Elimina
                      </button>
                    </form>
                  </div>
                  <form action={saveAction}>
                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 90px", gap: 12 }}>
                      <label className="field">
                        Titolo
                        <input type="text" name="title" defaultValue={l.title} required />
                      </label>
                      <label className="field">
                        Tipo
                        <select name="type" defaultValue={l.type}>
                          {TYPE_OPTIONS.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Minuti
                        <input type="text" name="minutes" defaultValue={String(l.minutes)} />
                      </label>
                    </div>
                    <label className="field">
                      {l.type === "quiz" ? "Introduzione al quiz" : "Contenuto / descrizione"}
                      <textarea name="content" rows={3} defaultValue={l.content} />
                    </label>
                    <button className="btn btn-sm" type="submit">💾 Salva lezione</button>
                  </form>

                  {l.type === "quiz" && (
                    <div style={{ marginTop: 14, borderTop: "1.5px dashed var(--line)", paddingTop: 12 }}>
                      <strong style={{ fontSize: 14 }}>🧠 Domande del quiz intermedio ({(l.questions ?? []).length})</strong>
                      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 10px" }}>
                        Lo studente supera il capitolo rispondendo correttamente ad almeno il {course.passScore}% delle domande.
                      </p>
                      {(l.questions ?? []).map((q, qi) => {
                        const saveLQ = saveLessonQuestion.bind(null, course.id, l.id, q.id);
                        const delLQ = deleteLessonQuestion.bind(null, course.id, l.id, q.id);
                        return (
                          <div key={q.id} style={{ background: "var(--green-50)", borderRadius: 10, padding: 12, marginBottom: 10 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                              <span className="pill pill-gray">{qi + 1}</span>
                              <strong style={{ flex: 1, fontSize: 13.5 }}>{q.text}</strong>
                              <form action={delLQ}>
                                <button className="btn btn-outline btn-sm" type="submit" style={{ color: "var(--red)", borderColor: "var(--red)" }}>🗑</button>
                              </form>
                            </div>
                            <form action={saveLQ}>
                              <label className="field">Domanda<input type="text" name="text" defaultValue={q.text} required /></label>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                                {[0, 1, 2, 3].map((oi) => (
                                  <label className="field" key={oi}>
                                    Risposta {oi + 1} {oi === q.correct && "✅"}
                                    <input type="text" name={`opt${oi}`} defaultValue={q.options[oi] ?? ""} />
                                  </label>
                                ))}
                              </div>
                              <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                                <label className="field" style={{ maxWidth: 200, marginBottom: 0 }}>
                                  Risposta corretta
                                  <select name="correct" defaultValue={String(q.correct)}>
                                    {q.options.map((_, oi) => <option key={oi} value={oi}>Risposta {oi + 1}</option>)}
                                  </select>
                                </label>
                                <button className="btn btn-sm" type="submit">💾 Salva</button>
                              </div>
                            </form>
                          </div>
                        );
                      })}
                      <details style={{ marginTop: 6 }}>
                        <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13.5 }}>➕ Aggiungi domanda al quiz intermedio</summary>
                        <form action={saveLessonQuestion.bind(null, course.id, l.id, null)} style={{ marginTop: 10 }}>
                          <label className="field">Domanda<input type="text" name="text" required /></label>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                            {[0, 1, 2, 3].map((oi) => (
                              <label className="field" key={oi}>
                                Risposta {oi + 1}
                                <input type="text" name={`opt${oi}`} placeholder={oi < 2 ? "obbligatoria" : "facoltativa"} />
                              </label>
                            ))}
                          </div>
                          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                            <label className="field" style={{ maxWidth: 200, marginBottom: 0 }}>
                              Risposta corretta
                              <select name="correct" defaultValue="0">
                                {[0, 1, 2, 3].map((oi) => <option key={oi} value={oi}>Risposta {oi + 1}</option>)}
                              </select>
                            </label>
                            <button className="btn btn-sm" type="submit">➕ Aggiungi</button>
                          </div>
                        </form>
                      </details>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="card" style={{ marginTop: 16, background: "var(--green-50)" }}>
            <h3>➕ Aggiungi una lezione</h3>
            <form action={addLessonAction}>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 90px", gap: 12 }}>
                <label className="field">
                  Titolo
                  <input type="text" name="title" required placeholder="es. Le piante grasse" />
                </label>
                <label className="field">
                  Tipo
                  <select name="type" defaultValue="video">
                    {TYPE_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Minuti
                  <input type="text" name="minutes" defaultValue="10" />
                </label>
              </div>
              <label className="field">
                Contenuto / descrizione
                <textarea name="content" rows={2} placeholder="Testo della lezione o descrizione del video/materiale" />
              </label>
              <button className="btn btn-sm" type="submit">➕ Aggiungi lezione</button>
            </form>
          </div>
        </div>

        {/* ---------- Quiz ---------- */}
        <div className="section">
          <div className="section-head">
            <h2>🧠 Quiz finale ({course.quiz.length} domande)</h2>
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
                        🗑 Elimina
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
                          Risposta {oi + 1} {oi === q.correct && "✅"}
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
                    <button className="btn btn-sm" type="submit">💾 Salva domanda</button>
                  </form>
                </div>
              );
            })}
          </div>

          <div className="card" style={{ marginTop: 16, background: "var(--green-50)" }}>
            <h3>➕ Aggiungi una domanda</h3>
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
              <button className="btn btn-sm" type="submit">➕ Aggiungi domanda</button>
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
                🗑 Elimina definitivamente questo corso
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
