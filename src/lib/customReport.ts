import { courseCompletion, coursesForUser, getProgress, hasStartedCourse, isCourseCompleted, scopeUsers } from "./logic";
import { DB, User } from "./types";

export type ReportColumn =
  | "collaboratore" | "insegna" | "punto_vendita" | "reparto" | "corso"
  | "assegnato" | "stato" | "percento" | "minuti" | "punteggio" | "completato";

export const REPORT_COLUMNS: { key: ReportColumn; label: string }[] = [
  { key: "collaboratore", label: "Collaboratore" },
  { key: "insegna", label: "Insegna" },
  { key: "punto_vendita", label: "Punto vendita" },
  { key: "reparto", label: "Reparto" },
  { key: "corso", label: "Corso" },
  { key: "assegnato", label: "Assegnato il" },
  { key: "stato", label: "Stato" },
  { key: "percento", label: "% visto" },
  { key: "minuti", label: "Minuti visti" },
  { key: "punteggio", label: "Punteggio quiz" },
  { key: "completato", label: "Completato il" },
];

export const DEFAULT_REPORT_COLUMNS: ReportColumn[] = ["collaboratore", "corso", "stato", "percento", "punteggio"];

export const STATO_LABELS: Record<string, string> = {
  completato: "✓ Completato",
  in_corso: "In corso",
  non_iniziato: "Non iniziato",
};

export interface ReportRow {
  userId: string;
  collaboratore: string;
  insegna: string;
  punto_vendita: string;
  reparto: string;
  corso: string;
  assegnato: string;
  stato: "completato" | "in_corso" | "non_iniziato";
  percento: number;
  minuti: number;
  punteggio: string;
  completato: string;
}

export interface ReportFilters {
  reparto?: string;
  insegna?: string;
  corso?: string;
  stato?: string;
}

/** Righe collaboratore × corso, una per corso assegnato: base del report personalizzato. */
export function buildReportRows(db: DB, admin: User, filters: ReportFilters): ReportRow[] {
  const users = scopeUsers(db, admin).filter((u) => u.role === "student" || u.role === "dept_head");
  const rows: ReportRow[] = [];

  for (const u of users) {
    if (filters.reparto && u.departmentId !== filters.reparto) continue;
    if (filters.insegna && u.tenantId !== filters.insegna) continue;
    const tenant = db.tenants.find((t) => t.id === u.tenantId);
    const store = db.stores.find((s) => s.id === u.storeId);
    const dept = db.departments.find((d) => d.id === u.departmentId);

    for (const c of coursesForUser(db, u)) {
      if (filters.corso && c.id !== filters.corso) continue;
      const prog = getProgress(db, u.id, c.id);
      const stato: ReportRow["stato"] = isCourseCompleted(c, prog)
        ? "completato"
        : hasStartedCourse(db, u.id, c.id)
          ? "in_corso"
          : "non_iniziato";
      if (filters.stato && stato !== filters.stato) continue;
      const minuti = Math.round((prog?.views ?? []).reduce((a, v) => a + v.secondsWatched, 0) / 60);
      const assignedAt = db.assignments.find((a) => a.userId === u.id && a.courseId === c.id)?.assignedAt;

      rows.push({
        userId: u.id,
        collaboratore: `${u.lastName} ${u.firstName}`,
        insegna: tenant?.name ?? "—",
        punto_vendita: store?.name ?? "—",
        reparto: dept?.name ?? "—",
        corso: c.title,
        assegnato: assignedAt ? new Date(assignedAt).toLocaleDateString("it-IT") : "—",
        stato,
        percento: courseCompletion(c, prog),
        minuti,
        punteggio: prog?.quizScore !== undefined ? `${prog.quizScore}%` : "—",
        completato: prog?.completedAt ? new Date(prog.completedAt).toLocaleDateString("it-IT") : "—",
      });
    }
  }
  return rows.sort((a, b) => a.collaboratore.localeCompare(b.collaboratore) || a.corso.localeCompare(b.corso));
}

export function parseColumns(raw: string[] | string | undefined): ReportColumn[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const valid = list.filter((c): c is ReportColumn => REPORT_COLUMNS.some((rc) => rc.key === c));
  return valid.length > 0 ? valid : DEFAULT_REPORT_COLUMNS;
}

export function rowsToCsv(rows: ReportRow[], columns: ReportColumn[]): string {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const header = columns.map((c) => esc(REPORT_COLUMNS.find((rc) => rc.key === c)!.label)).join(";");
  const body = rows
    .map((r) => columns.map((c) => esc(c === "stato" ? STATO_LABELS[r.stato] : c === "percento" ? `${r[c]}%` : r[c])).join(";"))
    .join("\n");
  return `${header}\n${body}`;
}
