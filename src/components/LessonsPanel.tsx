"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import LessonEditor from "./LessonEditor";
import { addLesson } from "@/lib/actions";
import { LESSON_TYPES, Lesson, LessonType } from "@/lib/types";

/**
 * Elenco delle lezioni con i pulsanti per aggiungerne di nuove sempre in vista,
 * sia sopra sia sotto l'elenco.
 */
export default function LessonsPanel({
  courseId,
  lessons,
  passScore,
}: {
  courseId: string;
  lessons: Lesson[];
  passScore: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const add = (type: LessonType) =>
    startTransition(async () => {
      await addLesson(courseId, type);
      router.refresh();
    });

  const AddButtons = () => (
    <div className="add-lesson-bar">
      <span style={{ fontWeight: 700, fontSize: 13 }}>➕ Aggiungi:</span>
      {LESSON_TYPES.map((t) => (
        <button key={t.value} className="btn btn-sm" type="button" disabled={pending}
          onClick={() => add(t.value)} title={t.hint}>
          {t.label}
        </button>
      ))}
      {pending && <span className="hint">creazione in corso…</span>}
    </div>
  );

  return (
    <div>
      <AddButtons />
      {lessons.length === 0 && (
        <div className="card"><p className="empty">Nessuna lezione: aggiungine una con i pulsanti qui sopra.</p></div>
      )}
      <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 10 }}>
        {lessons.map((l, i) => (
          <LessonEditor key={l.id} courseId={courseId} lesson={l} index={i} total={lessons.length} passScore={passScore} />
        ))}
      </div>
      {lessons.length > 2 && <AddButtons />}
    </div>
  );
}
