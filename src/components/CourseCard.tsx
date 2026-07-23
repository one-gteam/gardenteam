import Link from "next/link";
import { Course, Progress, LEVEL_LABELS } from "@/lib/types";
import { courseCompletion, isCourseCompleted } from "@/lib/logic";

export default function CourseCard({
  course,
  prog,
  due,
}: {
  course: Course;
  prog?: Progress;
  due?: Date | null;
}) {
  const pct = courseCompletion(course, prog);
  const completed = isCourseCompleted(course, prog);
  const overdue = due && !completed && due.getTime() < Date.now();
  const totalMin = course.lessons.reduce((a, l) => a + l.minutes, 0);

  return (
    <Link href={`/corso/${course.id}`} style={{ textDecoration: "none", color: "inherit" }}>
      <div className="card course-card" style={{ height: "100%", ...(course.coverUrl ? { paddingTop: 0, overflow: "hidden" } : {}) }}>
        {course.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={course.coverUrl}
            alt=""
            style={{ margin: "0 -20px", width: "calc(100% + 40px)", maxWidth: "none", height: 120, objectFit: "cover" }}
          />
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          {!course.coverUrl && <span className="course-emoji">{course.emoji}</span>}
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {completed && <span className="pill pill-green">✓ Completato</span>}
            {!completed && course.mandatory && <span className="pill pill-red">Obbligatorio</span>}
            {overdue && <span className="pill pill-red">In ritardo!</span>}
          </div>
        </div>
        <div>
          <div className="course-title">{course.title}</div>
          <div className="course-meta" style={{ marginTop: 5 }}>
            <span className="pill pill-blue">{LEVEL_LABELS[course.level]}</span>
            <span className="pill pill-gray">{course.category}</span>
            <span className="pill pill-gray">⏱ {totalMin} min</span>
            <span className="pill pill-amber">+{course.points} pt</span>
          </div>
        </div>
        <div className="course-desc">{course.description}</div>
        <div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="progress-label">
            {pct}% completato
            {due && !completed && (
              <span style={{ color: overdue ? "var(--red)" : "var(--amber)", fontWeight: 700 }}>
                {" "}
                · scadenza {due.toLocaleDateString("it-IT")}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
