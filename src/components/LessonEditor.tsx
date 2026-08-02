"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  saveLesson,
  deleteLesson,
  moveLesson,
  addLessonAttachment,
  deleteLessonAttachment,
  saveLessonQuestion,
  deleteLessonQuestion,
  uploadScormPackage,
  removeScormLesson,
} from "@/lib/actions";
import { LESSON_TYPES, Lesson, LessonType } from "@/lib/types";

const ATTACHMENT_ICON: Record<string, string> = { pdf: "📄", slide: "🖥️", altro: "📎" };

/**
 * Editor di una lezione: cambia tipo e salva senza ricaricare la pagina.
 * Le azioni server aggiornano i dati e il router li rilegge in background,
 * così non si perde la posizione nell'elenco.
 */
export default function LessonEditor({
  courseId,
  lesson,
  index,
  total,
  passScore,
}: {
  courseId: string;
  lesson: Lesson;
  index: number;
  total: number;
  passScore: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<LessonType>(lesson.type);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [scormMsg, setScormMsg] = useState("");

  const flash = (ok: boolean, msg = "") => {
    setStatus(ok ? "saved" : "error");
    setError(msg);
    if (ok) setTimeout(() => setStatus("idle"), 1800);
  };

  async function onSave(formData: FormData) {
    setStatus("saving");
    const res = await saveLesson(courseId, lesson.id, formData);
    flash(res.ok, res.ok ? "" : res.error);
    router.refresh();
  }

  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

  const typeMeta = LESSON_TYPES.find((t) => t.value === type);
  const attachments = lesson.attachments ?? [];
  const questions = lesson.questions ?? [];

  return (
    <div className="card lesson-card">
      <div className="lesson-card-head">
        <span className="rank-pos">{index + 1}</span>
        <button type="button" className="lesson-toggle" onClick={() => setOpen((o) => !o)}>
          <strong>{lesson.title}</strong>
          <span className="pill pill-gray">{typeMeta?.label}</span>
          {type === "video" && lesson.videoUrl && <span className="pill pill-green">▶ video</span>}
          {type === "scorm" && (lesson.scorm ? <span className="pill pill-green">🎯 SCORM {lesson.scorm.version}</span> : <span className="pill pill-amber">SCORM da caricare</span>)}
          {attachments.length > 0 && <span className="pill pill-blue">📎 {attachments.length}</span>}
          {type === "quiz" && <span className="pill pill-blue">{questions.length} domande</span>}
          <span style={{ marginLeft: "auto", color: "var(--muted)" }}>{open ? "▲ chiudi" : "▼ apri"}</span>
        </button>
        <button className="btn btn-outline btn-sm" type="button" disabled={index === 0 || pending}
          onClick={() => run(() => moveLesson(courseId, lesson.id, -1))} title="Sposta su">↑</button>
        <button className="btn btn-outline btn-sm" type="button" disabled={index === total - 1 || pending}
          onClick={() => run(() => moveLesson(courseId, lesson.id, 1))} title="Sposta giù">↓</button>
        <button className="btn btn-outline btn-sm danger" type="button" disabled={pending}
          onClick={() => { if (confirm(`Eliminare la lezione «${lesson.title}»?`)) run(() => deleteLesson(courseId, lesson.id)); }}>
          🗑
        </button>
      </div>

      {open && (
        <div className="lesson-card-body">
          <form action={onSave}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 90px", gap: 12 }}>
              <label className="field">
                Titolo
                <input type="text" name="title" defaultValue={lesson.title} required />
              </label>
              <label className="field">
                Tipo di lezione
                <select name="type" value={type} onChange={(e) => setType(e.target.value as LessonType)}>
                  {LESSON_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label className="field">
                Minuti
                <input type="text" name="minutes" defaultValue={String(lesson.minutes)} />
              </label>
            </div>
            <p className="hint" style={{ marginTop: -4 }}>{typeMeta?.hint}</p>

            {type === "video" && (
              <label className="field">
                🎬 Link del video
                <input type="text" name="videoUrl" defaultValue={lesson.videoUrl ?? ""}
                  placeholder="https://www.youtube.com/watch?v=… (anche video non in elenco)" />
                <span className="hint">
                  YouTube (anche <strong>non in elenco</strong>), Bunny Stream, Vimeo, SharePoint/Stream o un
                  link diretto a un .mp4. Puoi incollare anche il codice «Incorpora».
                </span>
              </label>
            )}

            <label className="field">
              {type === "quiz" ? "Introduzione al quiz"
                : type === "pdf" ? "Testo della lezione (facoltativo se c'è il PDF)"
                : type === "scorm" ? "Introduzione al contenuto (facoltativa)"
                : "Descrizione"}
              <textarea name="content" rows={3} defaultValue={lesson.content} />
            </label>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button className="btn btn-sm" type="submit" disabled={status === "saving"}>
                {status === "saving" ? "Salvataggio…" : "💾 Salva lezione"}
              </button>
              {status === "saved" && <span className="pill pill-green">✓ Salvato</span>}
              {status === "error" && <span className="pill pill-red">{error || "Errore"}</span>}
            </div>
          </form>

          {type === "scorm" && (
            <div className="lesson-sub">
              <strong style={{ fontSize: 14 }}>🎯 Pacchetto SCORM</strong>
              <p className="hint" style={{ margin: "4px 0 10px" }}>
                Carica il file .zip esportato da Articulate, iSpring, Rise, Genially, Adobe Captivate…
                Il completamento e il punteggio vengono tracciati dal contenuto stesso.
              </p>
              {lesson.scorm ? (
                <div className="scorm-info">
                  <span className="pill pill-green">✓ SCORM {lesson.scorm.version}</span>
                  <span style={{ flex: 1 }}>{lesson.scorm.fileName}</span>
                  <span className="hint">avvio: {lesson.scorm.entry}</span>
                  <button className="btn btn-outline btn-sm danger" type="button" disabled={pending}
                    onClick={() => { if (confirm("Rimuovere il pacchetto SCORM da questa lezione?")) run(() => removeScormLesson(courseId, lesson.id)); }}>
                    🗑 Rimuovi
                  </button>
                </div>
              ) : (
                <p className="empty">Nessun pacchetto ancora caricato.</p>
              )}
              <form
                action={async (fd) => {
                  setScormMsg("Caricamento e analisi del pacchetto…");
                  const res = await uploadScormPackage(courseId, lesson.id, fd);
                  setScormMsg(res.ok ? `✓ Pacchetto SCORM ${res.version} caricato.` : `⚠️ ${res.error}`);
                  router.refresh();
                }}
                style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}
              >
                <input type="file" name="scorm" accept=".zip" required style={{ fontSize: 12 }} />
                <button className="btn btn-sm" type="submit">{lesson.scorm ? "Sostituisci pacchetto" : "⬆ Carica pacchetto"}</button>
                {scormMsg && <span className="hint">{scormMsg}</span>}
              </form>
            </div>
          )}

          {(type === "video" || type === "pdf") && (
            <div className="lesson-sub">
              <strong style={{ fontSize: 14 }}>
                {type === "pdf" ? "📄 PDF della lezione" : "📎 Slide e materiali scaricabili"} ({attachments.length})
              </strong>
              <p className="hint" style={{ margin: "4px 0 10px" }}>
                {type === "pdf"
                  ? "Carica il PDF: lo studente lo sfoglia direttamente nella pagina e può scaricarlo."
                  : "Allega le slide del video: lo studente le trova sotto al player e può scaricarle."}
              </p>
              {attachments.length > 0 && (
                <div className="table-wrap" style={{ marginBottom: 10 }}>
                  <table className="data">
                    <tbody>
                      {attachments.map((a) => (
                        <tr key={a.id}>
                          <td style={{ width: 34 }}>{ATTACHMENT_ICON[a.kind]}</td>
                          <td>
                            <a href={a.url} target="_blank" rel="noopener noreferrer">{a.name}</a>
                            {a.sizeKb !== undefined && <span className="hint"> · {a.sizeKb} KB</span>}
                          </td>
                          <td style={{ width: 56 }}>
                            <button className="btn btn-outline btn-sm danger" type="button" disabled={pending}
                              onClick={() => run(() => deleteLessonAttachment(courseId, lesson.id, a.id))}>🗑</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <form
                action={async (fd) => { await addLessonAttachment(courseId, lesson.id, fd); router.refresh(); }}
                style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr auto", gap: 8, alignItems: "end" }}
              >
                <label className="field" style={{ marginBottom: 0 }}>
                  File {type === "pdf" ? "PDF" : "(PDF, PowerPoint…)"}
                  <input type="file" name="attachment"
                    accept={type === "pdf" ? ".pdf" : ".pdf,.ppt,.pptx,.key,.odp,.doc,.docx,.xlsx,.zip"}
                    style={{ marginTop: 4, fontSize: 12 }} />
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  …oppure un link
                  <input type="text" name="attachmentUrl" placeholder="https://…" />
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  Nome mostrato
                  <input type="text" name="attachmentName" placeholder={type === "pdf" ? "es. Dispensa sicurezza" : "es. Slide della lezione"} />
                </label>
                <button className="btn btn-sm" type="submit">➕ Carica</button>
              </form>
            </div>
          )}

          {type === "quiz" && (
            <div className="lesson-sub">
              <strong style={{ fontSize: 14 }}>🧠 Domande del quiz ({questions.length})</strong>
              <p className="hint" style={{ margin: "4px 0 10px" }}>
                Lo studente supera il capitolo con almeno il {passScore}% di risposte corrette.
              </p>
              {questions.map((q, qi) => (
                <div key={q.id} className="quiz-edit">
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                    <strong style={{ flex: 1, fontSize: 13 }}>Domanda {qi + 1}</strong>
                    <button className="btn btn-outline btn-sm danger" type="button" disabled={pending}
                      onClick={() => run(() => deleteLessonQuestion(courseId, lesson.id, q.id))}>🗑</button>
                  </div>
                  <form action={async (fd) => { await saveLessonQuestion(courseId, lesson.id, q.id, fd); router.refresh(); }}>
                    <label className="field">Testo<input type="text" name="text" defaultValue={q.text} required /></label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      {[0, 1, 2, 3].map((oi) => (
                        <label className="field" key={oi} style={{ marginBottom: 6 }}>
                          Risposta {oi + 1}
                          <input type="text" name={`opt${oi}`} defaultValue={q.options[oi] ?? ""} />
                        </label>
                      ))}
                    </div>
                    <label className="field">
                      Risposta corretta
                      <select name="correct" defaultValue={String(q.correct)}>
                        {q.options.map((_, oi) => <option key={oi} value={oi}>Risposta {oi + 1}</option>)}
                      </select>
                    </label>
                    <button className="btn btn-sm" type="submit">💾 Salva domanda</button>
                  </form>
                </div>
              ))}
              <details className="quiz-edit">
                <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13 }}>➕ Aggiungi domanda</summary>
                <form action={async (fd) => { await saveLessonQuestion(courseId, lesson.id, null, fd); router.refresh(); }}
                  style={{ marginTop: 8 }}>
                  <label className="field">Testo<input type="text" name="text" required placeholder="es. Ogni quanto si annaffia?" /></label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[0, 1, 2, 3].map((oi) => (
                      <label className="field" key={oi} style={{ marginBottom: 6 }}>
                        Risposta {oi + 1}
                        <input type="text" name={`opt${oi}`} placeholder={oi < 2 ? "obbligatoria" : "facoltativa"} />
                      </label>
                    ))}
                  </div>
                  <label className="field">
                    Risposta corretta
                    <select name="correct" defaultValue="0">
                      {[0, 1, 2, 3].map((oi) => <option key={oi} value={oi}>Risposta {oi + 1}</option>)}
                    </select>
                  </label>
                  <button className="btn btn-sm" type="submit">➕ Aggiungi</button>
                </form>
              </details>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
