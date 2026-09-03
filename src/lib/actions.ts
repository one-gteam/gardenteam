"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { getDb, saveDb } from "./db";
import { uploadPublicFile } from "./supabase";
import { mailerConfig, sendMail } from "./mailer";
import { AUTH_COOKIE, requireUser } from "./auth";
import { assignableRolesFor, canManageUsers, coursesForUser, courseVisibleTo, dueDate, getProgress, hasStartedCourse, isCourseCompleted, pathsForUser } from "./logic";
import {
  Course, CourseLevel, CourseSession, DB, DEFAULT_HOME_BLOCKS, DEFAULT_REMINDER_RULES, DEFAULT_WATCH_THRESHOLD,
  EmailType, Lesson, LessonAttachment, LessonType, ReminderRule, ReminderStage, Role, SiteId, User, postLoginPath,
} from "./types";

/** Sostituisce variabili {{...}} e declina il genere: [maschile|femminile]. */
function renderText(s: string, user: User, vars: Record<string, string>): string {
  const all: Record<string, string> = { nome: user.firstName, cognome: user.lastName, ...vars };
  return s
    .replace(/\{\{(\w+)\}\}/g, (_, k: string) => all[k] ?? "")
    .replace(/\[([^\[\]|]+)\|([^\[\]|]+)\]/g, (_, m: string, f: string) => (user.gender === "f" ? f : m));
}

/**
 * Risolve il modello email: punto vendita → insegna → sistema.
 * L'automazione (attiva/disattivata) è governata SOLO dal modello di sistema (admin di sistema).
 */
function renderTemplate(db: DB, user: User, type: EmailType, vars: Record<string, string>) {
  const global = db.templates.find((t) => t.type === type && !t.tenantId && !t.storeId);
  if (!global || !global.enabled) return null;
  const tpl =
    db.templates.find((t) => t.type === type && t.storeId && t.storeId === user.storeId) ??
    db.templates.find((t) => t.type === type && t.tenantId && !t.storeId && t.tenantId === user.tenantId) ??
    global;
  return { subject: renderText(tpl.subject, user, vars), body: renderText(tpl.body, user, vars) };
}

/**
 * Spedisce davvero (Resend) e registra sempre nel registro invii: il log interno
 * resta la fonte di verità dell'applicazione anche quando il provider non è
 * configurato (stato "in_coda") o rifiuta il messaggio (stato "errore").
 */
async function pushEmail(db: DB, user: User, type: EmailType, subject: string, body: string) {
  const r = await sendMail(user.email, subject, body);
  db.emails.push({
    id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId: user.id,
    to: user.email,
    subject,
    body,
    type,
    date: new Date().toISOString(),
    status: r.sent === true ? "inviata" : r.sent === false ? "errore" : "in_coda",
    ...(r.error ? { error: r.error } : {}),
  });
}

/**
 * Invia il modello di sistema (o la personalizzazione insegna/PV) più gli eventuali
 * modelli aggiuntivi collegati alla stessa automazione, se nello scope dell'utente.
 */
async function queueEmail(db: DB, user: User, type: EmailType, vars: Record<string, string> = {}) {
  const r = renderTemplate(db, user, type, vars);
  if (r) await pushEmail(db, user, type, r.subject, r.body);
  for (const ct of db.customTemplates) {
    if (ct.trigger !== type || !ct.enabled) continue;
    if (ct.storeId && ct.storeId !== user.storeId) continue;
    if (ct.tenantId && !ct.storeId && ct.tenantId !== user.tenantId) continue;
    await pushEmail(db, user, type, renderText(ct.subject, user, vars), renderText(ct.body, user, vars));
  }
}

/**
 * Iscrizione automatica per regola: appena un corso obbligatorio o un percorso
 * diventa assegnato a un utente (nuovo assunto, cambio reparto/insegna, nuovo
 * corso creato...) parte una mail di assegnazione, una volta sola per elemento.
 * Ritorna true se ha inviato qualcosa (utile per contare gli invii dal chiamante).
 */
async function notifyNewAssignments(db: DB, user: User): Promise<boolean> {
  const newCourses = coursesForUser(db, user).filter(
    (c) => c.mandatory && !(user.notifiedCourseIds ?? []).includes(c.id)
  );
  const newPaths = pathsForUser(db, user).filter((p) => !(user.notifiedPathIds ?? []).includes(p.id));
  if (newCourses.length === 0 && newPaths.length === 0) return false;

  const elenco = [
    ...newCourses.map((c) => `«${c.title}»`),
    ...newPaths.map((p) => `percorso «${p.title}»`),
  ].join(", ");
  await queueEmail(db, user, "assegnazione", { corso: newCourses[0]?.title ?? newPaths[0]?.title ?? "", elenco });
  user.notifiedCourseIds = [...(user.notifiedCourseIds ?? []), ...newCourses.map((c) => c.id)];
  user.notifiedPathIds = [...(user.notifiedPathIds ?? []), ...newPaths.map((p) => p.id)];
  const today = new Date().toISOString().slice(0, 10);
  for (const c of newCourses) {
    if (!db.assignments.some((a) => a.userId === user.id && a.courseId === c.id)) {
      db.assignments.push({ userId: user.id, courseId: c.id, assignedAt: today });
    }
  }
  return true;
}

/** Da quando risulta assegnato il più vecchio dei corsi passati (fallback: oggi, se non tracciato). */
function earliestAssignedAt(db: DB, userId: string, courses: Course[]): string {
  const today = new Date().toISOString().slice(0, 10);
  return courses.reduce((min, c) => {
    const a = db.assignments.find((x) => x.userId === userId && x.courseId === c.id)?.assignedAt ?? today;
    return !min || a < min ? a : min;
  }, "");
}

function reminderRuleFor(db: DB, stage: ReminderStage): ReminderRule {
  return db.settings.reminderRules?.[stage] ?? DEFAULT_REMINDER_RULES[stage];
}

/** Rispetta attesa iniziale, intervallo minimo fra invii e numero massimo di ripetizioni dello stadio. */
function canSendStage(db: DB, user: User, type: EmailType, rule: ReminderRule, since: string): boolean {
  const previous = db.emails.filter((e) => e.userId === user.id && e.type === type).sort((a, b) => a.date.localeCompare(b.date));
  if (rule.maxRepeats > 0 && previous.length >= rule.maxRepeats) return false;
  const daysSince = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (previous.length === 0) return daysSince(since) >= rule.waitDays;
  return daysSince(previous[previous.length - 1].date) >= rule.intervalDays;
}

/**
 * Login/iscrizione via SSO da My Rosaflor: se l'email non esiste ancora la
 * crea (reparto abbinato per nome, insegna/PV di default configurati in
 * Organizzazione → Consorzio), altrimenti fa accedere l'account esistente.
 * La verifica del token (firma/scadenza) avviene nella route /sso, PRIMA di
 * chiamare questa funzione: qui i dati sono già considerati fidati.
 */
export async function provisionSsoUser(payload: {
  email: string;
  nome: string;
  cognome: string;
  reparto?: string;
  assunzione?: string;
}): Promise<{ ok: true; userId: string } | { ok: false; reason: "disattivato" }> {
  const db = await getDb();
  const email = payload.email.toLowerCase().trim();
  let user = db.users.find((u) => u.email.toLowerCase() === email);

  if (!user) {
    const dept = payload.reparto
      ? db.departments.find((d) => d.name.toLowerCase() === payload.reparto!.toLowerCase())
      : undefined;
    // senza data di assunzione nota, un anno fa: non deve risultare "neoassunto" per errore
    const unAnnoFa = new Date(Date.now() - 366 * 86400000).toISOString().slice(0, 10);
    user = {
      id: `u_sso_${Date.now()}`,
      firstName: payload.nome || "Collaboratore",
      lastName: payload.cognome || "",
      email,
      role: "student",
      tenantId: db.settings.ssoDefaultTenantId,
      storeId: db.settings.ssoDefaultStoreId,
      departmentId: dept?.id,
      jobTitle: payload.reparto,
      hireDate: /^\d{4}-\d{2}-\d{2}$/.test(payload.assunzione ?? "") ? payload.assunzione! : unAnnoFa,
      points: 0,
      badges: [],
      active: true,
    };
    db.users.push(user);
    await queueEmail(db, user, "benvenuto");
    await notifyNewAssignments(db, user);
    await saveDb(db);
  }

  if (!user.active) return { ok: false, reason: "disattivato" };
  return { ok: true, userId: user.id };
}

export async function saveSsoDefaults(formData: FormData) {
  const admin = await requireUser();
  if (admin.role !== "system_admin") redirect("/admin");
  const db = await getDb();
  db.settings.ssoDefaultTenantId = String(formData.get("ssoDefaultTenantId") ?? "") || undefined;
  db.settings.ssoDefaultStoreId = String(formData.get("ssoDefaultStoreId") ?? "") || undefined;
  await saveDb(db);
  redirect("/admin/organizzazione/consorzio?salvato=1");
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  return timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}

function canEditCourse(admin: User, course: Course): boolean {
  if (admin.role === "system_admin" || admin.role === "course_manager") return true;
  if (admin.role === "group_admin") return course.level !== "sistema" && course.tenantId === admin.tenantId;
  if (admin.role === "store_admin") return course.level === "punto_vendita" && course.storeId === admin.storeId;
  return false;
}

async function requireEditableCourse(courseId: string) {
  const admin = await requireUser();
  const db = await getDb();
  const course = db.courses.find((c) => c.id === courseId);
  if (!course || !canEditCourse(admin, course)) redirect("/admin/corsi");
  return { admin, db, course: course! };
}

export async function logout() {
  const store = await cookies();
  store.delete(AUTH_COOKIE);
  redirect("/login");
}

