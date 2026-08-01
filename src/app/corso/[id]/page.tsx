import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import Header from "@/components/Header";
import { completeLesson, sendFeedback, submitLessonQuiz } from "@/lib/actions";
import { courseCompletion, getProgress, isCourseCompleted } from "@/lib/logic";
import { LEVEL_LABELS } from "@/lib/types";
import { parseVideoUrl } from "@/lib/video";

const TYPE_LABEL: Record<string, string> = {
  video: "🎬 Video",
  slide: "🖥️ Slide",
  pdf: "📄 PDF",
  testo: "📖 Lettura",
  quiz: "🧠 Quiz intermedio",
};

const ATTACHMENT_ICON: Record<string, string> = { pdf: "📄", slide: "🖥️", altro: "📎" };

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lezione?: string; quizEsito?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const { lezione, quizEsito } = await searchParams;

  const db = await getDb();
  const course = db.courses.find((c) => c.id === id);
  if (!course) notFound();

  const prog = getProgress(db, user.id, course.id);
  const idx = Math.min(Math.max(Number(lezione ?? 0) || 0, 0), course.lessons.length - 1);
  const lesson = course.lessons[idx];
  const lessonDone = prog?.completedLessons.includes(lesson.id) ?? false;
  const allLessonsDone = course.lessons.every((l) => prog?.completedLessons.includes(l.id));
  const completed = isCourseCompleted(course, prog);
  const pct = courseCompletion(course, prog);
  const myCert = db.certificates.find((c) => c.userId === user.id && c.courseId === course.id);
  const alreadyFedback = db.feedback.some((f) => f.userId === user.id && f.courseId === course.id);

  const markDone = completeLesson.bind(null, course.id, lesson.id);
  const feedbackAction = sendFeedback.bind(null, course.id);

  // edizioni programmate non ancora passate
  const oggi = new Date().toISOString().slice(0, 10);
  const nextSessions = (course.sessions ?? []).filter((s) => s.date >= oggi).slice(0, 3);

  const video = parseVideoUrl(lesson.videoUrl);
  const attachments = lesson.attachments ?? [];
  // lezione di soli documenti: il primo PDF viene mostrato direttamente nella pagina
  const inlinePdf = attachments.find((a) => a.kind === "pdf" || /\.pdf(\?|$)/i.test(a.url));

  return (
    <div>
      <Header user={user} active="studente" />
      <div className="container">
        <div style={{ marginBottom: 8 }}>
          <Link href="/studente">← Torna ai miei corsi</Link>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0 }}>
            {course.emoji} {course.title}
          </h1>
          <span className="pill pill-blue">{LEVEL_LABELS[course.level]}</span>
          {completed && <span className="pill pill-green">✓ Completato</span>}
        </div>
        <p className="subtitle" style={{ marginTop: 6 }}>{course.description}</p>

        <div style={{ maxWidth: 420, marginBottom: 20 }}>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="progress-label">{pct}% completato · +{course.points} punti al completamento</div>
        </div>

        {/* Edizioni in calendario: le prossime date a cui si è convocati */}
        {nextSessions.length > 0 && (
          <div className="session-banner">
            <strong style={{ fontSize: 14 }}>📅 {nextSessions.length > 1 ? "Prossime date in programma" : "Prossima data in programma"}</strong>
            {nextSessions.map((s) => {
              const [y, m, g] = s.date.split("-");
              return (
                <div key={s.id} className="session-row">
                  <span className="session-when">
                    <strong>{g}/{m}/{y}</strong> · {s.time}{s.endTime ? `–${s.endTime}` : ""}
                  </span>
                  <span>{s.mode === "online" ? "💻 Online" : `🏫 ${s.location || "In aula"}`}</span>
                  {s.trainer && <span className="hint">docente: {s.trainer}</span>}
                  {s.zoomUrl && (
                    <a className="btn btn-sm" href={s.zoomUrl} target="_blank" rel="noopener noreferrer">
                      🔗 Entra nella riunione
                    </a>
                  )}
                  {s.notes && <span className="hint">{s.notes}</span>}
                </div>
              );
            })}
          </div>
        )}

        <div className="lesson-layout">
          <div className="card" style={{ padding: 12 }}>
            <h3 style={{ padding: "4px 12px" }}>Contenuti del corso</h3>
            {course.lessons.map((l, i) => {
              const done = prog?.completedLessons.includes(l.id);
              return (
                <Link key={l.id} href={`/corso/${course.id}?lezione=${i}`}
                  className={`lesson-item ${i === idx ? "active" : ""}`}>
                  <span className={`lesson-check ${done ? "done" : ""}`}>{done ? "✓" : i + 1}</span>
                  <span style={{ flex: 1 }}>{l.title}</span>
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>{l.minutes}′</span>
                </Link>
              );
            })}
            {course.quiz.length > 0 && (
              <Link href={`/corso/${course.id}/quiz`} className="lesson-item"
                style={{ borderTop: "1px solid var(--line)", marginTop: 6, paddingTop: 12 }}>
                <span className={`lesson-check ${prog?.quizPassed ? "done" : ""}`}>{prog?.quizPassed ? "✓" : "?"}</span>
                <span style={{ flex: 1, fontWeight: 700 }}>Quiz finale</span>
                <span className="pill pill-gray">{course.quiz.length} domande</span>
              </Link>
            )}
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0 }}>{lesson.title}</h2>
              <span className="pill pill-gray">{TYPE_LABEL[lesson.type]} · {lesson.minutes} min</span>
            </div>

            {/* Video: YouTube (anche non in elenco), Bunny, Vimeo, SharePoint o file diretto */}
            {video.kind === "iframe" && (
              <div className="video-embed">
                <iframe
                  src={video.src}
                  title={lesson.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                  allowFullScreen
                  loading="lazy"
                />
              </div>
            )}
            {video.kind === "file" && (
              /* eslint-disable-next-line jsx-a11y/media-has-caption */
              <video className="video-embed" src={video.src} controls preload="metadata" />
            )}
            {video.kind === "none" && lesson.type === "video" && (
              <div className="video-frame">
                <div className="play-btn">▶</div>
                <div style={{ fontSize: 13, opacity: 0.8 }}>
                  Il video di questa lezione non è ancora stato caricato.
                </div>
              </div>
            )}

            {/* Lezione fatta di soli documenti: il primo PDF si sfoglia direttamente qui */}
            {video.kind === "none" && lesson.type === "pdf" && (
              inlinePdf ? (
                <object className="doc-embed" data={inlinePdf.url} type="application/pdf">
                  <div className="doc-frame">
                    <span className="doc-icon">📄</span>
                    <div>
                      <strong>{inlinePdf.name}</strong>
                      <div style={{ fontSize: 13, color: "var(--muted)" }}>
                        Il browser non mostra il PDF qui:{" "}
                        <a href={inlinePdf.url} target="_blank" rel="noopener noreferrer">aprilo in una nuova scheda</a>.
                      </div>
                    </div>
                  </div>
                </object>
              ) : (
                <div className="doc-frame">
                  <span className="doc-icon">{lesson.type === "pdf" ? "📄" : "🖥️"}</span>
                  <div>
                    <strong>{lesson.type === "pdf" ? "Materiale scaricabile" : "Presentazione"}</strong>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>
                      Nessun documento ancora allegato a questa lezione.
                    </div>
                  </div>
                </div>
              )
            )}

            {lesson.content && <p style={{ fontSize: 15, lineHeight: 1.7 }}>{lesson.content}</p>}

            {/* Slide e materiali della lezione */}
            {attachments.length > 0 && (
              <div className="materials">
                <strong style={{ fontSize: 14 }}>📎 Materiali della lezione</strong>
                <div className="materials-list">
                  {attachments.map((a) => (
                    <a key={a.id} className="material-item" href={a.url} target="_blank" rel="noopener noreferrer" download>
                      <span className="material-icon">{ATTACHMENT_ICON[a.kind]}</span>
                      <span style={{ flex: 1 }}>
                        {a.name}
                        {a.sizeKb !== undefined && (
                          <span style={{ color: "var(--muted)", fontSize: 12 }}> · {a.sizeKb} KB</span>
                        )}
                      </span>
                      <span className="material-dl">Scarica ↓</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {lesson.type === "quiz" && (
              <div>
                {quizEsito !== undefined && (
                  <div className={`alert ${Number(quizEsito) >= course.passScore ? "alert-green" : "alert-amber"}`}>
                    {Number(quizEsito) >= course.passScore
                      ? `🎉 Quiz superato con ${quizEsito}%! Capitolo completato.`
                      : `😕 Punteggio ${quizEsito}%: serve almeno il ${course.passScore}%. Riprova!`}
                  </div>
                )}
                {lessonDone ? (
                  <div className="alert alert-green">✓ Quiz intermedio già superato.</div>
                ) : (lesson.questions ?? []).length === 0 ? (
                  <p className="empty">Questo quiz non ha ancora domande.</p>
                ) : (
                  <form action={submitLessonQuiz.bind(null, course.id, lesson.id, idx)} className="card" style={{ background: "var(--green-50)" }}>
                    {lesson.questions!.map((q, qi) => (
                      <div className="quiz-q" key={q.id}>
                        <div className="q-text">{qi + 1}. {q.text}</div>
                        {q.options.map((opt, oi) => (
                          <label className="quiz-opt" key={oi}>
                            <input type="radio" name={q.id} value={oi} required />
                            {opt}
                          </label>
                        ))}
                      </div>
                    ))}
                    <button className="btn" type="submit">Consegna il quiz del capitolo</button>
                  </form>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
              {lesson.type !== "quiz" && (!lessonDone ? (
                <form action={markDone}>
                  <button className="btn" type="submit">✓ Segna lezione come completata (+10 pt)</button>
                </form>
              ) : (
                <span className="pill pill-green" style={{ alignSelf: "center", padding: "8px 14px" }}>✓ Lezione completata</span>
              ))}
              {idx < course.lessons.length - 1 && (
                <Link className="btn btn-outline" href={`/corso/${course.id}?lezione=${idx + 1}`}>
                  Lezione successiva →
                </Link>
              )}
              {idx === course.lessons.length - 1 && course.quiz.length > 0 && allLessonsDone && !prog?.quizPassed && (
                <Link className="btn" href={`/corso/${course.id}/quiz`}>
                  Vai al quiz finale →
                </Link>
              )}
            </div>

            {completed && (
              <div className="alert alert-green" style={{ marginTop: 22 }}>
                🎉 <strong>Corso completato!</strong> Hai guadagnato {course.points} punti.
                {myCert && (
                  <>
                    {" "}
                    <a href={`/certificato/${myCert.id}`}>Scarica il tuo certificato →</a>
                  </>
                )}
              </div>
            )}

            {completed && !alreadyFedback && (
              <div style={{ marginTop: 20, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
                <h3>Com&apos;è stato questo corso?</h3>
                <form action={feedbackAction}>
                  <label className="field">
                    Valutazione
                    <select name="rating" defaultValue="5">
                      <option value="5">⭐⭐⭐⭐⭐ Eccellente</option>
                      <option value="4">⭐⭐⭐⭐ Buono</option>
                      <option value="3">⭐⭐⭐ Discreto</option>
                      <option value="2">⭐⭐ Scarso</option>
                      <option value="1">⭐ Da rifare</option>
                    </select>
                  </label>
                  <label className="field">
                    Suggerimenti (facoltativo)
                    <textarea name="comment" rows={2} placeholder="Cosa miglioreresti?" />
                  </label>
                  <button className="btn btn-sm" type="submit">Invia feedback</button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
