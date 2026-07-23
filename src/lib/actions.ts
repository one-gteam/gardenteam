"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { getDb, saveDb } from "./db";
import { uploadPublicFile } from "./supabase";
import { AUTH_COOKIE, requireUser } from "./auth";
import { expiringCourses, isCourseCompleted } from "./logic";
import { Course, CourseLevel, DB, EmailType, LessonType, Role, SiteId, User, postLoginPath } from "./types";

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

function pushEmail(db: DB, user: User, type: EmailType, subject: string, body: string) {
  db.emails.push({
    id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId: user.id,
    to: user.email,
    subject,
    body,
    type,
    date: new Date().toISOString(),
    status: "inviata",
  });
}

/**
 * Simula l'invio email: in produzione qui si chiama il provider transazionale (Resend).
 * Invia il modello di sistema (o la personalizzazione insegna/PV) più gli eventuali
 * modelli aggiuntivi collegati alla stessa automazione, se nello scope dell'utente.
 */
function queueEmail(db: DB, user: User, type: EmailType, vars: Record<string, string> = {}) {
  const r = renderTemplate(db, user, type, vars);
  if (r) pushEmail(db, user, type, r.subject, r.body);
  for (const ct of db.customTemplates) {
    if (ct.trigger !== type || !ct.enabled) continue;
    if (ct.storeId && ct.storeId !== user.storeId) continue;
    if (ct.tenantId && !ct.storeId && ct.tenantId !== user.tenantId) continue;
    pushEmail(db, user, type, renderText(ct.subject, user, vars), renderText(ct.body, user, vars));
  }
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

export async function login(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  const db = await getDb();
  const user = db.users.find((u) => u.id === userId);
  if (!user) redirect("/login");
  if (user!.active === false) redirect("/login?disattivato=1");
  const store = await cookies();
  store.set(AUTH_COOKIE, user.id, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect(postLoginPath(user!));
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

function maybeComplete(db: DB, userId: string, course: Course) {
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
      queueEmail(db, user, "certificato", { corso: course.title });
    }
    queueEmail(db, user, "completamento", { corso: course.title, punti: String(course.points) });
    awardBadges(db, userId);
  }
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
  maybeComplete(db, user.id, course);
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
  maybeComplete(db, user.id, course);
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

  const isAdmin = ["system_admin", "group_admin", "store_admin"].includes(admin.role);
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
    queueEmail(db, newUser, "benvenuto");
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
        type: "testo",
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

export async function saveLesson(courseId: string, lessonId: string | null, formData: FormData) {
  const { db, course } = await requireEditableCourse(courseId);
  const title = String(formData.get("title") ?? "").trim();
  if (!title) redirect(`/admin/corsi/${courseId}`);
  const type = String(formData.get("type") ?? "testo") as LessonType;
  const minutes = Math.max(1, Number(formData.get("minutes")) || 5);
  const content = String(formData.get("content") ?? "");

  if (lessonId) {
    const lesson = course.lessons.find((l) => l.id === lessonId);
    if (lesson) {
      lesson.title = title;
      lesson.type = type;
      lesson.minutes = minutes;
      lesson.content = content;
    }
  } else {
    course.lessons.push({ id: `l_${Date.now()}`, title, type, minutes, content });
  }
  await saveDb(db);
  redirect(`/admin/corsi/${courseId}?salvato=1`);
}

export async function deleteLesson(courseId: string, lessonId: string) {
  const { db, course } = await requireEditableCourse(courseId);
  course.lessons = course.lessons.filter((l) => l.id !== lessonId);
  for (const p of db.progress.filter((p) => p.courseId === courseId)) {
    p.completedLessons = p.completedLessons.filter((id) => id !== lessonId);
  }
  await saveDb(db);
  redirect(`/admin/corsi/${courseId}?salvato=1`);
}

export async function moveLesson(courseId: string, lessonId: string, dir: number) {
  const { db, course } = await requireEditableCourse(courseId);
  const i = course.lessons.findIndex((l) => l.id === lessonId);
  const j = i + (dir < 0 ? -1 : 1);
  if (i >= 0 && j >= 0 && j < course.lessons.length) {
    [course.lessons[i], course.lessons[j]] = [course.lessons[j], course.lessons[i]];
    await saveDb(db);
  }
  redirect(`/admin/corsi/${courseId}`);
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
export async function runReminders() {
  const admin = await requireUser();
  if (admin.role === "student") redirect("/studente");
  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);
  let sent = 0;
  for (const u of db.users) {
    if (!u.active || (u.role !== "student" && u.role !== "dept_head")) continue;
    const missing = expiringCourses(db, u);
    if (missing.length === 0) continue;
    const urgentDays = db.settings.urgentDays ?? 7;
    const urgent = missing.filter((m) => m.due!.getTime() < Date.now() + urgentDays * 86400000);
    const type: EmailType = urgent.length > 0 ? "scadenza" : "promemoria";
    // massimo un'email al giorno per persona
    const alreadyToday = db.emails.some(
      (e) => e.userId === u.id && e.date.slice(0, 10) === today && (e.type === "promemoria" || e.type === "scadenza")
    );
    if (alreadyToday) continue;
    const list = missing.map((m) => `«${m.course.title}» (entro ${m.due!.toLocaleDateString("it-IT")})`).join(", ");
    queueEmail(db, u, type, { elenco: list });
    sent++;
  }
  await saveDb(db);
  redirect(`/admin/email?promemoria=${sent}`);
}

export async function toggleUserActive(userId: string) {
  const admin = await requireUser();
  const db = await getDb();
  const target = db.users.find((u) => u.id === userId);
  if (!target || target.id === admin.id || target.role === "system_admin") redirect("/admin/utenti");
  const allowed =
    admin.role === "system_admin" ||
    (admin.role === "group_admin" && target!.tenantId === admin.tenantId) ||
    (admin.role === "store_admin" && target!.storeId === admin.storeId);
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
  lesson!.questions = lesson!.questions ?? [];
  if (questionId) {
    const q = lesson!.questions.find((x) => x.id === questionId);
    if (q) { q.text = text; q.options = options; q.correct = correct; }
  } else {
    lesson!.questions.push({ id: `q_${Date.now()}`, text, options, correct });
  }
  await saveDb(db);
  redirect(`/admin/corsi/${courseId}?salvato=1`);
}

export async function deleteLessonQuestion(courseId: string, lessonId: string, questionId: string) {
  const { db, course } = await requireEditableCourse(courseId);
  const lesson = course.lessons.find((l) => l.id === lessonId);
  if (lesson) lesson.questions = (lesson.questions ?? []).filter((q) => q.id !== questionId);
  await saveDb(db);
  redirect(`/admin/corsi/${courseId}?salvato=1`);
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
    maybeComplete(db, user.id, course!);
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
  await saveDb(db);
  revalidatePath("/", "layout");
  redirect("/admin/organizzazione/consorzio?salvato=1");
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
    (admin.role === "store_admin" && target!.storeId === admin.storeId);
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
    if (formData.get("siteStampe") === "on") sites.push("stampe");
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

  await saveDb(db);
  redirect(`/admin/utenti/${userId}?salvato=1`);
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
  await saveDb(db);
  redirect("/admin/email?template=1");
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
    db.emails.push({
      id: `e_${Date.now()}_reg`,
      userId: "",
      to: approvalTo,
      subject: `🔔 Nuova richiesta di registrazione: ${firstName} ${lastName}`,
      body: `${firstName} ${lastName} (${email}) chiede di registrarsi ad Academy GT per ${store!.name}. Approva o rifiuta la richiesta dalla pagina Utenti.`,
      type: "assegnazione",
      date: new Date().toISOString(),
      status: "inviata",
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
    (admin.role === "store_admin" && reg!.storeId === admin.storeId);
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
  queueEmail(db, newUser, "benvenuto");
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
    (admin.role === "store_admin" && reg!.storeId === admin.storeId);
  if (!allowed) redirect("/admin/utenti");
  reg!.status = "rejected";
  await saveDb(db);
  redirect("/admin/utenti?rifiutato=1");
}