function awardBadges(db: DB, userId: string) {
  const user = db.users.find((u) => u.id === userId)!;
  const completedCount = db.progress.filter((p) => {
    if (p.userId !== userId) return false;
    const c = db.courses.find((x) => x.id === p.courseId);
    return c && isCourseCompleted(c, p);
  }).length;
  const add = (b: string) => {
    if (!user.badges.includes(b)) user.badges.push(b);
  };
  if (completedCount >= 1) add("primo_corso");
  if (completedCount >= 3) add("tre_corsi");
  if (completedCount >= 5) add("cinque_corsi");
  const onboarding = db.progress.find((p) => p.userId === userId && p.courseId === "c1");
  const c1 = db.courses.find((c) => c.id === "c1");
  if (onboarding && c1 && isCourseCompleted(c1, onboarding)) add("onboarding");
  if (db.progress.some((p) => p.userId === userId && p.quizScore === 100)) add("quiz_perfetto");
}

async function maybeComplete(db: DB, userId: string, course: Course) {
  const prog = db.progress.find((p) => p.userId === userId && p.courseId === course.id)!;
  if (isCourseCompleted(course, prog) && !prog.completedAt) {
    prog.completedAt = new Date().toISOString();
    const user = db.users.find((u) => u.id === userId)!;
    user.points += course.points;
    if (!db.certificates.some((c) => c.userId === userId && c.courseId === course.id)) {
      db.certificates.push({
        id: `cert_${Date.now()}_${userId}`,
        userId,
        courseId: course.id,
        issuedAt: new Date().toISOString(),
      });
      await queueEmail(db, user, "certificato", { corso: course.title });
    }
    await queueEmail(db, user, "completamento", { corso: course.title, punti: String(course.points) });
    awardBadges(db, userId);
  }
}

/**
 * Registra quanto lo studente ha effettivamente guardato di una lezione video.
 * Viene chiamata dal player mentre il video scorre: tiene il punto più avanzato
 * raggiunto e i secondi realmente riprodotti (i salti in avanti non contano).
 * Al superamento della soglia la lezione risulta completata da sola.
 */
export async function trackLessonView(
  courseId: string,
  lessonId: string,
  data: { maxPercent: number; secondsWatched: number; durationSec?: number }
) {
  const user = await requireUser();
  const db = await getDb();
  const course = db.courses.find((c) => c.id === courseId);
  if (!course || !course.lessons.some((l) => l.id === lessonId)) return { ok: false as const };

  let prog = db.progress.find((p) => p.userId === user.id && p.courseId === courseId);
  if (!prog) {
    prog = { userId: user.id, courseId, completedLessons: [] };
    db.progress.push(prog);
  }
  prog.views = prog.views ?? [];
  const now = new Date().toISOString();
  let view = prog.views.find((v) => v.lessonId === lessonId);
  if (!view) {
    view = { lessonId, maxPercent: 0, secondsWatched: 0, firstAt: now, lastAt: now };
    prog.views.push(view);
  }
  view.maxPercent = Math.min(100, Math.max(view.maxPercent, Math.round(data.maxPercent)));
  view.secondsWatched = Math.max(view.secondsWatched, Math.round(data.secondsWatched));
  if (data.durationSec) view.durationSec = Math.round(data.durationSec);
  view.lastAt = now;

  /*
   * Il completamento si basa sul tempo davvero riprodotto rispetto alla durata,
   * non sul punto più avanzato raggiunto: così trascinare la barra fino in fondo
   * non basta a far risultare il video visto.
   */
  const threshold = db.settings.watchThreshold ?? DEFAULT_WATCH_THRESHOLD;
  const seenPercent = view.durationSec ? (view.secondsWatched / view.durationSec) * 100 : 0;
  let justCompleted = false;
  if (seenPercent >= threshold && !view.completedByWatch) {
    view.completedByWatch = true;
    if (!prog.completedLessons.includes(lessonId)) {
      prog.completedLessons.push(lessonId);
      const u = db.users.find((x) => x.id === user.id);
      if (u) u.points += 10;
      justCompleted = true;
    }
    await maybeComplete(db, user.id, course);
  }
  await saveDb(db);
  if (justCompleted) revalidatePath(`/corso/${courseId}`);
  return {
    ok: true as const,
    seenPercent: Math.min(100, Math.round(seenPercent)),
    maxPercent: view.maxPercent,
    completed: view.completedByWatch === true,
    justCompleted,
  };
}

export async function completeLesson(courseId: string, lessonId: string) {
  const user = await requireUser();
  const db = await getDb();
  const course = db.courses.find((c) => c.id === courseId);
  if (!course) return;
  let prog = db.progress.find((p) => p.userId === user.id && p.courseId === courseId);
  if (!prog) {
    prog = { userId: user.id, courseId, completedLessons: [] };
    db.progress.push(prog);
  }
  if (!prog.completedLessons.includes(lessonId)) {
    prog.completedLessons.push(lessonId);
    const u = db.users.find((x) => x.id === user.id)!;
    u.points += 10;
  }
  await maybeComplete(db, user.id, course);
  await saveDb(db);
  revalidatePath(`/corso/${courseId}`);
  revalidatePath("/studente");
}

export async function submitQuiz(courseId: string, formData: FormData) {
  const user = await requireUser();
  const db = await getDb();
  const course = db.courses.find((c) => c.id === courseId);
  if (!course || course.quiz.length === 0) redirect(`/corso/${courseId}`);
  let correct = 0;
  for (const q of course.quiz) {
    const answer = formData.get(q.id);
    if (answer !== null && Number(answer) === q.correct) correct++;
  }
  const score = Math.round((correct / course.quiz.length) * 100);
  const passed = score >= course.passScore;
  let prog = db.progress.find((p) => p.userId === user.id && p.courseId === courseId);
  if (!prog) {
    prog = { userId: user.id, courseId, completedLessons: [] };
    db.progress.push(prog);
  }
  prog.quizScore = score;
  if (passed) {
    prog.quizPassed = true;
    const u = db.users.find((x) => x.id === user.id)!;
    u.points += 30;
  }
  await maybeComplete(db, user.id, course);
  awardBadges(db, user.id);
  await saveDb(db);
  redirect(`/corso/${courseId}/quiz?esito=${score}`);
}

export async function sendFeedback(courseId: string, formData: FormData) {
  const user = await requireUser();
  const db = await getDb();
  const rating = Number(formData.get("rating") ?? 0);
  const comment = String(formData.get("comment") ?? "").slice(0, 500);
  if (rating >= 1 && rating <= 5) {
    db.feedback.push({
      id: `f_${Date.now()}`,
      userId: user.id,
      courseId,
      rating,
      comment,
      date: new Date().toISOString().slice(0, 10),
    });
    await saveDb(db);
  }
  revalidatePath(`/corso/${courseId}`);
}

export async function importUsersCsv(formData: FormData) {
  const admin = await requireUser();
  const db = await getDb();
  const raw = String(formData.get("csv") ?? "").trim();
  if (!raw) redirect("/admin/utenti?import=0");

  const isAdmin = ["system_admin", "group_admin", "store_admin"].includes(admin.role) && canManageUsers(db, admin);
  if (!isAdmin) redirect("/admin/utenti?import=0");

  let imported = 0;
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  for (const line of lines) {
    const parts = line.split(/[;,]/).map((p) => p.trim());
    if (parts.length < 3) continue;
    if (/^nome/i.test(parts[0])) continue; // intestazione
    const [firstName, lastName, email, deptName = "", jobTitle = "", hireDate = "", genderCol = ""] = parts;
    if (!email.includes("@")) continue;
    if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) continue;
    const dept = db.departments.find((d) => d.name.toLowerCase().includes(deptName.toLowerCase()) && deptName);
    const newUser: User = {
      id: `u_${Date.now()}_${imported}`,
      firstName,
      lastName,
      email,
      role: "student",
      tenantId: admin.tenantId ?? db.tenants[0].id,
      storeId: admin.storeId ?? db.stores.find((s) => s.tenantId === (admin.tenantId ?? db.tenants[0].id))?.id,
      departmentId: dept?.id,
      jobTitle: jobTitle || "Addetto vendita",
      hireDate: /^\d{4}-\d{2}-\d{2}$/.test(hireDate) ? hireDate : new Date().toISOString().slice(0, 10),
      points: 0,
      badges: [],
      active: true,
      gender: /^f/i.test(genderCol) ? "f" : /^m/i.test(genderCol) ? "m" : undefined,
    };
    db.users.push(newUser);
    await queueEmail(db, newUser, "benvenuto");
    await notifyNewAssignments(db, newUser);
    imported++;
  }
  await saveDb(db);
  redirect(`/admin/utenti?import=${imported}`);
}

export async function createCourse(formData: FormData) {
  const admin = await requireUser();
  const db = await getDb();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) redirect("/admin/corsi");
  const level = String(formData.get("level") ?? "sistema") as CourseLevel;
  const dept = String(formData.get("department") ?? "");
  const canSystem = admin.role === "system_admin" || admin.role === "course_manager";
  const course: Course = {
    id: `c_${Date.now()}`,
    title,
    description: String(formData.get("description") ?? ""),
    category: String(formData.get("category") ?? "Generale") || "Generale",
    emoji: "📚",
    level: canSystem ? level : level === "sistema" ? "insegna" : level,
    tenantId: level !== "sistema" ? admin.tenantId ?? db.tenants[0].id : undefined,
    storeId: level === "punto_vendita" ? admin.storeId ?? undefined : undefined,
    departments: dept ? [dept] : undefined,
    onlyNewHires: formData.get("newHires") === "on",
    mandatory: formData.get("mandatory") === "on",
    dueDays: formData.get("mandatory") === "on" ? 60 : undefined,
    passScore: 70,
    points: 80,
    lessons: [
      {
        id: `l_${Date.now()}`,
        title: "Introduzione al corso",
        type: "pdf",
        minutes: 5,
        content: "Contenuto in preparazione: il gestore dei corsi caricherà qui video, slide e materiali.",
      },
    ],
    quiz: [],
  };
  db.courses.push(course);
  await saveDb(db);
  redirect(`/admin/corsi/${course.id}?creato=1`);
}

