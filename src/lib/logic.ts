import { Course, DB, Progress, User } from "./types";

export const NEW_HIRE_DAYS = 90;

export function isNewHire(user: User): boolean {
  const hired = new Date(user.hireDate).getTime();
  return Date.now() - hired < NEW_HIRE_DAYS * 86400000;
}

/** Un corso è visibile/assegnato a un utente in base a livello, insegna, PV, reparto e stato neoassunto. */
export function courseVisibleTo(course: Course, user: User): boolean {
  if (course.level === "insegna" && course.tenantId !== user.tenantId) return false;
  if (course.level === "punto_vendita" && course.storeId !== user.storeId) return false;
  if (course.departments && course.departments.length > 0) {
    if (!user.departmentId || !course.departments.includes(user.departmentId)) return false;
  }
  if (course.groups && course.groups.length > 0) {
    if (!user.groupIds || !course.groups.some((g) => user.groupIds!.includes(g))) return false;
  }
  if (course.onlyNewHires && !isNewHire(user)) {
    // resta visibile se già iniziato/completato (es. assunto da poco più di 90gg)
    return false;
  }
  return true;
}

export function coursesForUser(db: DB, user: User): Course[] {
  const started = new Set(db.progress.filter((p) => p.userId === user.id).map((p) => p.courseId));
  return db.courses.filter((c) => courseVisibleTo(c, user) || started.has(c.id));
}

export function getProgress(db: DB, userId: string, courseId: string): Progress | undefined {
  return db.progress.find((p) => p.userId === userId && p.courseId === courseId);
}

export function courseCompletion(course: Course, prog?: Progress): number {
  if (!prog) return 0;
  const totalSteps = course.lessons.length + (course.quiz.length > 0 ? 1 : 0);
  let doneSteps = prog.completedLessons.length;
  if (course.quiz.length > 0 && prog.quizPassed) doneSteps += 1;
  return Math.round((doneSteps / totalSteps) * 100);
}

export function isCourseCompleted(course: Course, prog?: Progress): boolean {
  if (!prog) return false;
  const lessonsDone = course.lessons.every((l) => prog.completedLessons.includes(l.id));
  const quizDone = course.quiz.length === 0 || !!prog.quizPassed;
  return lessonsDone && quizDone;
}

export function dueDate(course: Course, user: User): Date | null {
  if (!course.mandatory || !course.dueDays) return null;
  const base = new Date(user.hireDate).getTime();
  const start = Math.max(base, Date.now() - 365 * 86400000);
  return new Date(start + course.dueDays * 86400000);
}

/** Corsi in scadenza: obbligatori non completati con dueDate nel passato o entro 14 giorni. */
export function expiringCourses(db: DB, user: User) {
  return coursesForUser(db, user)
    .filter((c) => c.mandatory && !isCourseCompleted(c, getProgress(db, user.id, c.id)))
    .map((c) => ({ course: c, due: dueDate(c, user) }))
    .filter((x) => x.due !== null)
    .sort((a, b) => a.due!.getTime() - b.due!.getTime());
}

/** Classifica individuale per punto vendita. */
export function storeLeaderboard(db: DB, storeId: string) {
  return db.users
    .filter((u) => u.storeId === storeId && u.role === "student" || (u.storeId === storeId && u.role === "dept_head"))
    .sort((a, b) => b.points - a.points);
}

/** Classifica tra punti vendita: % media di completamento dei corsi obbligatori. */
export function storeRanking(db: DB) {
  return db.stores
    .map((s) => {
      const staff = db.users.filter((u) => u.storeId === s.id);
      let assigned = 0;
      let completed = 0;
      let points = 0;
      for (const u of staff) {
        points += u.points;
        for (const c of db.courses.filter((c) => c.mandatory && courseVisibleTo(c, u))) {
          assigned++;
          if (isCourseCompleted(c, getProgress(db, u.id, c.id))) completed++;
        }
      }
      return {
        store: s,
        tenant: db.tenants.find((t) => t.id === s.tenantId)!,
        staff: staff.length,
        compliance: assigned > 0 ? Math.round((completed / assigned) * 100) : 0,
        points,
      };
    })
    .sort((a, b) => b.compliance - a.compliance || b.points - a.points);
}

/** Ambito visibile a un utente amministrativo. */
export function scopeUsers(db: DB, admin: User): User[] {
  if (admin.role === "system_admin" || admin.role === "course_manager") return db.users;
  if (admin.role === "group_admin") return db.users.filter((u) => u.tenantId === admin.tenantId);
  if (admin.role === "store_admin") return db.users.filter((u) => u.storeId === admin.storeId);
  if (admin.role === "dept_head")
    return db.users.filter((u) => u.storeId === admin.storeId && u.departmentId === admin.departmentId);
  return [admin];
}

export function scopeCourses(db: DB, admin: User): Course[] {
  if (admin.role === "system_admin" || admin.role === "course_manager") return db.courses;
  if (admin.role === "group_admin")
    return db.courses.filter((c) => c.level === "sistema" || c.tenantId === admin.tenantId);
  return db.courses.filter(
    (c) => c.level === "sistema" || c.tenantId === admin.tenantId || c.storeId === admin.storeId
  );
}

export interface CourseStats {
  course: Course;
  enrolled: number;
  completed: number;
  inProgress: number;
  avgScore: number | null;
  avgRating: number | null;
}

export function courseStats(db: DB, admin: User): CourseStats[] {
  const users = scopeUsers(db, admin);
  return scopeCourses(db, admin).map((course) => {
    const audience = users.filter((u) => courseVisibleTo(course, u));
    let completed = 0;
    let inProgress = 0;
    const scores: number[] = [];
    for (const u of audience) {
      const p = getProgress(db, u.id, course.id);
      if (isCourseCompleted(course, p)) completed++;
      else if (p && p.completedLessons.length > 0) inProgress++;
      if (p?.quizScore !== undefined) scores.push(p.quizScore);
    }
    const ratings = db.feedback.filter((f) => f.courseId === course.id).map((f) => f.rating);
    return {
      course,
      enrolled: audience.length,
      completed,
      inProgress,
      avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      avgRating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
    };
  });
}

export function kpis(db: DB, admin: User) {
  const users = scopeUsers(db, admin);
  const stats = courseStats(db, admin);
  const totAssigned = stats.reduce((a, s) => a + s.enrolled, 0);
  const totCompleted = stats.reduce((a, s) => a + s.completed, 0);
  const certs = db.certificates.filter((c) => users.some((u) => u.id === c.userId));
  return {
    users: users.length,
    courses: stats.length,
    completionRate: totAssigned ? Math.round((totCompleted / totAssigned) * 100) : 0,
    certificates: certs.length,
    activeLearners: new Set(db.progress.filter((p) => users.some((u) => u.id === p.userId)).map((p) => p.userId)).size,
  };
}
