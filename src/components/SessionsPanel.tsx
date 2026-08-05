"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveCourseSession, deleteCourseSession, sendSessionInvites } from "@/lib/actions";
import { CourseSession } from "@/lib/types";

function fmt(d: string) {
  const [y, m, g] = d.split("-");
  return `${g}/${m}/${y}`;
}

/** Edizioni in calendario del corso: date, Zoom/aula e convocazioni via email. */
export default function SessionsPanel({
  courseId,
  sessions,
  recipients,
}: {
  courseId: string;
  sessions: CourseSession[];
  recipients: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

  async function onSave(sessionId: string | null, fd: FormData) {
    const res = await saveCourseSession(courseId, sessionId, fd);
    setMsg(
      res.ok
        ? res.invited > 0
          ? `✓ Edizione salvata e convocazione inviata a ${res.invited} persone.`
          : "✓ Edizione salvata."
        : `${res.error}`
    );
    if (res.ok) setEditing(null);
    router.refresh();
    setTimeout(() => setMsg(""), 4000);
  }

  const SessionForm = ({ s }: { s?: CourseSession }) => (
    <form action={(fd) => onSave(s?.id ?? null, fd)} className="session-form">
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr .8fr .8fr 1fr", gap: 10 }}>
        <label className="field">Data<input type="date" name="date" defaultValue={s?.date ?? ""} required /></label>
        <label className="field">Ora inizio<input type="time" name="time" defaultValue={s?.time ?? "09:00"} required /></label>
        <label className="field">Ora fine<input type="time" name="endTime" defaultValue={s?.endTime ?? ""} /></label>
        <label className="field">
          Modalità
          <select name="mode" defaultValue={s?.mode ?? "online"}>
            <option value="online">Online (Zoom/Teams)</option>
            <option value="aula">In aula</option>
          </select>
        </label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 10 }}>
        <label className="field">
          Link Zoom / Teams
          <input type="text" name="zoomUrl" defaultValue={s?.zoomUrl ?? ""} placeholder="https://zoom.us/j/…" />
        </label>
        <label className="field">
          Sede / aula (se in presenza)
          <input type="text" name="location" defaultValue={s?.location ?? ""} placeholder="es. Sede Rosàflor, sala corsi" />
        </label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 160px", gap: 10 }}>
        <label className="field">Docente<input type="text" name="trainer" defaultValue={s?.trainer ?? ""} /></label>
        <label className="field">Note<input type="text" name="notes" defaultValue={s?.notes ?? ""} placeholder="es. portare il quaderno" /></label>
        <label className="field">
          Promemoria
          <select name="reminderDays" defaultValue={String(s?.reminderDays ?? 3)}>
            {[1, 2, 3, 5, 7, 14].map((d) => <option key={d} value={d}>{d} giorni prima</option>)}
          </select>
        </label>
      </div>
      <label className="checkbox-row">
        <input type="checkbox" name="convoca" defaultChecked={!s} />
        Invia subito la convocazione ai {recipients} destinatari del corso
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-sm" type="submit">{s ? "Salva modifiche" : "Programma l'edizione"}</button>
        {s && <button className="btn btn-outline btn-sm" type="button" onClick={() => setEditing(null)}>Annulla</button>}
      </div>
    </form>
  );

  return (
    <div>
      {msg && <div className={`alert ${msg.startsWith("✓") ? "alert-green" : "alert-amber"}`}>{msg}</div>}

      {sessions.length > 0 && (
        <div className="card table-wrap" style={{ marginBottom: 12 }}>
          <table className="data">
            <thead>
              <tr><th>Quando</th><th>Dove</th><th>Convocazione</th><th></th></tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} style={s.date < today ? { opacity: 0.55 } : undefined}>
                  <td>
                    <strong>{fmt(s.date)}</strong> · {s.time}{s.endTime ? `–${s.endTime}` : ""}
                    {s.date < today && <span className="pill pill-gray" style={{ marginLeft: 6 }}>passata</span>}
                    {s.trainer && <div className="hint">docente: {s.trainer}</div>}
                  </td>
                  <td style={{ fontSize: 13 }}>
                    {s.mode === "online" ? "Online" : `${s.location || "In aula"}`}
                    {s.zoomUrl && (
                      <div><a href={s.zoomUrl} target="_blank" rel="noopener noreferrer">apri il collegamento</a></div>
                    )}
                  </td>
                  <td style={{ fontSize: 12.5 }}>
                    {s.invitedAt
                      ? <span className="pill pill-green">✓ inviata il {new Date(s.invitedAt).toLocaleDateString("it-IT")}</span>
                      : <span className="pill pill-amber">non ancora inviata</span>}
                    <div className="hint">
                      {s.reminderSentAt
                        ? `promemoria inviato il ${new Date(s.reminderSentAt).toLocaleDateString("it-IT")}`
                        : `promemoria automatico ${s.reminderDays} giorni prima`}
                    </div>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn btn-outline btn-sm" type="button" disabled={pending}
                      onClick={() => run(() => sendSessionInvites(courseId, s.id))}
                      title="Invia (o rinvia) la convocazione a tutti i destinatari">Convoca</button>{" "}
                    <button className="btn btn-outline btn-sm" type="button"
                      onClick={() => setEditing(editing === s.id ? null : s.id)}>Modifica</button>{" "}
                    <button className="btn btn-outline btn-sm danger" type="button" disabled={pending} title="Elimina questa edizione"
                      onClick={() => { if (confirm("Eliminare questa edizione dal calendario?")) run(() => deleteCourseSession(courseId, s.id)); }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && sessions.find((s) => s.id === editing) && (
        <div className="card" style={{ marginBottom: 12, border: "2px solid var(--green-500)" }}>
          <h3 style={{ marginTop: 0 }}>Modifica edizione</h3>
          <SessionForm s={sessions.find((s) => s.id === editing)} />
        </div>
      )}

      <div className="card" style={{ background: "var(--green-50)" }}>
        <h3 style={{ marginTop: 0 }}>Programma una nuova edizione</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          La convocazione contiene titolo, descrizione, data, ora e link del corso e parte subito;
          il promemoria automatico viene inviato nei giorni indicati prima della data.
        </p>
        <SessionForm />
      </div>
    </div>
  );
}