export async function updateCourse(courseId: string, formData: FormData) {
  const { admin, db, course } = await requireEditableCourse(courseId);
  const title = String(formData.get("title") ?? "").trim();
  if (title) course.title = title;
  course.description = String(formData.get("description") ?? "");
  course.category = String(formData.get("category") ?? "").trim() || "Generale";
  const emoji = String(formData.get("emoji") ?? "").trim();
  if (emoji) course.emoji = emoji.slice(0, 4);

  const canSystem = admin.role === "system_admin" || admin.role === "course_manager";
  const level = String(formData.get("level") ?? course.level) as CourseLevel;
  if (level === "sistema" && canSystem) {
    course.level = "sistema";
    course.tenantId = undefined;
    course.storeId = undefined;
  } else if (level === "insegna") {
    course.level = "insegna";
    course.tenantId = course.tenantId ?? admin.tenantId ?? db.tenants[0].id;
    course.storeId = undefined;
  } else if (level === "punto_vendita") {
    course.level = "punto_vendita";
    course.tenantId = course.tenantId ?? admin.tenantId ?? db.tenants[0].id;
    course.storeId = course.storeId ?? admin.storeId ?? db.stores.find((s) => s.tenantId === course.tenantId)?.id;
  }

  const dept = String(formData.get("department") ?? "");
  course.departments = dept ? [dept] : undefined;
  const group = String(formData.get("group") ?? "");
  course.groups = group ? [group] : undefined;
  course.onlyNewHires = formData.get("newHires") === "on";
  course.mandatory = formData.get("mandatory") === "on";
  course.sequential = formData.get("sequential") === "on";
  const dueDays = Number(formData.get("dueDays"));
  course.dueDays = course.mandatory && dueDays > 0 ? dueDays : undefined;
  const passScore = Number(formData.get("passScore"));
  if (passScore >= 1 && passScore <= 100) course.passScore = passScore;
  const points = Number(formData.get("points"));
  if (points >= 0) course.points = points;

  // copertina: upload file oppure URL esterno
  const cover = formData.get("cover") as File | null;
  if (cover && cover.size > 0 && cover.type.startsWith("image/")) {
    const ext = (cover.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const file = `cover_${courseId}_${Date.now()}.${ext}`;
    course.coverUrl = await uploadPublicFile(`uploads/${file}`, Buffer.from(await cover.arrayBuffer()), cover.type);
  } else {
    const coverUrl = String(formData.get("coverUrl") ?? "").trim();
    if (coverUrl && coverUrl !== course.coverUrl) course.coverUrl = coverUrl || undefined;
    if (formData.get("removeCover") === "on") course.coverUrl = undefined;
  }

  await saveDb(db);
  redirect(`/admin/corsi/${courseId}?salvato=1`);
}

export async function deleteCourse(courseId: string) {
  const { db } = await requireEditableCourse(courseId);
  db.courses = db.courses.filter((c) => c.id !== courseId);
  db.progress = db.progress.filter((p) => p.courseId !== courseId);
  db.paths = db.paths.map((p) => ({ ...p, courseIds: p.courseIds.filter((id) => id !== courseId) }));
  // i certificati già emessi restano nello storico
  await saveDb(db);
  redirect("/admin/corsi?eliminato=1");
}

/**
 * Salva i campi della lezione. Non fa redirect: l'editor è un componente client
 * che mostra il "salvato" senza far saltare la pagina.
 */
export async function saveLesson(courseId: string, lessonId: string | null, formData: FormData) {
  const { db, course } = await requireEditableCourse(courseId);
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false as const, error: "Il titolo è obbligatorio" };
  const type = String(formData.get("type") ?? "pdf") as LessonType;
  const minutes = Math.max(1, Number(formData.get("minutes")) || 5);
  const content = String(formData.get("content") ?? "");
  const videoUrl = String(formData.get("videoUrl") ?? "").trim();

  if (lessonId) {
    const lesson = course.lessons.find((l) => l.id === lessonId);
    if (lesson) {
      lesson.title = title;
      lesson.type = type;
      lesson.minutes = minutes;
      lesson.content = content;
      // il link del video ha senso solo sulle lezioni video
      lesson.videoUrl = type === "video" && videoUrl ? videoUrl : undefined;
    }
  } else {
    const lesson: Lesson = { id: `l_${Date.now()}`, title, type, minutes, content };
    if (type === "video" && videoUrl) lesson.videoUrl = videoUrl;
    course.lessons.push(lesson);
    // il primo allegato può arrivare già con il form di creazione
    await attachToLesson(lesson, formData);
  }
  await saveDb(db);
  revalidatePath(`/admin/corsi/${courseId}`);
  return { ok: true as const };
}

/** Crea una lezione vuota del tipo scelto e la aggiunge in fondo al corso. */
export async function addLesson(courseId: string, type: LessonType) {
  const { db, course } = await requireEditableCourse(courseId);
  const defaults: Record<LessonType, { title: string; minutes: number }> = {
    video: { title: "Nuova lezione video", minutes: 10 },
    pdf: { title: "Nuova lettura", minutes: 10 },
    quiz: { title: "Quiz del capitolo", minutes: 5 },
    scorm: { title: "Nuovo contenuto SCORM", minutes: 15 },
  };
  const lesson: Lesson = { id: `l_${Date.now()}`, type, content: "", ...defaults[type] };
  course.lessons.push(lesson);
  await saveDb(db);
  revalidatePath(`/admin/corsi/${courseId}`);
  return { ok: true as const, lessonId: lesson.id };
}

/* ---------- Contenuti SCORM ---------- */

export async function uploadScormPackage(courseId: string, lessonId: string, formData: FormData) {
  const { db, course } = await requireEditableCourse(courseId);
  const lesson = course.lessons.find((l) => l.id === lessonId);
  if (!lesson) return { ok: false as const, error: "Lezione non trovata" };
  const file = formData.get("scorm") as File | null;
  if (!file || file.size === 0) return { ok: false as const, error: "Nessun file caricato" };
  if (file.size > 60 * 1024 * 1024) return { ok: false as const, error: "Pacchetto troppo grande (max 60 MB)" };

  const { importScormPackage, removeScormPackage } = await import("./scorm");
  const res = await importScormPackage(lessonId, file.name, Buffer.from(await file.arrayBuffer()));
  if (!res.ok) return { ok: false as const, error: res.error };

  // sostituzione: rimuovi il vecchio pacchetto per non lasciare file orfani
  if (lesson.scorm) { try { await removeScormPackage(lesson.scorm); } catch { /* best effort */ } }
  lesson.scorm = res.pkg;
  lesson.type = "scorm";
  await saveDb(db);
  revalidatePath(`/admin/corsi/${courseId}`);
  return { ok: true as const, version: res.pkg.version };
}

export async function removeScormLesson(courseId: string, lessonId: string) {
  const { db, course } = await requireEditableCourse(courseId);
  const lesson = course.lessons.find((l) => l.id === lessonId);
  if (lesson?.scorm) {
    const { removeScormPackage } = await import("./scorm");
    try { await removeScormPackage(lesson.scorm); } catch { /* best effort */ }
    delete lesson.scorm;
    await saveDb(db);
    revalidatePath(`/admin/corsi/${courseId}`);
  }
  return { ok: true as const };
}

/**
 * Riceve dal player SCORM lo stato di avanzamento (chiamato su commit/finish).
 * Se il contenuto si dichiara completato/superato, la lezione risulta completata.
 */
export async function trackScorm(
  courseId: string,
  lessonId: string,
  data: { status?: string; scorePercent?: number }
) {
  const user = await requireUser();
  const db = await getDb();
  const course = db.courses.find((c) => c.id === courseId);
  const lesson = course?.lessons.find((l) => l.id === lessonId);
  if (!course || !lesson) return { ok: false as const };

  let prog = db.progress.find((p) => p.userId === user.id && p.courseId === courseId);
  if (!prog) { prog = { userId: user.id, courseId, completedLessons: [] }; db.progress.push(prog); }
  prog.views = prog.views ?? [];
  const now = new Date().toISOString();
  let view = prog.views.find((v) => v.lessonId === lessonId);
  if (!view) { view = { lessonId, maxPercent: 0, secondsWatched: 0, firstAt: now, lastAt: now }; prog.views.push(view); }
  const status = (data.status ?? "").toLowerCase();
  if (status) view.scormStatus = status;
  if (typeof data.scorePercent === "number") view.scormScore = Math.round(data.scorePercent);
  view.lastAt = now;

  const finished = ["completed", "passed", "failed"].includes(status);
  let justCompleted = false;
  // "failed" registra il tentativo ma non completa; passa il quiz o rifai
  if ((status === "completed" || status === "passed") && !prog.completedLessons.includes(lessonId)) {
    prog.completedLessons.push(lessonId);
    const u = db.users.find((x) => x.id === user.id);
    if (u) u.points += 10;
    justCompleted = true;
    await maybeComplete(db, user.id, course);
  }
  await saveDb(db);
  if (justCompleted) revalidatePath(`/corso/${courseId}`);
  return { ok: true as const, finished, justCompleted };
}

/* ---------- Allegati delle lezioni (slide, PDF, dispense) ---------- */

const ATTACHMENT_KINDS: Record<string, LessonAttachment["kind"]> = {
  pdf: "pdf", slide: "slide", altro: "altro",
};

/** Deduce il tipo di allegato dall'estensione, così l'utente non deve sceglierlo. */
function attachmentKind(name: string, declared?: string): LessonAttachment["kind"] {
  if (declared && ATTACHMENT_KINDS[declared]) return ATTACHMENT_KINDS[declared];
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (ext === "pdf") return "pdf";
  if (["ppt", "pptx", "key", "odp"].includes(ext)) return "slide";
  return "altro";
}

/** Aggiunge alla lezione il file caricato e/o il link indicato nel form. */
async function attachToLesson(lesson: Lesson, formData: FormData): Promise<boolean> {
  const file = formData.get("attachment") as File | null;
  const linkUrl = String(formData.get("attachmentUrl") ?? "").trim();
  const declaredKind = String(formData.get("attachmentKind") ?? "");
  const customName = String(formData.get("attachmentName") ?? "").trim();
  lesson.attachments = lesson.attachments ?? [];
  let added = false;

  if (file && file.size > 0) {
    const safe = file.name.toLowerCase().replace(/[^a-z0-9._-]/g, "_");
    const url = await uploadPublicFile(
      `materiali/${lesson.id}_${Date.now()}_${safe}`,
      Buffer.from(await file.arrayBuffer()),
      file.type || "application/octet-stream"
    );
    lesson.attachments.push({
      id: `a_${Date.now()}`,
      name: customName || file.name,
      url,
      kind: attachmentKind(file.name, declaredKind),
      sizeKb: Math.round(file.size / 1024),
    });
    added = true;
  }
  if (linkUrl && /^https?:\/\//i.test(linkUrl)) {
    lesson.attachments.push({
      id: `a_${Date.now()}_l`,
      name: customName || linkUrl.split("/").pop() || "Materiale",
      url: linkUrl,
      kind: attachmentKind(linkUrl, declaredKind),
    });
    added = true;
  }
  return added;
}

export async function addLessonAttachment(courseId: string, lessonId: string, formData: FormData) {
  const { db, course } = await requireEditableCourse(courseId);
  const lesson = course.lessons.find((l) => l.id === lessonId);
  if (lesson && (await attachToLesson(lesson, formData))) await saveDb(db);
  revalidatePath(`/admin/corsi/${courseId}`);
  return { ok: true as const };
}

export async function deleteLessonAttachment(courseId: string, lessonId: string, attachmentId: string) {
  const { db, course } = await requireEditableCourse(courseId);
  const lesson = course.lessons.find((l) => l.id === lessonId);
  if (lesson) {
    lesson.attachments = (lesson.attachments ?? []).filter((a) => a.id !== attachmentId);
    await saveDb(db);
  }
  revalidatePath(`/admin/corsi/${courseId}`);
  return { ok: true as const };
}

export async function deleteLesson(courseId: string, lessonId: string) {
  const { db, course } = await requireEditableCourse(courseId);
  course.lessons = course.lessons.filter((l) => l.id !== lessonId);
  for (const p of db.progress.filter((p) => p.courseId === courseId)) {
    p.completedLessons = p.completedLessons.filter((id) => id !== lessonId);
  }
  await saveDb(db);
  revalidatePath(`/admin/corsi/${courseId}`);
  return { ok: true as const };
}

export async function moveLesson(courseId: string, lessonId: string, dir: number) {
  const { db, course } = await requireEditableCourse(courseId);
  const i = course.lessons.findIndex((l) => l.id === lessonId);
  const j = i + (dir < 0 ? -1 : 1);
  if (i >= 0 && j >= 0 && j < course.lessons.length) {
    [course.lessons[i], course.lessons[j]] = [course.lessons[j], course.lessons[i]];
    await saveDb(db);
  }
  revalidatePath(`/admin/corsi/${courseId}`);
  return { ok: true as const };
}

export async function saveQuestion(courseId: string, questionId: string | null, formData: FormData) {
  const { db, course } = await requireEditableCourse(courseId);
  const text = String(formData.get("text") ?? "").trim();
  if (!text) redirect(`/admin/corsi/${courseId}`);
  const options = [0, 1, 2, 3]
    .map((i) => String(formData.get(`opt${i}`) ?? "").trim())
    .filter((o) => o.length > 0);
  if (options.length < 2) redirect(`/admin/corsi/${courseId}`);
  const correct = Math.min(Math.max(Number(formData.get("correct")) || 0, 0), options.length - 1);

  if (questionId) {
    const q = course.quiz.find((x) => x.id === questionId);
    if (q) {
      q.text = text;
      q.options = options;
      q.correct = correct;
    }
  } else {
    course.quiz.push({ id: `q_${Date.now()}`, text, options, correct });
  }
  await saveDb(db);
  redirect(`/admin/corsi/${courseId}?salvato=1`);
}

/**
 * Simula il job giornaliero dei promemoria (in produzione: cron schedulato).
 * Per ogni collaboratore attivo con corsi obbligatori non completati genera
 * un'email di promemoria (o di scadenza urgente se mancano meno di 7 giorni / è già scaduto).
 */
/* ================== Corsi in programma (edizioni in calendario) ================== */

/** Chi deve frequentare il corso: gli utenti attivi a cui il corso è assegnato. */
function sessionRecipients(db: DB, course: Course): User[] {
  return db.users.filter(
    (u) => u.active !== false && (u.role === "student" || u.role === "dept_head") && courseVisibleTo(course, u)
  );
}

function formatSessionVars(course: Course, s: CourseSession): Record<string, string> {
  const [y, m, d] = s.date.split("-");
  const dove = s.mode === "online" ? "Online" + (s.trainer ? ` · docente ${s.trainer}` : "") : (s.location || "In aula");
  return {
    corso: course.title,
    descrizione: course.description ?? "",
    data: `${d}/${m}/${y}`,
    ora: s.endTime ? `${s.time} – ${s.endTime}` : s.time,
    dove,
    link: s.zoomUrl ? `🔗 Collegamento: ${s.zoomUrl}` : "",
    docente: s.trainer ?? "",
    note: s.notes ?? "",
  };
}

/** Invia la convocazione (o il promemoria) a tutti i destinatari dell'edizione. */
async function sendSessionEmails(db: DB, course: Course, s: CourseSession, type: "convocazione" | "promemoria_sessione", quando = "") {
  const vars = { ...formatSessionVars(course, s), quando };
  let n = 0;
  for (const u of sessionRecipients(db, course)) {
    await queueEmail(db, u, type, vars);
    n++;
  }
  return n;
}

export async function saveCourseSession(courseId: string, sessionId: string | null, formData: FormData) {
  const { db, course } = await requireEditableCourse(courseId);
  const date = String(formData.get("date") ?? "").trim();
  const time = String(formData.get("time") ?? "").trim();
  if (!date || !time) return { ok: false as const, error: "Servono data e ora" };

  const data = {
    date,
    time,
    endTime: String(formData.get("endTime") ?? "").trim() || undefined,
    mode: (String(formData.get("mode") ?? "online") === "aula" ? "aula" : "online") as CourseSession["mode"],
    zoomUrl: String(formData.get("zoomUrl") ?? "").trim() || undefined,
    location: String(formData.get("location") ?? "").trim() || undefined,
    trainer: String(formData.get("trainer") ?? "").trim() || undefined,
    notes: String(formData.get("notes") ?? "").trim() || undefined,
    reminderDays: Math.max(0, Math.min(30, Number(formData.get("reminderDays")) || 3)),
  };

  course.sessions = course.sessions ?? [];
  let session: CourseSession;
  if (sessionId) {
    const existing = course.sessions.find((x) => x.id === sessionId);
    if (!existing) return { ok: false as const, error: "Edizione non trovata" };
    Object.assign(existing, data);
    session = existing;
  } else {
    session = { id: `s_${Date.now()}`, ...data };
    course.sessions.push(session);
  }
  course.sessions.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));

  // convocazione immediata, se richiesta
  let invited = 0;
  if (formData.get("convoca") === "on") {
    invited = await sendSessionEmails(db, course, session, "convocazione");
    session.invitedAt = new Date().toISOString();
  }
  await saveDb(db);
  revalidatePath(`/admin/corsi/${courseId}`);
  return { ok: true as const, invited };
}

export async function deleteCourseSession(courseId: string, sessionId: string) {
  const { db, course } = await requireEditableCourse(courseId);
  course.sessions = (course.sessions ?? []).filter((s) => s.id !== sessionId);
  await saveDb(db);
  revalidatePath(`/admin/corsi/${courseId}`);
  return { ok: true as const };
}

/** Invia (o rinvia) la convocazione per un'edizione già programmata. */
export async function sendSessionInvites(courseId: string, sessionId: string) {
  const { db, course } = await requireEditableCourse(courseId);
  const s = (course.sessions ?? []).find((x) => x.id === sessionId);
  if (!s) return { ok: false as const, invited: 0 };
  const invited = await sendSessionEmails(db, course, s, "convocazione");
  s.invitedAt = new Date().toISOString();
  await saveDb(db);
  revalidatePath(`/admin/corsi/${courseId}`);
  return { ok: true as const, invited };
}

export async function runReminders() {
  const admin = await requireUser();
  if (admin.role === "student") redirect("/studente");
  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);
  let sent = 0;
  let assigned = 0;
  const urgentDays = db.settings.urgentDays ?? 7;
  for (const u of db.users) {
    if (!u.active || (u.role !== "student" && u.role !== "dept_head")) continue;
    // iscrizione automatica per regola: nuovi corsi/percorsi diventati suoi da quando
    // sono stati creati o da quando è cambiato il suo profilo (reparto, insegna, PV...)
    if (await notifyNewAssignments(db, u)) assigned++;

    const openMandatory = coursesForUser(db, u).filter(
      (c) => c.mandatory && !isCourseCompleted(c, getProgress(db, u.id, c.id))
    );
    if (openMandatory.length === 0) continue;
    // ogni corso obbligatorio in carico ha una data di assegnazione, anche quelli
    // già esistenti prima di questa funzione (assegnati oggi, per non perdere lo storico)
    for (const c of openMandatory) {
      if (!db.assignments.some((a) => a.userId === u.id && a.courseId === c.id)) {
        db.assignments.push({ userId: u.id, courseId: c.id, assignedAt: today });
      }
    }

    // 3 stadi mutuamente esclusivi, in ordine di urgenza: chi è in scadenza/scaduto
    // non riceve anche il sollecito "non completato" o "mai iniziato" lo stesso giorno
    const withDue = openMandatory
      .map((c) => ({ course: c, due: dueDate(c, u) }))
      .filter((x): x is { course: Course; due: Date } => x.due !== null);
    const urgent = withDue.filter((x) => x.due.getTime() < Date.now() + urgentDays * 86400000).map((x) => x.course);
    const rest = openMandatory.filter((c) => !urgent.includes(c));
    const notStarted = rest.filter((c) => !hasStartedCourse(db, u.id, c.id));
    const notCompleted = rest.filter((c) => hasStartedCourse(db, u.id, c.id));

    const stages: { type: EmailType; stage: ReminderStage; courses: Course[] }[] = [
      { type: "scadenza", stage: "scadenza", courses: urgent },
      { type: "mai_iniziato", stage: "mai_iniziato", courses: notStarted },
      { type: "promemoria", stage: "promemoria", courses: notCompleted },
    ];
    for (const { type, stage, courses } of stages) {
      if (courses.length === 0) continue;
      const rule = reminderRuleFor(db, stage);
      if (!canSendStage(db, u, type, rule, earliestAssignedAt(db, u.id, courses))) continue;
      const list = courses
        .map((c) => {
          const due = dueDate(c, u);
          return due ? `«${c.title}» (entro ${due.toLocaleDateString("it-IT")})` : `«${c.title}»`;
        })
        .join(", ");
      await queueEmail(db, u, type, { elenco: list });
      sent++;
    }
  }

  // Promemoria delle edizioni in programma: partono nei giorni impostati
  // sull'edizione e una volta sola.
  let reminded = 0;
  for (const course of db.courses) {
    for (const s of course.sessions ?? []) {
      if (s.reminderSentAt || s.date < today) continue;
      const giorniMancanti = Math.round(
        (new Date(`${s.date}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000
      );
      if (giorniMancanti > s.reminderDays) continue;
      const quando =
        giorniMancanti <= 0 ? "è oggi" : giorniMancanti === 1 ? "è domani" : `tra ${giorniMancanti} giorni`;
      reminded += await sendSessionEmails(db, course, s, "promemoria_sessione", quando);
      s.reminderSentAt = new Date().toISOString();
    }
  }

  await saveDb(db);
  redirect(`/admin/email?promemoria=${sent}&convocazioni=${reminded}&assegnazioni=${assigned}`);
}

export async function toggleUserActive(userId: string) {
  const admin = await requireUser();
  const db = await getDb();
  const target = db.users.find((u) => u.id === userId);
  if (!target || target.id === admin.id || target.role === "system_admin") redirect("/admin/utenti");
  const allowed =
    admin.role === "system_admin" ||
    (admin.role === "group_admin" && target!.tenantId === admin.tenantId) ||
    (admin.role === "store_admin" && target!.storeId === admin.storeId && canManageUsers(db, admin));
  if (!allowed) redirect("/admin/utenti");
  target!.active = !target!.active;
  await saveDb(db);
  revalidatePath("/admin/utenti");
  redirect("/admin/utenti");
}

export async function deleteQuestion(courseId: string, questionId: string) {
  const { db, course } = await requireEditableCourse(courseId);
  course.quiz = course.quiz.filter((q) => q.id !== questionId);
  await saveDb(db);
  redirect(`/admin/corsi/${courseId}?salvato=1`);
}

/* ================== Quiz intermedi (domande dentro le lezioni) ================== */

export async function saveLessonQuestion(courseId: string, lessonId: string, questionId: string | null, formData: FormData) {
  const { db, course } = await requireEditableCourse(courseId);
  const lesson = course.lessons.find((l) => l.id === lessonId);
  if (!lesson) redirect(`/admin/corsi/${courseId}`);
  const text = String(formData.get("text") ?? "").trim();
  if (!text) redirect(`/admin/corsi/${courseId}`);
  const options = [0, 1, 2, 3].map((i) => String(formData.get(`opt${i}`) ?? "").trim()).filter(Boolean);
  if (options.length < 2) redirect(`/admin/corsi/${courseId}`);
  const correct = Math.min(Math.max(Number(formData.get("correct")) || 0, 0), options.length - 1);
  const atSecondsRaw = formData.get("atSeconds");
  const atSeconds = atSecondsRaw !== null && String(atSecondsRaw).trim() !== "" ? Math.max(0, Math.round(Number(atSecondsRaw))) : undefined;
  lesson!.questions = lesson!.questions ?? [];
  if (questionId) {
    const q = lesson!.questions.find((x) => x.id === questionId);
    if (q) { q.text = text; q.options = options; q.correct = correct; q.atSeconds = atSeconds; }
  } else {
    lesson!.questions.push({ id: `q_${Date.now()}`, text, options, correct, atSeconds });
  }
  await saveDb(db);
  revalidatePath(`/admin/corsi/${courseId}`);
  return { ok: true as const };
}

export async function deleteLessonQuestion(courseId: string, lessonId: string, questionId: string) {
  const { db, course } = await requireEditableCourse(courseId);
  const lesson = course.lessons.find((l) => l.id === lessonId);
  if (lesson) lesson.questions = (lesson.questions ?? []).filter((q) => q.id !== questionId);
  await saveDb(db);
  revalidatePath(`/admin/corsi/${courseId}`);
  return { ok: true as const };
}

/** Consegna di un quiz intermedio da parte dello studente. */
export async function submitLessonQuiz(courseId: string, lessonId: string, lessonIndex: number, formData: FormData) {
  const user = await requireUser();
  const db = await getDb();
  const course = db.courses.find((c) => c.id === courseId);
  const lesson = course?.lessons.find((l) => l.id === lessonId);
  if (!course || !lesson || !lesson.questions?.length) redirect(`/corso/${courseId}`);
  let correct = 0;
  for (const q of lesson!.questions!) {
    if (Number(formData.get(q.id)) === q.correct) correct++;
  }
  const score = Math.round((correct / lesson!.questions!.length) * 100);
  if (score >= course!.passScore) {
    let prog = db.progress.find((p) => p.userId === user.id && p.courseId === courseId);
    if (!prog) {
      prog = { userId: user.id, courseId, completedLessons: [] };
      db.progress.push(prog);
    }
    if (!prog.completedLessons.includes(lessonId)) {
      prog.completedLessons.push(lessonId);
      db.users.find((x) => x.id === user.id)!.points += 10;
    }
    await maybeComplete(db, user.id, course!);
    await saveDb(db);
  }
  redirect(`/corso/${courseId}?lezione=${lessonIndex}&quizEsito=${score}`);
}

/* ================== Organizzazione: insegne e punti vendita ================== */

function canManageTenant(admin: User, tenantId: string): boolean {
  return admin.role === "system_admin" || (admin.role === "group_admin" && admin.tenantId === tenantId);
}

export async function updateTenant(tenantId: string, formData: FormData) {
  const admin = await requireUser();
  if (!canManageTenant(admin, tenantId)) redirect("/admin/organizzazione");
  const db = await getDb();
  const t = db.tenants.find((x) => x.id === tenantId);
  if (!t) redirect("/admin/organizzazione");
  const name = String(formData.get("name") ?? "").trim();
  if (name) t!.name = name;
  const color = String(formData.get("color") ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(color)) t!.color = color;
  const emoji = String(formData.get("emoji") ?? "").trim();
  if (emoji) t!.emoji = emoji.slice(0, 4);
  t!.welcome = String(formData.get("welcome") ?? "").trim() || undefined;
  t!.secretWord = String(formData.get("secretWord") ?? "").trim() || undefined;
  t!.approvalEmail = String(formData.get("approvalEmail") ?? "").trim() || undefined;
  const logo = formData.get("logo") as File | null;
  if (logo && logo.size > 0) {
    const ext = (logo.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
    const file = `${tenantId}_${Date.now()}.${ext}`;
    t!.logoUrl = await uploadPublicFile(`loghi/${file}`, Buffer.from(await logo.arrayBuffer()), logo.type);
  }
  await saveDb(db);
  redirect(`/admin/organizzazione/insegna/${tenantId}?salvato=1`);
}

export async function updateStore(storeId: string, formData: FormData) {
  const admin = await requireUser();
  const db = await getDb();
  const s = db.stores.find((x) => x.id === storeId);
  if (!s) redirect("/admin/organizzazione");
  const allowed =
    admin.role === "system_admin" ||
    (admin.role === "group_admin" && admin.tenantId === s!.tenantId) ||
    (admin.role === "store_admin" && admin.storeId === storeId);
  if (!allowed) redirect("/admin/organizzazione");
  const name = String(formData.get("name") ?? "").trim();
  if (name) s!.name = name;
  s!.city = String(formData.get("city") ?? "").trim();
  s!.welcome = String(formData.get("welcome") ?? "").trim() || undefined;
  s!.secretWord = String(formData.get("secretWord") ?? "").trim() || undefined;
  s!.approvalEmail = String(formData.get("approvalEmail") ?? "").trim() || undefined;
  await saveDb(db);
  redirect(`/admin/organizzazione/pv/${storeId}?salvato=1`);
}

/* ================== Impostazioni del consorzio (portale) ================== */

export async function updateSettings(formData: FormData) {
  const admin = await requireUser();
  if (admin.role !== "system_admin") redirect("/admin");
  const db = await getDb();
  const s = db.settings;
  const portalName = String(formData.get("portalName") ?? "").trim();
  if (portalName) s.portalName = portalName;
  const colorPrimary = String(formData.get("colorPrimary") ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(colorPrimary)) s.colorPrimary = colorPrimary;
  const colorAccent = String(formData.get("colorAccent") ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(colorAccent)) s.colorAccent = colorAccent;
  s.welcome = String(formData.get("welcome") ?? "").trim() || undefined;
  s.supportEmail = String(formData.get("supportEmail") ?? "").trim() || undefined;
  const font = String(formData.get("font") ?? "");
  if (font) s.font = font;
  const logo = formData.get("logo") as File | null;
  if (logo && logo.size > 0 && logo.type.startsWith("image/")) {
    const ext = (logo.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
    const file = `consorzio_${Date.now()}.${ext}`;
    s.logoUrl = await uploadPublicFile(`loghi/${file}`, Buffer.from(await logo.arrayBuffer()), logo.type);
  }
  if (formData.get("resetColors") === "on") {
    s.colorPrimary = "#00652e";
    s.colorAccent = "#8dc63f";
  }
  s.leaderboardAnonymous = formData.get("leaderboardAnonymous") === "on";
  await saveDb(db);
  revalidatePath("/", "layout");
  redirect("/admin/organizzazione/consorzio?salvato=1");
}

/** Ordine e visibilità dei blocchi della home studente, configurabili senza sviluppo. */
export async function moveHomeBlock(index: number, dir: number) {
  const admin = await requireUser();
  if (admin.role !== "system_admin") return { ok: false as const };
  const db = await getDb();
  const blocks = db.settings.homeBlocks ?? [...DEFAULT_HOME_BLOCKS];
  const target = index + dir;
  if (target < 0 || target >= blocks.length) return { ok: false as const };
  [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
  db.settings.homeBlocks = blocks;
  await saveDb(db);
  revalidatePath("/admin/organizzazione/consorzio");
  revalidatePath("/studente");
  return { ok: true as const };
}

export async function toggleHomeBlock(index: number) {
  const admin = await requireUser();
  if (admin.role !== "system_admin") return { ok: false as const };
  const db = await getDb();
  const blocks = db.settings.homeBlocks ?? [...DEFAULT_HOME_BLOCKS];
  if (!blocks[index]) return { ok: false as const };
  blocks[index].enabled = !blocks[index].enabled;
  db.settings.homeBlocks = blocks;
  await saveDb(db);
  revalidatePath("/admin/organizzazione/consorzio");
  revalidatePath("/studente");
  return { ok: true as const };
}

/* ================== Utenti e ruoli (pagina Ruoli, modifiche rapide) ================== */

/** Il bersaglio è nel perimetro dell'admin e l'admin ha la gestione utenti attiva? */
function canTouchUser(db: DB, admin: User, target: User): boolean {
  if (!canManageUsers(db, admin)) return false;
  if (target.role === "system_admin" && admin.role !== "system_admin") return false;
  if (admin.role === "system_admin") return true;
  if (admin.role === "group_admin") return target.tenantId === admin.tenantId;
  if (admin.role === "store_admin") return target.storeId === admin.storeId;
  return false;
}

export async function quickSetRole(userId: string, role: Role) {
  const admin = await requireUser();
  const db = await getDb();
  const target = db.users.find((u) => u.id === userId);
  if (!target || target.id === admin.id) return { ok: false as const, error: "Non consentito" };
  if (!canTouchUser(db, admin, target)) return { ok: false as const, error: "Fuori dal tuo ambito" };
  if (!assignableRolesFor(admin).includes(role)) return { ok: false as const, error: "Ruolo non assegnabile dal tuo profilo" };
  target.role = role;
  await saveDb(db);
  revalidatePath("/admin/ruoli");
  return { ok: true as const };
}

export async function quickSetSites(userId: string, sites: SiteId[]) {
  const admin = await requireUser();
  const db = await getDb();
  const target = db.users.find((u) => u.id === userId);
  if (!target) return { ok: false as const, error: "Utente non trovato" };
  if (!canTouchUser(db, admin, target)) return { ok: false as const, error: "Fuori dal tuo ambito" };
  target.sites = sites.length > 0 ? sites : undefined;
  await saveDb(db);
  revalidatePath("/admin/ruoli");
  return { ok: true as const };
}

export async function quickToggleActive(userId: string) {
  const admin = await requireUser();
  const db = await getDb();
  const target = db.users.find((u) => u.id === userId);
  if (!target || target.id === admin.id) return { ok: false as const, error: "Non consentito" };
  if (!canTouchUser(db, admin, target)) return { ok: false as const, error: "Fuori dal tuo ambito" };
  target.active = !target.active;
  await saveDb(db);
  revalidatePath("/admin/ruoli");
  return { ok: true as const };
}

/** L'insegna concede o revoca ai propri punti vendita la gestione dei loro utenti. */
export async function setTenantUserDelegation(tenantId: string, allow: boolean) {
  const admin = await requireUser();
  const db = await getDb();
  const tenant = db.tenants.find((t) => t.id === tenantId);
  if (!tenant) return { ok: false as const };
  const allowed = admin.role === "system_admin" || (admin.role === "group_admin" && admin.tenantId === tenantId);
  if (!allowed) return { ok: false as const };
  tenant.pvGestioneUtenti = allow;
  await saveDb(db);
  revalidatePath("/admin/ruoli");
  return { ok: true as const };
}

/* ================== Modifica utenti ================== */

export async function updateUser(userId: string, formData: FormData) {
  const admin = await requireUser();
  const db = await getDb();
  const target = db.users.find((u) => u.id === userId);
  if (!target) redirect("/admin/utenti");
  const allowed =
    admin.role === "system_admin" ||
    (admin.role === "group_admin" && target!.tenantId === admin.tenantId) ||
    (admin.role === "store_admin" && target!.storeId === admin.storeId && canManageUsers(db, admin));
  if (!allowed || (target!.role === "system_admin" && admin.id !== target!.id)) redirect("/admin/utenti");

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  if (firstName) target!.firstName = firstName;
  if (lastName) target!.lastName = lastName;
  if (email.includes("@")) target!.email = email;
  target!.jobTitle = String(formData.get("jobTitle") ?? "").trim() || undefined;
  const hireDate = String(formData.get("hireDate") ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(hireDate)) target!.hireDate = hireDate;
  const gender = String(formData.get("gender") ?? "");
  target!.gender = gender === "m" || gender === "f" ? gender : undefined;
  if (formData.get("sitesForm") === "1") {
    const sites: SiteId[] = [];
    if (formData.get("siteAcademy") === "on") sites.push("academy");
    if (formData.get("siteArredo") === "on") sites.push("arredo");
    if (formData.get("siteZoo") === "on") sites.push("zoo");
    if (formData.get("sitePiante") === "on") sites.push("piante");
    target!.sites = sites.length > 0 ? sites : undefined;
  }

  const role = String(formData.get("role") ?? "") as Role;
  const assignableRoles: Role[] =
    admin.role === "system_admin"
      ? ["system_admin", "group_admin", "store_admin", "dept_head", "course_manager", "student"]
      : admin.role === "group_admin"
        ? ["store_admin", "dept_head", "student"]
        : ["dept_head", "student"];
  if (role && assignableRoles.includes(role)) target!.role = role;

  const storeId = String(formData.get("storeId") ?? "");
  if (storeId) {
    const store = db.stores.find((x) => x.id === storeId);
    const canMove =
      admin.role === "system_admin" ||
      (admin.role === "group_admin" && store?.tenantId === admin.tenantId) ||
      (admin.role === "store_admin" && storeId === admin.storeId);
    if (store && canMove) {
      target!.storeId = store.id;
      target!.tenantId = store.tenantId;
    }
  } else if (admin.role === "system_admin") {
    // nessun PV = ruolo di consorzio o di sola insegna
    const tenantId = String(formData.get("tenantId") ?? "");
    target!.storeId = undefined;
    target!.tenantId = tenantId || undefined;
  }
  const departmentId = String(formData.get("departmentId") ?? "");
  target!.departmentId = departmentId || undefined;

  await notifyNewAssignments(db, target!);
  await saveDb(db);
  redirect(`/admin/utenti/${userId}?salvato=1`);
}

/**
 * Invio di prova: verifica dal browser che chiave, mittente e DNS di Resend
 * siano a posto, senza aspettare che scatti un'automazione vera. Non finisce
 * nel registro invii (non è una comunicazione a un collaboratore).
 */
export async function sendTestEmail(formData: FormData) {
  const admin = await requireUser();
  if (admin.role !== "system_admin" && admin.role !== "course_manager") redirect("/admin/email");
  const to = String(formData.get("to") ?? "").trim();
  if (!to.includes("@")) redirect("/admin/email?prova=" + encodeURIComponent("Indirizzo non valido."));
  const cfg = mailerConfig();
  if (!cfg.enabled) {
    redirect("/admin/email?prova=" + encodeURIComponent("Invio reale non configurato: mancano RESEND_API_KEY o EMAIL_FROM."));
  }
  const r = await sendMail(
    to,
    "Prova di invio da Academy GT",
    `Se leggi questo messaggio, l'invio email di Academy GT funziona.

Mittente configurato: ${cfg.from}
Inviata il ${new Date().toLocaleString("it-IT")}.`
  );
  redirect("/admin/email?prova=" + encodeURIComponent(r.sent ? "ok" : `Errore dal provider: ${r.error ?? "sconosciuto"}`));
}

/* ================== Modelli email ================== */

export async function saveTemplate(type: EmailType, formData: FormData) {
  const admin = await requireUser();
  if (admin.role === "student" || admin.role === "dept_head") redirect("/admin");
  const db = await getDb();
  const isGlobal = admin.role === "system_admin" || admin.role === "course_manager";
  const isStore = admin.role === "store_admin";
  const tenantId = isGlobal ? undefined : admin.tenantId;
  const storeId = isStore ? admin.storeId : undefined;
  let tpl = db.templates.find((t) =>
    t.type === type &&
    (isGlobal ? !t.tenantId && !t.storeId : isStore ? t.storeId === storeId : t.tenantId === tenantId && !t.storeId)
  );
  if (!tpl) {
    const base = db.templates.find((t) => t.type === type && !t.tenantId && !t.storeId)!;
    tpl = { ...base, tenantId, storeId };
    db.templates.push(tpl);
  }
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (subject) tpl.subject = subject;
  if (body) tpl.body = body;
  // solo l'amministratore di sistema (o gestore corsi) attiva/disattiva le automazioni
  if (isGlobal) tpl.enabled = formData.get("enabled") === "on";
  await saveDb(db);
  redirect("/admin/email?template=1");
}

export async function resetTemplate(type: EmailType) {
  const admin = await requireUser();
  if (admin.role === "student" || admin.role === "dept_head") redirect("/admin");
  const db = await getDb();
  if (admin.role === "system_admin" || admin.role === "course_manager") {
    const { DEFAULT_TEMPLATES } = await import("./types");
    const def = DEFAULT_TEMPLATES.find((t) => t.type === type)!;
    const tpl = db.templates.find((t) => t.type === type && !t.tenantId && !t.storeId)!;
    tpl.subject = def.subject;
    tpl.body = def.body;
    tpl.enabled = true;
  } else if (admin.role === "store_admin") {
    db.templates = db.templates.filter((t) => !(t.type === type && t.storeId === admin.storeId));
  } else {
    db.templates = db.templates.filter((t) => !(t.type === type && t.tenantId === admin.tenantId && !t.storeId));
  }
  await saveDb(db);
  redirect("/admin/email?template=1");
}

/* ================== Modelli aggiuntivi e impostazioni automazioni ================== */

export async function saveCustomTemplate(templateId: string | null, formData: FormData) {
  const admin = await requireUser();
  if (!["system_admin", "course_manager", "group_admin", "store_admin"].includes(admin.role)) redirect("/admin");
  const db = await getDb();
  const name = String(formData.get("name") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const trigger = String(formData.get("trigger") ?? "benvenuto") as EmailType;
  if (!name || !subject || !body) redirect("/admin/email");
  const isGlobal = admin.role === "system_admin" || admin.role === "course_manager";
  const scope = {
    tenantId: isGlobal ? undefined : admin.tenantId,
    storeId: admin.role === "store_admin" ? admin.storeId : undefined,
  };
  const canTouch = (ct: { tenantId?: string; storeId?: string }) =>
    isGlobal ||
    (admin.role === "group_admin" && ct.tenantId === admin.tenantId) ||
    (admin.role === "store_admin" && ct.storeId === admin.storeId);
  if (templateId) {
    const ct = db.customTemplates.find((x) => x.id === templateId);
    if (!ct || !canTouch(ct)) redirect("/admin/email");
    ct!.name = name;
    ct!.subject = subject;
    ct!.body = body;
    ct!.trigger = trigger;
    ct!.enabled = formData.get("enabled") === "on";
  } else {
    db.customTemplates.push({
      id: `ct_${Date.now()}`,
      name,
      trigger,
      subject,
      body,
      enabled: formData.get("enabled") === "on",
      ...scope,
    });
  }
  await saveDb(db);
  redirect("/admin/email?template=1");
}

export async function deleteCustomTemplate(templateId: string) {
  const admin = await requireUser();
  const db = await getDb();
  const ct = db.customTemplates.find((x) => x.id === templateId);
  if (!ct) redirect("/admin/email");
  const isGlobal = admin.role === "system_admin" || admin.role === "course_manager";
  const canTouch =
    isGlobal ||
    (admin.role === "group_admin" && ct!.tenantId === admin.tenantId) ||
    (admin.role === "store_admin" && ct!.storeId === admin.storeId);
  if (!canTouch) redirect("/admin/email");
  db.customTemplates = db.customTemplates.filter((x) => x.id !== templateId);
  await saveDb(db);
  redirect("/admin/email?template=1");
}

export async function saveAutomationSettings(formData: FormData) {
  const admin = await requireUser();
  if (admin.role !== "system_admin") redirect("/admin/email");
  const db = await getDb();
  const urgentDays = Number(formData.get("urgentDays"));
  if (urgentDays >= 1 && urgentDays <= 60) db.settings.urgentDays = Math.round(urgentDays);
  const watch = Number(formData.get("watchThreshold"));
  if (watch >= 50 && watch <= 100) db.settings.watchThreshold = Math.round(watch);

  const stages: ReminderStage[] = ["mai_iniziato", "promemoria", "scadenza"];
  const rules: Partial<Record<ReminderStage, ReminderRule>> = {};
  for (const stage of stages) {
    const waitDays = Number(formData.get(`${stage}_waitDays`));
    const intervalDays = Number(formData.get(`${stage}_intervalDays`));
    const maxRepeats = Number(formData.get(`${stage}_maxRepeats`));
    const fallback = DEFAULT_REMINDER_RULES[stage];
    rules[stage] = {
      waitDays: waitDays >= 0 && waitDays <= 90 ? Math.round(waitDays) : fallback.waitDays,
      intervalDays: intervalDays >= 1 && intervalDays <= 90 ? Math.round(intervalDays) : fallback.intervalDays,
      maxRepeats: maxRepeats >= 0 && maxRepeats <= 20 ? Math.round(maxRepeats) : fallback.maxRepeats,
    };
  }
  db.settings.reminderRules = rules;

  await saveDb(db);
  redirect("/admin/email?template=1");
}

/* ================== Percorsi formativi ================== */

function canEditPath(admin: User, level: CourseLevel, tenantId?: string): boolean {
  if (admin.role === "system_admin" || admin.role === "course_manager") return true;
  if (admin.role === "group_admin") return level !== "sistema" && tenantId === admin.tenantId;
  return false;
}

export async function savePath(pathId: string | null, formData: FormData) {
  const admin = await requireUser();
  const db = await getDb();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false as const, error: "Il titolo è obbligatorio" };
  const level = (["sistema", "insegna", "punto_vendita"].includes(String(formData.get("level")))
    ? String(formData.get("level"))
    : "sistema") as CourseLevel;
  const tenantId = admin.role === "group_admin" ? admin.tenantId : (String(formData.get("tenantId") ?? "").trim() || undefined);
  if (!canEditPath(admin, level, level === "sistema" ? undefined : tenantId)) return { ok: false as const, error: "Non autorizzato" };

  const courseIds = (formData.getAll("courseIds") as string[]).filter(Boolean);
  const departments = (formData.getAll("departments") as string[]).filter(Boolean);
  const data = {
    title,
    description: String(formData.get("description") ?? "").trim(),
    emoji: String(formData.get("emoji") ?? "").trim().slice(0, 4) || "🧭",
    level,
    tenantId: level === "sistema" ? undefined : tenantId,
    courseIds,
    departments: departments.length ? departments : undefined,
    onlyNewHires: formData.get("onlyNewHires") === "on",
  };

  if (pathId) {
    const p = db.paths.find((x) => x.id === pathId);
    if (!p || !canEditPath(admin, p.level, p.tenantId)) return { ok: false as const, error: "Percorso non trovato" };
    Object.assign(p, data);
  } else {
    db.paths.push({ id: `path_${Date.now()}`, ...data });
  }
  await saveDb(db);
  revalidatePath("/admin/percorsi");
  return { ok: true as const };
}

export async function deletePath(pathId: string) {
  const admin = await requireUser();
  const db = await getDb();
  const p = db.paths.find((x) => x.id === pathId);
  if (!p || !canEditPath(admin, p.level, p.tenantId)) return { ok: false as const };
  db.paths = db.paths.filter((x) => x.id !== pathId);
  await saveDb(db);
  revalidatePath("/admin/percorsi");
  return { ok: true as const };
}

/** Aggiunge/toglie un corso dal percorso (usato dai pulsanti +/− nell'editor). */
export async function togglePathCourse(pathId: string, courseId: string) {
  const admin = await requireUser();
  const db = await getDb();
  const p = db.paths.find((x) => x.id === pathId);
  if (!p || !canEditPath(admin, p.level, p.tenantId)) return { ok: false as const };
  p.courseIds = p.courseIds.includes(courseId)
    ? p.courseIds.filter((id) => id !== courseId)
    : [...p.courseIds, courseId];
  await saveDb(db);
  revalidatePath("/admin/percorsi");
  return { ok: true as const };
}

/** Sposta un corso su/giù nell'ordine del percorso. */
export async function movePathCourse(pathId: string, courseId: string, dir: number) {
  const admin = await requireUser();
  const db = await getDb();
  const p = db.paths.find((x) => x.id === pathId);
  if (!p || !canEditPath(admin, p.level, p.tenantId)) return { ok: false as const };
  const i = p.courseIds.indexOf(courseId);
  const j = i + (dir < 0 ? -1 : 1);
  if (i >= 0 && j >= 0 && j < p.courseIds.length) {
    [p.courseIds[i], p.courseIds[j]] = [p.courseIds[j], p.courseIds[i]];
    await saveDb(db);
    revalidatePath("/admin/percorsi");
  }
  return { ok: true as const };
}

/* ================== Reparti e gruppi ================== */

function deptScopeAllowed(admin: User, d: { tenantId?: string; storeId?: string }): boolean {
  if (admin.role === "system_admin") return true;
  if (admin.role === "group_admin") return !!d.tenantId && d.tenantId === admin.tenantId;
  if (admin.role === "store_admin") return !!d.storeId && d.storeId === admin.storeId;
  return false;
}

export async function saveDepartment(deptId: string | null, formData: FormData) {
  const admin = await requireUser();
  if (!["system_admin", "group_admin", "store_admin"].includes(admin.role)) redirect("/admin");
  const db = await getDb();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/admin/organizzazione");
  const emoji = String(formData.get("emoji") ?? "").trim() || "🏷️";
  if (deptId) {
    const d = db.departments.find((x) => x.id === deptId);
    if (!d || !deptScopeAllowed(admin, d)) redirect("/admin/organizzazione");
    d!.name = name;
    d!.emoji = emoji.slice(0, 4);
  } else {
    db.departments.push({
      id: `d_${Date.now()}`,
      name,
      emoji: emoji.slice(0, 4),
      tenantId: admin.role === "system_admin" ? undefined : admin.tenantId,
      storeId: admin.role === "store_admin" ? admin.storeId : undefined,
    });
  }
  await saveDb(db);
  redirect("/admin/organizzazione?salvato=1");
}

export async function deleteDepartment(deptId: string) {
  const admin = await requireUser();
  const db = await getDb();
  const d = db.departments.find((x) => x.id === deptId);
  if (!d || !deptScopeAllowed(admin, d)) redirect("/admin/organizzazione");
  db.departments = db.departments.filter((x) => x.id !== deptId);
  for (const u of db.users) if (u.departmentId === deptId) u.departmentId = undefined;
  for (const c of db.courses) if (c.departments) c.departments = c.departments.filter((x) => x !== deptId);
  await saveDb(db);
  redirect("/admin/organizzazione?salvato=1");
}

export async function saveGroup(groupId: string | null, formData: FormData) {
  const admin = await requireUser();
  if (!["system_admin", "group_admin", "store_admin"].includes(admin.role)) redirect("/admin");
  const db = await getDb();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/admin/organizzazione");
  const emoji = String(formData.get("emoji") ?? "").trim() || "👥";
  if (groupId) {
    const g = db.groups.find((x) => x.id === groupId);
    if (!g || !deptScopeAllowed(admin, g)) redirect("/admin/organizzazione");
    g!.name = name;
    g!.emoji = emoji.slice(0, 4);
  } else {
    db.groups.push({
      id: `g_${Date.now()}`,
      name,
      emoji: emoji.slice(0, 4),
      tenantId: admin.role === "system_admin" ? undefined : admin.tenantId,
      storeId: admin.role === "store_admin" ? admin.storeId : undefined,
    });
  }
  await saveDb(db);
  redirect("/admin/organizzazione?salvato=1");
}

export async function deleteGroup(groupId: string) {
  const admin = await requireUser();
  const db = await getDb();
  const g = db.groups.find((x) => x.id === groupId);
  if (!g || !deptScopeAllowed(admin, g)) redirect("/admin/organizzazione");
  db.groups = db.groups.filter((x) => x.id !== groupId);
  for (const u of db.users) if (u.groupIds) u.groupIds = u.groupIds.filter((x) => x !== groupId);
  for (const c of db.courses) if (c.groups) c.groups = c.groups.filter((x) => x !== groupId);
  await saveDb(db);
  redirect("/admin/organizzazione?salvato=1");
}

export async function addGroupMember(groupId: string, formData: FormData) {
  const admin = await requireUser();
  const db = await getDb();
  const g = db.groups.find((x) => x.id === groupId);
  if (!g || !deptScopeAllowed(admin, g)) redirect("/admin/organizzazione");
  const userId = String(formData.get("userId") ?? "");
  const u = db.users.find((x) => x.id === userId);
  if (u) {
    u.groupIds = u.groupIds ?? [];
    if (!u.groupIds.includes(groupId)) u.groupIds.push(groupId);
    await saveDb(db);
  }
  redirect("/admin/organizzazione?salvato=1");
}

export async function removeGroupMember(groupId: string, userId: string) {
  const admin = await requireUser();
  const db = await getDb();
  const g = db.groups.find((x) => x.id === groupId);
  if (!g || !deptScopeAllowed(admin, g)) redirect("/admin/organizzazione");
  const u = db.users.find((x) => x.id === userId);
  if (u?.groupIds) {
    u.groupIds = u.groupIds.filter((x) => x !== groupId);
    await saveDb(db);
  }
  redirect("/admin/organizzazione?salvato=1");
}

/* ================== Autenticazione con password ================== */

export async function loginWithPassword(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const db = await getDb();
  const user = db.users.find((u) => u.email.toLowerCase() === email);
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    redirect("/login?errore=credenziali");
  }
  if (user!.active === false) redirect("/login?disattivato=1");
  const store = await cookies();
  store.set(AUTH_COOKIE, user!.id, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect(postLoginPath(user!));
}

export async function activateAccount(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const password2 = String(formData.get("password2") ?? "");
  if (password.length < 8) redirect("/attiva?errore=corta");
  if (password !== password2) redirect("/attiva?errore=diverse");
  const db = await getDb();
  const user = db.users.find((u) => u.email.toLowerCase() === email);
  if (!user) redirect("/attiva?errore=nontrovato");
  if (user!.active === false) redirect("/login?disattivato=1");
  if (user!.passwordHash) redirect("/attiva?errore=giaattivo");
  user!.passwordHash = hashPassword(password);
  await saveDb(db);
  redirect("/login?attivato=1");
}

export async function registerRequest(formData: FormData) {
  const db = await getDb();
  const secret = String(formData.get("secret") ?? "").trim();
  const storeId = String(formData.get("storeId") ?? "");
  const store = db.stores.find((s) => s.id === storeId);
  if (!store) redirect("/registrati?errore=pv");
  const tenant = db.tenants.find((t) => t.id === store!.tenantId)!;
  const validSecret =
    (store!.secretWord && secret === store!.secretWord) || (tenant.secretWord && secret === tenant.secretWord);
  if (!secret || !validSecret) redirect("/registrati?errore=segreta");

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const birthDate = String(formData.get("birthDate") ?? "");
  const taxCode = String(formData.get("taxCode") ?? "").trim().toUpperCase();
  if (!firstName || !lastName || !email.includes("@")) redirect("/registrati?errore=dati");
  if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) redirect("/registrati?errore=esiste");
  if (db.registrations.some((r) => r.email.toLowerCase() === email.toLowerCase() && r.status === "pending"))
    redirect("/registrati?errore=incorso");

  const regGender = String(formData.get("gender") ?? "");
  db.registrations.push({
    id: `r_${Date.now()}`,
    firstName,
    lastName,
    email,
    gender: regGender === "m" || regGender === "f" ? regGender : undefined,
    tenantId: tenant.id,
    storeId: store!.id,
    departmentId: String(formData.get("departmentId") ?? "") || undefined,
    birthDate,
    taxCode,
    date: new Date().toISOString(),
    status: "pending",
  });
  // notifica all'email di approvazione del PV (o dell'insegna)
  const approvalTo = store!.approvalEmail || tenant.approvalEmail;
  if (approvalTo) {
    const subject = `🔔 Nuova richiesta di registrazione: ${firstName} ${lastName}`;
    const body = `${firstName} ${lastName} (${email}) chiede di registrarsi ad Academy GT per ${store!.name}. Approva o rifiuta la richiesta dalla pagina Utenti.`;
    const r = await sendMail(approvalTo, subject, body);
    db.emails.push({
      id: `e_${Date.now()}_reg`,
      userId: "",
      to: approvalTo,
      subject,
      body,
      type: "assegnazione",
      date: new Date().toISOString(),
      status: r.sent === true ? "inviata" : r.sent === false ? "errore" : "in_coda",
      ...(r.error ? { error: r.error } : {}),
    });
  }
  await saveDb(db);
  redirect("/registrati?inviata=1");
}

export async function approveRegistration(regId: string, formData: FormData) {
  const admin = await requireUser();
  const db = await getDb();
  const reg = db.registrations.find((r) => r.id === regId && r.status === "pending");
  if (!reg) redirect("/admin/utenti");
  const allowed =
    admin.role === "system_admin" ||
    (admin.role === "group_admin" && reg!.tenantId === admin.tenantId) ||
    (admin.role === "store_admin" && reg!.storeId === admin.storeId && canManageUsers(db, admin));
  if (!allowed) redirect("/admin/utenti");

  const departmentId = String(formData.get("departmentId") ?? "") || reg!.departmentId;
  const newUser: User = {
    id: `u_${Date.now()}_reg`,
    firstName: reg!.firstName,
    lastName: reg!.lastName,
    email: reg!.email,
    role: "student",
    tenantId: reg!.tenantId,
    storeId: reg!.storeId,
    departmentId: departmentId || undefined,
    jobTitle: "Addetto vendita",
    hireDate: new Date().toISOString().slice(0, 10), // neoassunto: entra nei percorsi di onboarding
    points: 0,
    badges: [],
    active: true,
    birthDate: reg!.birthDate || undefined,
    taxCode: reg!.taxCode || undefined,
    gender: reg!.gender,
  };
  db.users.push(newUser);
  reg!.status = "approved";
  await queueEmail(db, newUser, "benvenuto");
  await notifyNewAssignments(db, newUser);
  await saveDb(db);
  redirect("/admin/utenti?approvato=1");
}

export async function rejectRegistration(regId: string) {
  const admin = await requireUser();
  const db = await getDb();
  const reg = db.registrations.find((r) => r.id === regId && r.status === "pending");
  if (!reg) redirect("/admin/utenti");
  const allowed =
    admin.role === "system_admin" ||
    (admin.role === "group_admin" && reg!.tenantId === admin.tenantId) ||
    (admin.role === "store_admin" && reg!.storeId === admin.storeId && canManageUsers(db, admin));
  if (!allowed) redirect("/admin/utenti");
  reg!.status = "rejected";
  await saveDb(db);
  redirect("/admin/utenti?rifiutato=1");
}

/* ================== Archivio file (pulizia dello spazio) ================== */

/**
 * Elimina i file indicati dal bucket. Non si fida dell'elenco ricevuto: rifà
 * l'analisi lato server e cancella solo ciò che risulta davvero orfano, non
 * caricato nelle ultime 24 ore e in una cartella che il ruolo può gestire.
 */
export async function eliminaFileOrfani(paths: string[]) {
  const user = await requireUser();
  const { analizzaArchivio, cartelleGestibili, puoVedereArchivio } = await import("./storage-audit");
  if (!puoVedereArchivio(user)) return { ok: false as const, eliminati: 0, error: "Non autorizzato" };
  const permesse = cartelleGestibili(user);
  const archivio = await analizzaArchivio();

  const daEliminare = archivio
    .filter((f) => paths.includes(f.path) && !f.usato && !f.recente && permesse.includes(f.cartella))
    .map((f) => f.path);
  if (daEliminare.length === 0) return { ok: true as const, eliminati: 0 };

  const { supabase, STORAGE_BUCKET } = await import("./supabase");
  const { error } = await supabase().storage.from(STORAGE_BUCKET).remove(daEliminare);
  if (error) return { ok: false as const, eliminati: 0, error: error.message };
  revalidatePath("/file");
  return { ok: true as const, eliminati: daEliminare.length };
}
