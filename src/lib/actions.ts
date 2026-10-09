"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { getDb, saveDb } from "./db";
import { uploadPublicFile } from "./supabase";
import { mailerConfig, sendMail, nomeMarchio, type Marchio } from "./mailer";
import { verifySsoToken } from "./sso";
import { AUTH_COOKIE, RUOLO_COOKIE, OPZIONI_SESSIONE, requireUser, valoreSessione, tokenReimposta, idDaTokenReimposta } from "./auth";
import { attesaMinuti, azzera, ipChiamante, Regola, segnaErrore } from "./tentativi";
import { assignableRolesFor, canManageUsers, delegatoUtenti, livelloGestioneUtenti, RUOLI_AMMINISTRATORE, coursesForUser, courseVisibleTo, dueDate, getProgress, hasStartedCourse, isCourseCompleted, pathsForUser } from "./logic";
import {
  Course, CourseLevel, CourseSession, DB, DEFAULT_HOME_BLOCKS, DEFAULT_REMINDER_RULES, DEFAULT_WATCH_THRESHOLD,
  EmailType, Lesson, LessonAttachment, LessonType, ReminderRule, ReminderStage, Role, SiteId, User, postLoginPath, ruoliDi, RUOLO_PRINCIPALE, ruoloEsteso, userSites, gestisce, gestisceConsorzio, livelloDi, isAcademyAdmin, permessoRuolo, PermessoRuolo, PERMESSI_RUOLO, PERMESSI_PREDEFINITI, ROLE_LABELS, PERMESSI_AREA, DEFAULT_TEMPLATES } from "./types";

/** Sostituisce variabili {{...}} e declina il genere: [maschile|femminile]. */
/** Solo formazione → "Academy GT"; qualsiasi altra area → "GT One". */
function marchioDi(user: User): Marchio {
  const aree = userSites(user);
  return aree.length === 0 || aree.every((a) => a === "academy") ? "academy" : "gtone";
}

function renderText(s: string, user: User, vars: Record<string, string>): string {
  // {{piattaforma}} nei modelli: "Academy GT" o "GT One" a seconda delle aree della persona
  const all: Record<string, string> = { nome: user.firstName, cognome: user.lastName, piattaforma: nomeMarchio(marchioDi(user)), ...vars };
  /*
   * Un elenco su più righe dentro una frase («…questa formazione: {{elenco}}.»,
   * come nei modelli salvati prima) faceva partire il primo punto attaccato
   * alla frase e lasciava un punto da solo in fondo: lo si stacca con una riga vuota.
   */
  if ((all.elenco ?? "").includes("\n")) {
    s = s.replace(/[ \t]*\{\{elenco\}\}\.?[ \t]*/g, "\n\n{{elenco}}\n\n").replace(/\n{3,}/g, "\n\n").trim();
  }
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
/** Indirizzo pubblico del portale, per i link dentro le email. */
function siteUrl(): string {
  return (process.env.SITE_URL || "https://gardenteam.vercel.app").replace(/\/$/, "");
}

async function pushEmail(db: DB, user: User, type: EmailType, subject: string, body: string) {
  /*
   * Il benvenuto è anche l'invito a entrare: senza il link per scegliere la
   * password la persona riceveva "il tuo account è attivo" e non sapeva come
   * accedere. Si aggiunge qui e non nel modello, così vale per tutti i testi,
   * comprese le personalizzazioni di insegna e punto vendita.
   */
  /*
   * Il link porta dritto alla scelta della password, firmato e valido 7 giorni:
   * prima portava a /attiva, dove bisognava chiedere un altro link. Chi entra da
   * my.rosaflor (SSO) non ha bisogno di password, ma il link non fa danni.
   */
  const eBenvenuto = type === "benvenuto" || type === "benvenuto_gtone";
  const tokenBenvenuto = eBenvenuto && !user.passwordHash ? tokenReimposta(user.id, undefined, 24 * 7) : "";
  const testo = eBenvenuto && !user.passwordHash
    ? `${body}

Per entrare la prima volta scegli la tua password qui (il link vale 7 giorni):
${tokenBenvenuto ? `${siteUrl()}/reimposta?token=${tokenBenvenuto}` : `${siteUrl()}/attiva`}

Se il link è scaduto, chiedine uno nuovo da ${siteUrl()}/attiva`
    : body;
  const r = await sendMail(user.email, subject, testo, { marchio: marchioDi(user) });
  db.emails.push({
    id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId: user.id,
    to: user.email,
    subject,
    body: testo,
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
  /*
   * Chi non ha l'area Academy (es. un gestore cartelli Zoo) non deve ricevere le
   * comunicazioni sui corsi: gli arrivava tutto — corsi assegnati, promemoria,
   * scadenze — pur non avendo alcuna formazione da seguire. Il benvenuto invece
   * riguarda l'accesso al portale, quindi vale per tutti.
   */
  if (type !== "benvenuto" && !userSites(user).includes("academy")) return;
  // il benvenuto di chi ha anche altre aree è quello di GT One (Utenti e ruoli → Email)
  const tipo: EmailType = type === "benvenuto" && marchioDi(user) === "gtone" ? "benvenuto_gtone" : type;
  const r = renderTemplate(db, user, tipo, vars);
  if (r) await pushEmail(db, user, tipo, r.subject, r.body);
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
  if (!userSites(user).includes("academy")) return false; // non fa formazione: niente corsi né avvisi
  /*
   * Le assegnazioni automatiche sono per chi fa la formazione (corsisti e capi
   * reparto), come i promemoria di runReminders. Agli amministratori e ai
   * gestori arrivava «Nuova formazione assegnata» con l'onboarding dei
   * neoassunti appena si salvava la loro scheda o li si creava. Non si segnano
   * come avvisati: se un giorno diventano corsisti, la mail parte allora.
   */
  if (user.role !== "student" && user.role !== "dept_head") return false;
  const newCourses = coursesForUser(db, user).filter(
    (c) => c.mandatory && !(user.notifiedCourseIds ?? []).includes(c.id)
  );
  const newPaths = pathsForUser(db, user).filter((p) => !(user.notifiedPathIds ?? []).includes(p.id));
  if (newCourses.length === 0 && newPaths.length === 0) return false;

  // uno per riga: in un elenco di cinque corsi la riga unica separata da virgole era illeggibile
  const elenco = [
    ...newCourses.map((c) => `• ${c.title}`),
    // «Percorso Percorso Reparto Verde»: il titolo spesso comincia già con «Percorso»
    ...newPaths.map((p) => (/^percorso\b/i.test(p.title.trim()) ? `• ${p.title}` : `• Percorso ${p.title}`)),
  ].join("\n");
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

export async function saveSsoDefaults(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireUser();
  if (admin.role !== "system_admin") return { ok: false, error: "Solo l'amministratore di sistema" };
  const db = await getDb();
  db.settings.ssoDefaultTenantId = String(formData.get("ssoDefaultTenantId") ?? "") || undefined;
  db.settings.ssoDefaultStoreId = String(formData.get("ssoDefaultStoreId") ?? "") || undefined;
  await saveDb(db);
  revalidatePath("/ruoli", "layout");
  return { ok: true };
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

/**
 * Chi può agire dentro l'Academy. Il controllo sulla macroarea sta qui e non
 * solo nelle pagine: le azioni server sono raggiungibili da sole, e un utente
 * abilitato alle sole Offerte Zoo non deve poter toccare corsi, lezioni o email
 * della formazione.
 */
async function requireAcademyUser(): Promise<User> {
  const user = await requireUser();
  if (!userSites(user).includes("academy")) redirect(postLoginPath(user));
  return user;
}

function canEditCourse(admin: User, course: Course): boolean {
  if (gestisceConsorzio(admin, "academy")) return true;
  // il gestore della formazione di un'insegna o di un PV ha gli stessi poteri dell'amministratore, sui corsi del suo ambito
  if (!permessoRuolo(admin.role, "corsi")) return false;
  const insegna = admin.role === "group_admin" || (admin.role !== "store_admin" && gestisce(admin, "academy") && livelloDi(admin) === "insegna");
  const pv = admin.role === "store_admin" || (admin.role !== "group_admin" && gestisce(admin, "academy") && livelloDi(admin) === "pv");
  if (insegna) return course.level !== "sistema" && course.tenantId === admin.tenantId;
  if (pv) return course.level === "punto_vendita" && course.storeId === admin.storeId;
  return false;
}

async function requireEditableCourse(courseId: string) {
  const admin = await requireAcademyUser();
  const db = await getDb();
  const course = db.courses.find((c) => c.id === courseId);
  if (!course || !canEditCourse(admin, course)) redirect("/admin/corsi");
  return { admin, db, course: course! };
}

/**
 * Login/iscrizione via SSO da My Rosaflor: se l'email non esiste ancora la
 * crea (reparto abbinato per nome, insegna/PV di default configurati in
 * Organizzazione → Consorzio), altrimenti fa accedere l'account esistente.
 * La verifica del token (firma/scadenza) avviene nella route /sso, PRIMA di
 * chiamare questa funzione: qui i dati sono già considerati fidati.
 */
export async function provisionSsoUser(
  token: string
): Promise<{ ok: true; userId: string } | { ok: false; reason: "disattivato" | "token" }> {
  /*
   * Il token si verifica QUI, non solo nella route: essendo un'azione server è
   * richiamabile dal browser come tutte le altre, e senza questo controllo
   * bastava conoscere un'email per farsi creare (o restituire) un account.
   */
  const payload = verifySsoToken(token);
  if (!payload) return { ok: false, reason: "token" };
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
      sites: ["academy"], // arriva da My Rosaflor per la formazione: quella area, non altre
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

export async function logout() {
  const store = await cookies();
  store.delete(AUTH_COOKIE);
  store.delete(RUOLO_COOKIE);
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
  const user = await requireAcademyUser();
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
  /*
   * I numeri arrivano dal browser: si accettano solo se plausibili. Il tempo
   * visto non può crescere più del tempo passato davvero dall'ultimo invio, e
   * la durata non si può abbassare (un "video da 5 secondi" completava tutto).
   */
  const trascorsi = Math.max(0, (Date.now() - new Date(view.lastAt).getTime()) / 1000);
  view.maxPercent = Math.min(100, Math.max(view.maxPercent, Math.round(Number(data.maxPercent) || 0)));
  const richiesti = Math.round(Number(data.secondsWatched) || 0);
  view.secondsWatched = Math.max(view.secondsWatched, Math.min(richiesti, view.secondsWatched + Math.ceil(trascorsi * 2) + 5)); // ×2: chi guarda a velocità doppia
  const durata = Math.round(Number(data.durationSec) || 0);
  if (durata > 0) view.durationSec = Math.max(view.durationSec ?? 0, durata);
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

/**
 * Domanda in sovraimpressione su un video: la risposta giusta resta sul server
 * (prima arrivava al browser insieme alla domanda).
 */
export async function rispondiDomandaVideo(courseId: string, lessonId: string, questionId: string, optionIndex: number) {
  await requireAcademyUser();
  const db = await getDb();
  const q = db.courses.find((c) => c.id === courseId)?.lessons.find((l) => l.id === lessonId)?.questions?.find((x) => x.id === questionId);
  return { giusta: !!q && q.correct === optionIndex };
}

export async function completeLesson(courseId: string, lessonId: string) {
  const user = await requireAcademyUser();
  const db = await getDb();
  const course = db.courses.find((c) => c.id === courseId);
  if (!course) return;
  /*
   * Solo una lezione vera di un corso che la persona vede, e non un quiz o uno
   * SCORM (quelli si completano superandoli): prima si poteva "completare"
   * qualsiasi id su qualsiasi corso e ottenere il certificato.
   */
  const lezione = course.lessons.find((l) => l.id === lessonId);
  if (!lezione || lezione.type === "quiz" || lezione.type === "scorm") return;
  if (!courseVisibleTo(course, user) && user.role === "student") return;
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
  const user = await requireAcademyUser();
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
  const user = await requireAcademyUser();
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
  const admin = await requireAcademyUser();
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
      sites: ["academy"], // import di corsisti: solo la formazione
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
  const admin = await requireAcademyUser();
  /*
   * Crea corsi solo chi li può anche modificare (Consorzio, insegna, PV): prima
   * bastava avere l'area formazione, e uno studente poteva assegnare un corso
   * obbligatorio a tutta la sua insegna.
   */
  const gestoreFormazione = admin.role !== "group_admin" && admin.role !== "store_admin" && gestisce(admin, "academy");
  const puoCorsi = permessoRuolo(admin.role, "corsi");
  const perInsegna = puoCorsi && (admin.role === "group_admin" || (gestoreFormazione && livelloDi(admin) === "insegna"));
  const perPv = puoCorsi && (admin.role === "store_admin" || (gestoreFormazione && livelloDi(admin) === "pv"));
  if (!gestisceConsorzio(admin, "academy") && !perInsegna && !perPv) redirect("/admin/corsi");
  const db = await getDb();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) redirect("/admin/corsi");
  const livelloChiesto = String(formData.get("level") ?? "sistema");
  const livelliValidi: CourseLevel[] = ["sistema", "insegna", "punto_vendita"];
  let level = (livelliValidi.includes(livelloChiesto as CourseLevel) ? livelloChiesto : "insegna") as CourseLevel;
  // chi lavora per un punto vendita crea solo corsi del suo punto vendita
  if (!gestisceConsorzio(admin, "academy") && perPv && !perInsegna) level = "punto_vendita";
  const dept = String(formData.get("department") ?? "");
  const canSystem = gestisceConsorzio(admin, "academy");
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

  const canSystem = gestisceConsorzio(admin, "academy");
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
  const { admin, db, course } = await requireEditableCourse(courseId);
  /*
   * Un pacchetto SCORM è HTML e JavaScript che gira sul dominio del sito, con la
   * sessione di chi lo apre: lo carica solo chi gestisce la formazione del
   * Consorzio, non ogni gestore di punto vendita.
   */
  if (!gestisceConsorzio(admin, "academy")) {
    return { ok: false as const, error: "I pacchetti SCORM li carica solo chi gestisce la formazione del Consorzio." };
  }
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
  const user = await requireAcademyUser();
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
  const admin = await requireAcademyUser();
  // le email partono verso tutto il consorzio: non è un pulsante da capo reparto
  if (!gestisceConsorzio(admin, "academy")) redirect("/admin/email");
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

export async function toggleUserActive(userId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireUser();
  const db = await getDb();
  const target = db.users.find((u) => u.id === userId);
  if (!target || target.id === admin.id || target.role === "system_admin") return { ok: false, error: "Non consentito" };
  if (!canTouchUser(db, admin, target)) return { ok: false, error: "Fuori dal tuo ambito" };
  target.active = target.active === false;
  await saveDb(db);
  revalidatePath("/admin/utenti");
  revalidatePath("/ruoli");
  return { ok: true };
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
  const user = await requireAcademyUser();
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

/** Organizzazione (insegna/PV, reparti, gruppi): il permesso del ruolo, oltre al proprio ambito. */
function puoOrganizzazione(u: User): boolean {
  return u.role === "system_admin" || permessoRuolo(u.role, "organizzazione");
}

function canManageTenant(admin: User, tenantId: string): boolean {
  return admin.role === "system_admin" || (admin.role === "group_admin" && admin.tenantId === tenantId && puoOrganizzazione(admin));
}

/*
 * Le schede di Organizzazione si salvano da sole (ModuloAutoSalva): le azioni
 * rispondono { ok, error } invece di rimandare alla pagina, che così non si
 * ricarica a ogni modifica.
 */
export async function updateTenant(tenantId: string, formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireUser();
  if (!canManageTenant(admin, tenantId)) return { ok: false, error: "Non puoi modificare questa insegna" };
  const db = await getDb();
  const t = db.tenants.find((x) => x.id === tenantId);
  if (!t) return { ok: false, error: "Insegna non trovata" };
  const name = String(formData.get("name") ?? "").trim();
  if (name) t.name = name;
  const color = String(formData.get("color") ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(color)) t.color = color;
  const emoji = String(formData.get("emoji") ?? "").trim();
  if (emoji) t.emoji = emoji.slice(0, 4);
  t.welcome = String(formData.get("welcome") ?? "").trim() || undefined;
  t.secretWord = String(formData.get("secretWord") ?? "").trim() || undefined;
  t.approvalEmail = String(formData.get("approvalEmail") ?? "").trim() || undefined;
  const logo = formData.get("logo") as File | null;
  if (logo && logo.size > 0) {
    if (!logo.type.startsWith("image/")) return { ok: false, error: "Il logo dev'essere un'immagine" };
    const ext = (logo.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
    const file = `${tenantId}_${Date.now()}.${ext}`;
    t.logoUrl = await uploadPublicFile(`loghi/${file}`, Buffer.from(await logo.arrayBuffer()), logo.type);
  }
  await saveDb(db);
  revalidatePath("/ruoli", "layout");
  return { ok: true };
}

/** Un'insegna aggiunge un suo punto vendita (o il Consorzio per lei). */
export async function creaPuntoVendita(tenantId: string, formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireUser();
  if (!canManageTenant(admin, tenantId)) return { ok: false, error: "Non puoi aggiungere punti vendita a questa insegna" };
  const db = await getDb();
  if (!db.tenants.some((t) => t.id === tenantId)) return { ok: false, error: "Insegna non trovata" };
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Serve il nome del punto vendita" };
  if (db.stores.some((st) => st.tenantId === tenantId && st.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: "C'è già un punto vendita con questo nome" };
  }
  // id progressivo come gli altri (s1, s2…): il primo numero libero
  const usati = new Set(db.stores.map((st) => st.id));
  let n = db.stores.length + 1;
  while (usati.has(`s${n}`)) n++;
  db.stores.push({ id: `s${n}`, tenantId, name, city: String(formData.get("city") ?? "").trim() });
  await saveDb(db);
  revalidatePath("/ruoli", "layout");
  return { ok: true };
}

export async function updateStore(storeId: string, formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireUser();
  const db = await getDb();
  const s = db.stores.find((x) => x.id === storeId);
  if (!s) return { ok: false, error: "Punto vendita non trovato" };
  const allowed =
    admin.role === "system_admin" ||
    (puoOrganizzazione(admin) && (
      (admin.role === "group_admin" && admin.tenantId === s.tenantId) ||
      (admin.role === "store_admin" && admin.storeId === storeId)));
  if (!allowed) return { ok: false, error: "Non puoi modificare questo punto vendita" };
  const name = String(formData.get("name") ?? "").trim();
  if (name) s.name = name;
  s.city = String(formData.get("city") ?? "").trim();
  s.welcome = String(formData.get("welcome") ?? "").trim() || undefined;
  s.secretWord = String(formData.get("secretWord") ?? "").trim() || undefined;
  s.approvalEmail = String(formData.get("approvalEmail") ?? "").trim() || undefined;
  await saveDb(db);
  revalidatePath("/ruoli", "layout");
  return { ok: true };
}

/* ================== Impostazioni del consorzio (portale) ================== */

export async function updateSettings(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireUser();
  if (admin.role !== "system_admin") return { ok: false, error: "Solo l'amministratore di sistema" };
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
  // parola segreta comune: vale per registrarsi in qualsiasi punto vendita
  s.secretWord = String(formData.get("secretWord") ?? "").trim() || undefined;
  const font = String(formData.get("font") ?? "");
  if (font) s.font = font;
  const logo = formData.get("logo") as File | null;
  if (logo && logo.size > 0 && logo.type.startsWith("image/")) {
    const ext = (logo.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
    const file = `consorzio_${Date.now()}.${ext}`;
    s.logoUrl = await uploadPublicFile(`loghi/${file}`, Buffer.from(await logo.arrayBuffer()), logo.type);
  }
  s.leaderboardAnonymous = formData.get("leaderboardAnonymous") === "on";
  await saveDb(db);
  revalidatePath("/", "layout");
  return { ok: true };
}

/* ---------- Foto delle aree nella pagina Scegli ---------- */
const CHIAVI_AREE = ["academy", "arredo", "zoo", "piante", "ruoli", "archivio", "articoli"];

/** L'amministratore di sistema cambia la foto di copertina di un'area (vale per tutti). */
export async function cambiaFotoArea(chiave: string, formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireUser();
  if (admin.role !== "system_admin") return { ok: false, error: "Solo l'amministratore di sistema" };
  if (!CHIAVI_AREE.includes(chiave)) return { ok: false, error: "Area sconosciuta" };
  const foto = formData.get("foto") as File | null;
  if (!foto || foto.size === 0) return { ok: false, error: "Nessuna foto scelta" };
  if (!foto.type.startsWith("image/")) return { ok: false, error: "Dev'essere un'immagine" };
  if (foto.size > 8 * 1024 * 1024) return { ok: false, error: "Foto troppo grande (massimo 8 MB)" };
  const ext = (foto.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
  const url = await uploadPublicFile(`aree/${chiave}_${Date.now()}.${ext}`, Buffer.from(await foto.arrayBuffer()), foto.type);
  const db = await getDb();
  db.settings.fotoAree = { ...(db.settings.fotoAree ?? {}), [chiave]: url };
  await saveDb(db);
  revalidatePath("/scegli");
  return { ok: true };
}

/** Torna alla foto di serie. */
export async function ripristinaFotoArea(chiave: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireUser();
  if (admin.role !== "system_admin") return { ok: false, error: "Solo l'amministratore di sistema" };
  const db = await getDb();
  if (db.settings.fotoAree) delete db.settings.fotoAree[chiave];
  await saveDb(db);
  revalidatePath("/scegli");
  return { ok: true };
}

/** "Ripristina i verdi Garden Team": un pulsante a parte, non una spunta che si salva da sola. */
export async function ripristinaColori(): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireUser();
  if (admin.role !== "system_admin") return { ok: false, error: "Solo l'amministratore di sistema" };
  const db = await getDb();
  db.settings.colorPrimary = "#00652e";
  db.settings.colorAccent = "#8dc63f";
  await saveDb(db);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Ordine e visibilità dei blocchi della home studente, configurabili senza sviluppo. */
export async function moveHomeBlock(index: number, dir: number) {
  const admin = await requireAcademyUser();
  if (admin.role !== "system_admin") return { ok: false as const };
  const db = await getDb();
  const blocks = db.settings.homeBlocks ?? [...DEFAULT_HOME_BLOCKS];
  const target = index + dir;
  if (target < 0 || target >= blocks.length) return { ok: false as const };
  [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
  db.settings.homeBlocks = blocks;
  await saveDb(db);
  revalidatePath("/ruoli/organizzazione/consorzio");
  revalidatePath("/studente");
  return { ok: true as const };
}

export async function toggleHomeBlock(index: number) {
  const admin = await requireAcademyUser();
  if (admin.role !== "system_admin") return { ok: false as const };
  const db = await getDb();
  const blocks = db.settings.homeBlocks ?? [...DEFAULT_HOME_BLOCKS];
  if (!blocks[index]) return { ok: false as const };
  blocks[index].enabled = !blocks[index].enabled;
  db.settings.homeBlocks = blocks;
  await saveDb(db);
  revalidatePath("/ruoli/organizzazione/consorzio");
  revalidatePath("/studente");
  return { ok: true as const };
}

/* ================== Utenti e ruoli (pagina Ruoli, modifiche rapide) ================== */

/**
 * Aree che un responsabile può dare o togliere: solo quelle che ha lui stesso.
 * Senza questo limite bastava spuntare le caselle sul proprio profilo per
 * entrare in un'area che nessuno gli aveva assegnato. Le aree che l'admin non
 * ha restano come sono: non le può né dare né togliere.
 */
function sitesAssegnabili(admin: User, target: User, scelte: SiteId[]): SiteId[] {
  if (admin.role === "system_admin") return scelte;
  const mie = userSites(admin);
  const restano = (target.sites ?? []).filter((s) => !mie.includes(s));
  return [...new Set([...scelte.filter((s) => mie.includes(s)), ...restano])];
}

/*
 * Aree che si possono far GESTIRE a qualcuno: solo quelle che l'admin gestisce
 * lui stesso, non quelle a cui ha solo accesso. Altrimenti chi entra nello Zoo
 * poteva nominare gestore dello Zoo un collega (o se stesso).
 */
function gestioniAssegnabili(admin: User, target: User, scelte: SiteId[]): SiteId[] {
  if (admin.role === "system_admin") return scelte;
  const mie = userSites(admin).filter((s) => gestisce(admin, s));
  const restano = (target.manages ?? []).filter((s) => !mie.includes(s));
  return [...new Set([...scelte.filter((s) => mie.includes(s)), ...restano])];
}

/** Il bersaglio è nel perimetro dell'admin e l'admin ha la gestione utenti attiva? */
function canTouchUser(db: DB, admin: User, target: User): boolean {
  const livello = livelloGestioneUtenti(db, admin);
  if (!livello) return false;
  // contano anche i ruoli in più: un amministratore resta tale anche se oggi opera da gestore
  const ruoli = ruoliDi(target);
  if (ruoli.includes("system_admin") && admin.role !== "system_admin") return false;
  // chi ha solo l'incarico non tocca gli amministratori (nemmeno per cessarli)
  if (delegatoUtenti(admin) && ruoli.some((r) => RUOLI_AMMINISTRATORE.includes(r))) return false;
  if (livello === "consorzio") return true;
  if (livello === "insegna") return target.tenantId === admin.tenantId;
  return target.storeId === admin.storeId;
}

/**
 * Dà o toglie l'incarico "gestisce utenti e ruoli". Lo decide solo un
 * amministratore (di sistema, insegna o punto vendita) per le persone del suo
 * ambito: chi ha l'incarico non lo può passare ad altri.
 */
export async function quickSetGestioneUtenti(userId: string, attivo: boolean) {
  const admin = await requireUser();
  const db = await getDb();
  const target = db.users.find((u) => u.id === userId);
  if (!target || target.id === admin.id) return { ok: false as const, error: "Non consentito" };
  if (!RUOLI_AMMINISTRATORE.includes(admin.role)) return { ok: false as const, error: "Lo decide un amministratore" };
  if (!canTouchUser(db, admin, target)) return { ok: false as const, error: "Fuori dal tuo ambito" };
  if (RUOLI_AMMINISTRATORE.includes(target.role)) return { ok: false as const, error: "Gli amministratori gestiscono già gli utenti" };
  target.gestioneUtenti = attivo || undefined;
  await saveDb(db);
  revalidatePath("/ruoli");
  return { ok: true as const };
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

/* ================== Più ruoli per la stessa persona ================== */

/**
 * Aggiunge un ruolo in più (con le sue aree) a una persona. Valgono le stesse
 * regole del ruolo principale: solo nel proprio ambito, solo i ruoli che si
 * possono assegnare, solo le aree che si hanno e le gestioni che si hanno.
 * Nessuno, salvo l'amministratore di sistema, si aggiunge ruoli da solo.
 */
export async function aggiungiRuoloExtra(userId: string, role: Role, sites: SiteId[], manages: SiteId[]) {
  const admin = await requireUser();
  const db = await getDb();
  const target = db.users.find((u) => u.id === userId);
  if (!target) return { ok: false as const, error: "Utente non trovato" };
  if (target.id === admin.id && admin.role !== "system_admin") return { ok: false as const, error: "I tuoi ruoli li cambia chi ti gestisce" };
  if (!canTouchUser(db, admin, target)) return { ok: false as const, error: "Fuori dal tuo ambito" };
  if (!assignableRolesFor(admin).includes(role)) return { ok: false as const, error: "Ruolo non assegnabile dal tuo profilo" };
  const vuoto = { ...target, sites: [], manages: [] } as User;
  const aree = role === "system_admin" ? [] : sitesAssegnabili(admin, vuoto, sites);
  const gestite = role === "manager" ? gestioniAssegnabili(admin, vuoto, manages).filter((x) => aree.includes(x)) : undefined;
  if (role !== "system_admin" && role !== "grafico" && aree.length === 0) return { ok: false as const, error: "Spunta almeno un'area per questo ruolo" };
  const uguale = (r: Role, a: SiteId[] = [], g: SiteId[] = []) =>
    r === role && [...a].sort().join() === [...aree].sort().join() && [...g].sort().join() === [...(gestite ?? [])].sort().join();
  if (uguale(target.role, target.sites, target.manages) || (target.ruoliExtra ?? []).some((x) => uguale(x.role, x.sites, x.manages))) {
    return { ok: false as const, error: "Ha già questo ruolo con queste aree" };
  }
  target.ruoliExtra = [...(target.ruoliExtra ?? []), { id: `r${Date.now().toString(36)}${randomBytes(2).toString("hex")}`, role, sites: aree, manages: gestite }];
  await saveDb(db);
  revalidatePath("/ruoli");
  return { ok: true as const };
}

/**
 * Cambia un ruolo in più dalla tabella: il ruolo (dal menu a tendina) e, per
 * il gestore, quali delle sue aree gestisce. Stesse regole dell'aggiunta.
 */
export async function aggiornaRuoloExtra(userId: string, profiloId: string, modifica: { role?: Role; manages?: SiteId[] }) {
  const admin = await requireUser();
  const db = await getDb();
  const target = db.users.find((u) => u.id === userId);
  if (!target) return { ok: false as const, error: "Utente non trovato" };
  if (target.id === admin.id && admin.role !== "system_admin") return { ok: false as const, error: "I tuoi ruoli li cambia chi ti gestisce" };
  if (!canTouchUser(db, admin, target)) return { ok: false as const, error: "Fuori dal tuo ambito" };
  const p = (target.ruoliExtra ?? []).find((x) => x.id === profiloId);
  if (!p) return { ok: false as const, error: "Ruolo non trovato: ricarica la pagina" };
  const assegnabili = assignableRolesFor(admin);
  if (!assegnabili.includes(p.role)) return { ok: false as const, error: "Questo ruolo lo cambia chi lo può assegnare" };
  if (modifica.role && modifica.role !== p.role) {
    if (!assegnabili.includes(modifica.role)) return { ok: false as const, error: "Ruolo non assegnabile dal tuo profilo" };
    if (modifica.role === target.role || (target.ruoliExtra ?? []).some((x) => x.id !== p.id && x.role === modifica.role && modifica.role !== "manager")) {
      return { ok: false as const, error: "Ha già questo ruolo" };
    }
    p.role = modifica.role;
    if (p.role === "system_admin") p.sites = [];
    else if (!(p.sites ?? []).length) p.sites = [...(target.sites ?? [])];
    // diventato gestore: gestisce le sue aree, finché non si tolgono
    p.manages = p.role === "manager" ? gestioniAssegnabili(admin, { ...target, manages: [] }, p.sites ?? []) : undefined;
  }
  if (modifica.manages && p.role === "manager") {
    p.manages = gestioniAssegnabili(admin, { ...target, manages: p.manages ?? [] }, modifica.manages).filter((x) => (p.sites ?? []).includes(x));
  }
  await saveDb(db);
  revalidatePath("/ruoli");
  return { ok: true as const };
}

/** Toglie un ruolo in più: chi lo toglie deve poterlo assegnare. */
export async function togliRuoloExtra(userId: string, profiloId: string) {
  const admin = await requireUser();
  const db = await getDb();
  const target = db.users.find((u) => u.id === userId);
  if (!target) return { ok: false as const, error: "Utente non trovato" };
  if (target.id === admin.id && admin.role !== "system_admin") return { ok: false as const, error: "I tuoi ruoli li cambia chi ti gestisce" };
  if (!canTouchUser(db, admin, target)) return { ok: false as const, error: "Fuori dal tuo ambito" };
  const p = (target.ruoliExtra ?? []).find((x) => x.id === profiloId);
  if (!p) return { ok: true as const };
  if (!assignableRolesFor(admin).includes(p.role)) return { ok: false as const, error: `Il ruolo «${ruoloEsteso({ ...target, role: p.role, manages: p.manages })}» lo toglie chi lo può assegnare` };
  target.ruoliExtra = (target.ruoliExtra ?? []).filter((x) => x.id !== profiloId);
  if (target.ruoliExtra.length === 0) target.ruoliExtra = undefined;
  await saveDb(db);
  revalidatePath("/ruoli");
  return { ok: true as const };
}

/**
 * Sceglie con che ruolo operare (il principale o uno dei propri ruoli in più)
 * e torna alla scelta delle aree, che ora mostra quelle di quel ruolo.
 */
export async function scegliRuolo(scelta: string): Promise<void> {
  const user = await requireUser();
  const db = await getDb();
  const base = db.users.find((u) => u.id === user.id);
  const valida = scelta === RUOLO_PRINCIPALE || (base?.ruoliExtra ?? []).some((p) => p.id === scelta);
  if (!valida) redirect("/scegli");
  const store = await cookies();
  // dura quanto la sessione: al prossimo ingresso si sceglie di nuovo
  store.set(RUOLO_COOKIE, scelta, OPZIONI_SESSIONE);
  redirect("/scegli?ruolo=1");
}

export async function quickSetSites(userId: string, sites: SiteId[]) {
  const admin = await requireUser();
  const db = await getDb();
  const target = db.users.find((u) => u.id === userId);
  if (!target) return { ok: false as const, error: "Utente non trovato" };
  if (!canTouchUser(db, admin, target)) return { ok: false as const, error: "Fuori dal tuo ambito" };
  target.sites = sitesAssegnabili(admin, target, sites);
  await saveDb(db);
  revalidatePath("/admin/ruoli");
  return { ok: true as const };
}

/** Aree gestite dal gestore (le altre in accesso le usa da operativo). */
export async function quickSetManages(userId: string, manages: SiteId[]) {
  const admin = await requireUser();
  const db = await getDb();
  const target = db.users.find((u) => u.id === userId);
  if (!target) return { ok: false as const, error: "Utente non trovato" };
  if (!canTouchUser(db, admin, target)) return { ok: false as const, error: "Fuori dal tuo ambito" };
  if (target.role !== "manager") return { ok: false as const, error: "Le aree gestite valgono solo per il gestore" };
  // nessuno (salvo l'amministratore di sistema) si dà da solo la gestione di un'area
  if (target.id === admin.id && admin.role !== "system_admin") return { ok: false as const, error: "Le tue aree gestite le cambia chi ti gestisce" };
  // si può far gestire solo un'area che si gestisce, e a cui il gestore ha accesso
  const ammesse = gestioniAssegnabili(admin, target, manages)
    .filter((s) => userSites(target).includes(s));
  target.manages = ammesse;
  await saveDb(db);
  revalidatePath("/ruoli");
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

/**
 * Crea un collaboratore direttamente da "Utenti e ruoli", senza aspettare che si
 * registri da solo o che arrivi da un import: l'account nasce senza password e si
 * attiva al primo accesso da "Attiva utente", come quelli importati da CSV.
 * L'ambito lo decide chi lo crea — un'insegna non può creare fuori dalla propria,
 * un punto vendita nemmeno fuori dal proprio negozio.
 */
export async function creaUtente(formData: FormData) {
  const admin = await requireUser();
  const db = await getDb();
  if (!canManageUsers(db, admin)) return { ok: false as const, error: "Non hai il permesso di creare utenti" };

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!firstName || !lastName || !email.includes("@")) return { ok: false as const, error: "Nome, cognome ed email sono obbligatori" };
  if (db.users.some((u) => u.email.toLowerCase() === email)) return { ok: false as const, error: "Esiste già un utente con questa email" };

  const role = String(formData.get("role") ?? "student") as Role;
  if (!assignableRolesFor(admin).includes(role)) return { ok: false as const, error: "Ruolo non assegnabile dal tuo profilo" };

  // insegna e punto vendita: il Consorzio sceglie, gli altri restano nel proprio perimetro
  const livello = livelloGestioneUtenti(db, admin)!;
  const storeId = livello === "pv" ? admin.storeId : (String(formData.get("storeId") ?? "") || undefined);
  const store = storeId ? db.stores.find((s) => s.id === storeId) : undefined;
  const tenantId = livello === "consorzio"
    ? (store?.tenantId ?? (String(formData.get("tenantId") ?? "") || undefined))
    : admin.tenantId;
  if (livello === "insegna" && store && store.tenantId !== admin.tenantId) {
    return { ok: false as const, error: "Quel punto vendita non è della tua insegna" };
  }

  const sites = (formData.getAll("sites") as string[]).filter(Boolean) as SiteId[];
  const newUser: User = {
    id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    firstName, lastName, email, role,
    tenantId, storeId: store?.id,
    departmentId: String(formData.get("departmentId") ?? "") || undefined,
    jobTitle: String(formData.get("jobTitle") ?? "").trim() || undefined,
    hireDate: String(formData.get("hireDate") ?? "") || new Date().toISOString().slice(0, 10),
    points: 0, badges: [], active: true,
    // serve alle email, che declinano il testo: "[benvenuto|benvenuta]"
    ...(["m", "f"].includes(String(formData.get("gender") ?? "")) ? { gender: String(formData.get("gender")) as "m" | "f" } : {}),
    // aree sempre scritte: nessuna spunta = nessun accesso, finché non gliele si danno
    sites: admin.role === "system_admin" ? sites : sites.filter((x) => userSites(admin).includes(x)),
    ...(role === "manager"
      ? { manages: (formData.getAll("manages") as SiteId[]).filter((x) => sites.includes(x) && (admin.role === "system_admin" || gestisce(admin, x))) }
      : {}),
  };
  // i ruoli in più scelti nel modulo: stesse aree del principale; il gestore gestisce
  // le aree spuntate in «Aree che gestisce», o se non ce ne sono tutte le sue aree
  const gestibili = (aree: SiteId[]) => aree.filter((x) => admin.role === "system_admin" || gestisce(admin, x));
  const spuntateGestite = (formData.getAll("manages") as SiteId[]).filter((x) => (newUser.sites ?? []).includes(x));
  const altri = [...new Set((formData.getAll("ruoliExtra") as string[]).filter(Boolean) as Role[])]
    .filter((r) => r !== role && assignableRolesFor(admin).includes(r));
  if (altri.length) {
    newUser.ruoliExtra = altri.map((r, i) => ({
      id: `r${Date.now().toString(36)}${i}${randomBytes(2).toString("hex")}`,
      role: r,
      sites: r === "system_admin" ? [] : [...(newUser.sites ?? [])],
      manages: r === "manager" ? gestibili(spuntateGestite.length ? spuntateGestite : newUser.sites ?? []) : undefined,
    }));
  }
  db.users.push(newUser);
  await queueEmail(db, newUser, "benvenuto");
  await notifyNewAssignments(db, newUser);
  await saveDb(db);
  revalidatePath("/ruoli");
  revalidatePath("/admin/utenti");
  return { ok: true as const, id: newUser.id };
}

/**
 * Cancellazione definitiva (non la cessazione, che blocca solo l'accesso): rimuove
 * l'utente e ripulisce i riferimenti nelle tabelle collegate (progressi, certificati,
 * feedback, iscrizioni automatiche). Il registro invii resta intatto come storico:
 * la pagina Email già mostra "—" per il destinatario quando l'utente non esiste più.
 */
export async function deleteUsers(userIds: string[]) {
  const admin = await requireUser();
  const db = await getDb();
  const targets = db.users.filter((u) => userIds.includes(u.id));
  const deletable = targets.filter((t) => t.id !== admin.id && canTouchUser(db, admin, t));
  if (deletable.length === 0) return { ok: false as const, error: "Nessun utente cancellabile nel tuo ambito" };
  const ids = new Set(deletable.map((t) => t.id));
  db.users = db.users.filter((u) => !ids.has(u.id));
  db.progress = db.progress.filter((p) => !ids.has(p.userId));
  db.assignments = db.assignments.filter((a) => !ids.has(a.userId));
  db.certificates = db.certificates.filter((c) => !ids.has(c.userId));
  db.feedback = db.feedback.filter((f) => !ids.has(f.userId));
  await saveDb(db);
  revalidatePath("/admin/ruoli");
  revalidatePath("/admin/utenti");
  const skipped = targets.length - deletable.length;
  return { ok: true as const, deleted: deletable.length, skipped };
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

export async function updateUser(userId: string, formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireUser();
  const db = await getDb();
  const target = db.users.find((u) => u.id === userId);
  if (!target) return { ok: false, error: "Utente non trovato" };
  const allowed = canTouchUser(db, admin, target) || (admin.id === target.id && admin.role === "system_admin");
  if (!allowed || (ruoliDi(target).includes("system_admin") && admin.id !== target.id)) return { ok: false, error: "Fuori dal tuo ambito" };
  // chi ha solo l'incarico non si cambia da sé ruolo e aree
  const suSeStesso = admin.id === target.id && delegatoUtenti(admin);

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
  if (formData.get("sitesForm") === "1" && !suSeStesso) {
    const sites: SiteId[] = [];
    if (formData.get("siteAcademy") === "on") sites.push("academy");
    if (formData.get("siteArredo") === "on") sites.push("arredo");
    if (formData.get("siteZoo") === "on") sites.push("zoo");
    if (formData.get("sitePiante") === "on") sites.push("piante");
    target!.sites = sitesAssegnabili(admin, target!, sites);
  }

  const role = String(formData.get("role") ?? "") as Role;
  if (role && !suSeStesso && assignableRolesFor(admin).includes(role)) target!.role = role;
  // aree gestite (solo per il gestore): come le aree di accesso, si danno solo quelle che si hanno
  if (formData.get("managesForm") === "1" && !(admin.id === target!.id && admin.role !== "system_admin")) {
    const scelte = (formData.getAll("manages") as string[]).filter(Boolean) as SiteId[];
    target!.manages = target!.role === "manager" ? gestioniAssegnabili(admin, target!, scelte) : undefined;
  }

  const storeId = String(formData.get("storeId") ?? "");
  if (storeId) {
    const store = db.stores.find((x) => x.id === storeId);
    const livello = livelloGestioneUtenti(db, admin);
    const canMove =
      livello === "consorzio" ||
      (livello === "insegna" && store?.tenantId === admin.tenantId) ||
      (livello === "pv" && storeId === admin.storeId);
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
  revalidatePath("/admin/utenti");
  revalidatePath("/ruoli");
  return { ok: true };
}

/**
 * Invio di prova: verifica dal browser che chiave, mittente e DNS di Resend
 * siano a posto, senza aspettare che scatti un'automazione vera. Non finisce
 * nel registro invii (non è una comunicazione a un collaboratore).
 */
export async function sendTestEmail(formData: FormData) {
  const admin = await requireAcademyUser();
  if (!gestisceConsorzio(admin, "academy")) redirect("/admin/email");
  const to = String(formData.get("to") ?? "").trim();
  if (!to.includes("@")) redirect("/admin/email?prova=" + encodeURIComponent("Indirizzo non valido."));
  const cfg = mailerConfig();
  if (!cfg.enabled) {
    redirect("/admin/email?prova=" + encodeURIComponent("Invio reale non configurato: mancano RESEND_API_KEY o EMAIL_FROM."));
  }
  const r = await sendMail(
    to,
    "Prova di invio da GT One",
    `Se leggi questo messaggio, l'invio email di GT One funziona.

Mittente configurato: ${cfg.from}
Inviata il ${new Date().toLocaleString("it-IT")}.`,
    { marchio: "gtone" },
  );
  redirect("/admin/email?prova=" + encodeURIComponent(r.sent ? "ok" : `Errore dal provider: ${r.error ?? "sconosciuto"}`));
}

/* ================== Modelli email ================== */

/*
 * Chi può toccare i modelli email e di quale ambito: il Consorzio quelli comuni,
 * l'insegna i suoi, il punto vendita i suoi. Chi non è né l'uno né l'altro (es.
 * un gestore di un'altra area senza insegna) non tocca niente: prima finiva
 * sui modelli COMUNI a tutto il portale.
 */
function ambitoModelli(admin: User): { globale: true } | { globale: false; tenantId: string; storeId?: string } | null {
  if (gestisceConsorzio(admin, "academy")) return { globale: true };
  if (!permessoRuolo(admin.role, "modelliEmail")) return null;
  const gestoreFormazione = admin.role === "manager" && gestisce(admin, "academy");
  if ((admin.role === "store_admin" || (gestoreFormazione && livelloDi(admin) === "pv")) && admin.tenantId && admin.storeId) {
    return { globale: false, tenantId: admin.tenantId, storeId: admin.storeId };
  }
  if ((admin.role === "group_admin" || (gestoreFormazione && livelloDi(admin) === "insegna")) && admin.tenantId) {
    return { globale: false, tenantId: admin.tenantId };
  }
  return null;
}

export async function saveTemplate(type: EmailType, formData: FormData) {
  const admin = await requireAcademyUser();
  const ambito = ambitoModelli(admin);
  if (!ambito) redirect("/admin");
  const db = await getDb();
  const isGlobal = ambito!.globale;
  const isStore = !ambito!.globale && !!ambito!.storeId;
  const tenantId = ambito!.globale ? undefined : ambito!.tenantId;
  const storeId = !ambito!.globale ? ambito!.storeId : undefined;
  let tpl = db.templates.find((t) =>
    t.type === type &&
    (isGlobal ? !t.tenantId && !t.storeId : isStore ? t.storeId === storeId : t.tenantId === tenantId && !t.storeId)
  );
  if (!tpl) {
    const base = db.templates.find((t) => t.type === type && !t.tenantId && !t.storeId);
    if (!base) redirect("/admin/email");
    tpl = { ...base!, tenantId, storeId };
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
  const admin = await requireAcademyUser();
  const ambito = ambitoModelli(admin);
  if (!ambito) redirect("/admin");
  const db = await getDb();
  if (ambito!.globale) {
    const { DEFAULT_TEMPLATES } = await import("./types");
    const def = DEFAULT_TEMPLATES.find((t) => t.type === type);
    const tpl = db.templates.find((t) => t.type === type && !t.tenantId && !t.storeId);
    if (def && tpl) {
      tpl.subject = def.subject;
      tpl.body = def.body;
      tpl.enabled = true;
    }
  } else if (ambito!.storeId) {
    const sid = ambito!.storeId;
    db.templates = db.templates.filter((t) => !(t.type === type && t.storeId === sid));
  } else {
    const tid = ambito!.tenantId;
    db.templates = db.templates.filter((t) => !(t.type === type && t.tenantId === tid && !t.storeId));
  }
  await saveDb(db);
  redirect("/admin/email?template=1");
}

/* ================== Modelli aggiuntivi e impostazioni automazioni ================== */

export async function saveCustomTemplate(templateId: string | null, formData: FormData) {
  const admin = await requireAcademyUser();
  if (!isAcademyAdmin(admin) || admin.role === "dept_head") redirect("/admin");
  const db = await getDb();
  const name = String(formData.get("name") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const trigger = String(formData.get("trigger") ?? "benvenuto") as EmailType;
  if (!name || !subject || !body) redirect("/admin/email");
  const isGlobal = gestisceConsorzio(admin, "academy");
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
  const admin = await requireAcademyUser();
  const db = await getDb();
  const ct = db.customTemplates.find((x) => x.id === templateId);
  if (!ct) redirect("/admin/email");
  const isGlobal = gestisceConsorzio(admin, "academy");
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
  const admin = await requireAcademyUser();
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
  if (gestisceConsorzio(admin, "academy")) return true;
  // il permesso "Percorsi formativi" del ruolo, sui percorsi della propria insegna
  if (permessoRuolo(admin.role, "percorsi") && admin.tenantId) return level !== "sistema" && tenantId === admin.tenantId;
  return false;
}

export async function savePath(pathId: string | null, formData: FormData) {
  const admin = await requireAcademyUser();
  const db = await getDb();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false as const, error: "Il titolo è obbligatorio" };
  const level = (["sistema", "insegna", "punto_vendita"].includes(String(formData.get("level")))
    ? String(formData.get("level"))
    : "sistema") as CourseLevel;
  const tenantId = admin.role === "group_admin" ? admin.tenantId : (String(formData.get("tenantId") ?? "").trim() || undefined);
  if (!canEditPath(admin, level, level === "sistema" ? undefined : tenantId)) return { ok: false as const, error: "Non autorizzato" };

  // solo corsi che il percorso può contenere: quelli comuni, o quelli della stessa insegna
  const idsCorsi = new Set((formData.getAll("courseIds") as string[]).filter(Boolean));
  const tenantPercorso = level === "sistema" ? undefined : tenantId;
  const courseIds = db.courses
    .filter((c) => idsCorsi.has(c.id) && (c.level === "sistema" || (!!tenantPercorso && c.tenantId === tenantPercorso)))
    .map((c) => c.id);
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
  const admin = await requireAcademyUser();
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
  const admin = await requireAcademyUser();
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
  const admin = await requireAcademyUser();
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
  if (!puoOrganizzazione(admin)) return false;
  if (admin.role === "group_admin") return !!d.tenantId && d.tenantId === admin.tenantId;
  if (admin.role === "store_admin") return !!d.storeId && d.storeId === admin.storeId;
  return false;
}

export async function saveDepartment(deptId: string | null, formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireUser();
  if (!["system_admin", "group_admin", "store_admin"].includes(admin.role) || !puoOrganizzazione(admin)) return { ok: false, error: "Non consentito" };
  const db = await getDb();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Serve il nome del reparto" };
  const emoji = String(formData.get("emoji") ?? "").trim() || "🏷️";
  if (deptId) {
    const d = db.departments.find((x) => x.id === deptId);
    if (!d || !deptScopeAllowed(admin, d)) return { ok: false, error: "Non puoi modificare questo reparto" };
    d.name = name;
    d.emoji = emoji.slice(0, 4);
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
  revalidatePath("/ruoli", "layout");
  return { ok: true };
}

export async function deleteDepartment(deptId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireUser();
  const db = await getDb();
  const d = db.departments.find((x) => x.id === deptId);
  if (!d || !deptScopeAllowed(admin, d)) return { ok: false, error: "Non puoi eliminare questo reparto" };
  db.departments = db.departments.filter((x) => x.id !== deptId);
  for (const u of db.users) if (u.departmentId === deptId) u.departmentId = undefined;
  for (const c of db.courses) if (c.departments) c.departments = c.departments.filter((x) => x !== deptId);
  for (const p of db.paths ?? []) if (p.departments) p.departments = p.departments.filter((x) => x !== deptId);
  await saveDb(db);
  revalidatePath("/ruoli", "layout");
  return { ok: true };
}

export async function saveGroup(groupId: string | null, formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireUser();
  if (!["system_admin", "group_admin", "store_admin"].includes(admin.role) || !puoOrganizzazione(admin)) return { ok: false, error: "Non consentito" };
  const db = await getDb();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Serve il nome del gruppo" };
  const emoji = String(formData.get("emoji") ?? "").trim() || "👥";
  if (groupId) {
    const g = db.groups.find((x) => x.id === groupId);
    if (!g || !deptScopeAllowed(admin, g)) return { ok: false, error: "Non puoi modificare questo gruppo" };
    g.name = name;
    g.emoji = emoji.slice(0, 4);
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
  revalidatePath("/ruoli", "layout");
  return { ok: true };
}

export async function deleteGroup(groupId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireUser();
  const db = await getDb();
  const g = db.groups.find((x) => x.id === groupId);
  if (!g || !deptScopeAllowed(admin, g)) return { ok: false, error: "Non puoi eliminare questo gruppo" };
  db.groups = db.groups.filter((x) => x.id !== groupId);
  for (const u of db.users) if (u.groupIds) u.groupIds = u.groupIds.filter((x) => x !== groupId);
  for (const c of db.courses) if (c.groups) c.groups = c.groups.filter((x) => x !== groupId);
  await saveDb(db);
  revalidatePath("/ruoli", "layout");
  return { ok: true };
}

/** La persona sta nel mio perimetro (Consorzio: tutti; insegna: la sua; PV: il suo)? */
function personaNelMioAmbito(admin: User, u: User): boolean {
  if (admin.role === "system_admin") return true;
  const livello = livelloDi(admin);
  if (livello === "consorzio") return true;
  if (livello === "insegna") return !!admin.tenantId && u.tenantId === admin.tenantId;
  return !!admin.storeId && u.storeId === admin.storeId;
}

export async function addGroupMember(groupId: string, formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireUser();
  const db = await getDb();
  const g = db.groups.find((x) => x.id === groupId);
  if (!g || !deptScopeAllowed(admin, g)) return { ok: false, error: "Non puoi modificare questo gruppo" };
  const userId = String(formData.get("userId") ?? "");
  const u = db.users.find((x) => x.id === userId);
  if (!u) return { ok: false, error: "Scegli una persona" };
  if (!personaNelMioAmbito(admin, u)) return { ok: false, error: "Questa persona non è nel tuo ambito" };
  u.groupIds = u.groupIds ?? [];
  if (!u.groupIds.includes(groupId)) u.groupIds.push(groupId);
  await saveDb(db);
  revalidatePath("/ruoli", "layout");
  return { ok: true };
}

export async function removeGroupMember(groupId: string, userId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireUser();
  const db = await getDb();
  const g = db.groups.find((x) => x.id === groupId);
  if (!g || !deptScopeAllowed(admin, g)) return { ok: false, error: "Non puoi modificare questo gruppo" };
  const u = db.users.find((x) => x.id === userId);
  if (u && !personaNelMioAmbito(admin, u)) return { ok: false, error: "Questa persona non è nel tuo ambito" };
  if (u?.groupIds) {
    u.groupIds = u.groupIds.filter((x) => x !== groupId);
    await saveDb(db);
  }
  revalidatePath("/ruoli", "layout");
  return { ok: true };
}

/* ================== Autenticazione con password ================== */

/*
 * Tentativi sbagliati: 5 per email ogni 15 minuti (chi prova le password di una
 * persona), 30 per indirizzo ogni 15 minuti (chi prova tante email da una macchina).
 */
function regoleLogin(email: string, ip: string): Regola[] {
  return [
    { chiave: `login-email:${email}`, massimo: 5, minuti: 15 },
    { chiave: `login-ip:${ip}`, massimo: 30, minuti: 15 },
  ];
}

export async function loginWithPassword(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const regole = regoleLogin(email, await ipChiamante());
  const attesa = await attesaMinuti(regole);
  if (attesa > 0) redirect(`/login?errore=troppi&minuti=${attesa}`);
  const db = await getDb();
  const user = db.users.find((u) => u.email.toLowerCase() === email);
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    await segnaErrore(regole);
    redirect("/login?errore=credenziali");
  }
  await azzera([regole[0].chiave]);
  if (user!.active === false) redirect("/login?disattivato=1");
  const store = await cookies();
  store.set(AUTH_COOKIE, valoreSessione(user!.id, user!.passwordHash), OPZIONI_SESSIONE);
  store.delete(RUOLO_COOKIE); // a ogni ingresso si sceglie di nuovo il ruolo
  redirect(postLoginPath(user!));
}

/*
 * "Ho dimenticato la password": si manda per email un link firmato che scade in
 * due ore. La risposta è sempre la stessa, anche se l'email non esiste:
 * altrimenti la pagina direbbe a chiunque chi ha un account.
 */
export async function richiediReimposta(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const regole: Regola[] = [
    { chiave: `reimposta-email:${email}`, massimo: 3, minuti: 60 },
    { chiave: `reimposta-ip:${await ipChiamante()}`, massimo: 10, minuti: 60 },
  ];
  const attesa = await attesaMinuti(regole);
  if (attesa > 0) redirect(`/reimposta?errore=troppi&minuti=${attesa}`);
  await segnaErrore(regole);
  const db = await getDb();
  const user = db.users.find((u) => u.email.toLowerCase() === email);
  if (user && user.active !== false) {
    const token = tokenReimposta(user.id, user.passwordHash);
    if (token) {
      const link = `${siteUrl()}/reimposta?token=${token}`;
      const subject = "🔑 Reimposta la password di GT One";
      const body = `Ciao ${user.firstName},

hai chiesto di ${user.passwordHash ? "reimpostare" : "impostare"} la password di GT One. Aprilo qui entro due ore:
${link}

Se non hai chiesto tu niente, ignora questa email: la password resta quella di prima.`;
      await pushEmail(db, user, "reimposta", subject, body);
      await saveDb(db);
    }
  }
  redirect("/reimposta?inviata=1");
}

/** La nuova password, dal link ricevuto per email. */
export async function reimpostaPassword(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const password2 = String(formData.get("password2") ?? "");
  const indietro = `/reimposta?token=${encodeURIComponent(token)}`;
  if (password.length < 8) redirect(`${indietro}&errore=corta`);
  if (password !== password2) redirect(`${indietro}&errore=diverse`);
  const db = await getDb();
  const id = idDaTokenReimposta(token, (x) => db.users.find((u) => u.id === x)?.passwordHash);
  const user = id ? db.users.find((u) => u.id === id) : undefined;
  if (!user || user.active === false) redirect("/reimposta?errore=scaduto");
  user!.passwordHash = hashPassword(password);
  await saveDb(db);
  // il link appena usato non vale più: la firma comprende la password di prima
  await azzera([`login-email:${user!.email.toLowerCase()}`]);
  redirect("/login?reimpostata=1");
}

/*
 * Primo accesso: si chiede l'email e si manda a quell'indirizzo un link per
 * scegliere la password (lo stesso del "password dimenticata"). Prima la
 * password si sceglieva direttamente qui, sapendo solo l'email: chiunque
 * conoscesse l'indirizzo di un collega non ancora attivo poteva entrare al suo
 * posto. La risposta è la stessa che l'email esista o no.
 */
export async function activateAccount(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const regole: Regola[] = [
    { chiave: `attiva-email:${email}`, massimo: 3, minuti: 60 },
    { chiave: `attiva-ip:${await ipChiamante()}`, massimo: 10, minuti: 60 },
  ];
  const attesa = await attesaMinuti(regole);
  if (attesa > 0) redirect(`/attiva?errore=troppi&minuti=${attesa}`);
  await segnaErrore(regole);
  const db = await getDb();
  const user = db.users.find((u) => u.email.toLowerCase() === email);
  if (user && user.active !== false) {
    const token = tokenReimposta(user.id, user.passwordHash);
    if (token) {
      const link = `${siteUrl()}/reimposta?token=${token}`;
      const subject = user.passwordHash ? "🔑 Reimposta la password di GT One" : "👋 Attiva il tuo account GT One";
      const body = `Ciao ${user.firstName},

${user.passwordHash ? "il tuo account è già attivo: se non ricordi la password, sceglila di nuovo" : "per attivare il tuo account GT One scegli la tua password"} qui, entro due ore:
${link}

Se non hai chiesto tu niente, ignora questa email.`;
      await pushEmail(db, user, "reimposta", subject, body);
      await saveDb(db);
    }
  }
  redirect("/attiva?inviata=1");
}

export async function registerRequest(formData: FormData) {
  // la parola segreta si indovina a tentoni: 10 errori l'ora per indirizzo
  const regole: Regola[] = [{ chiave: `registrati-ip:${await ipChiamante()}`, massimo: 10, minuti: 60 }];
  const attesa = await attesaMinuti(regole);
  if (attesa > 0) redirect(`/registrati?errore=troppi&minuti=${attesa}`);
  const db = await getDb();
  const secret = String(formData.get("secret") ?? "").trim();
  const storeId = String(formData.get("storeId") ?? "");
  const store = db.stores.find((s) => s.id === storeId);
  if (!store) redirect("/registrati?errore=pv");
  const tenant = db.tenants.find((t) => t.id === store!.tenantId)!;
  // vale la parola del punto vendita, dell'insegna o quella comune del Consorzio
  const validSecret =
    (store!.secretWord && secret === store!.secretWord) || (tenant.secretWord && secret === tenant.secretWord)
    || (db.settings.secretWord && secret === db.settings.secretWord);
  if (!secret || !validSecret) {
    await segnaErrore(regole);
    redirect("/registrati?errore=segreta");
  }

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
    const body = `${firstName} ${lastName} (${email}) chiede di registrarsi a GT One per ${store!.name}. Approva o rifiuta la richiesta dalla pagina Utenti.`;
    const r = await sendMail(approvalTo, subject, body, { marchio: "gtone" });
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
    sites: ["academy"], // registrazione approvata: entra come corsista
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

/* ================== Permessi dei ruoli (solo amministratore di sistema) ================== */

/** Una casella della tabella "Permessi dei ruoli": acceso/spento per quel ruolo. */
export async function salvaPermessoRuolo(role: Role, chiave: PermessoRuolo, fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireUser();
  if (admin.role !== "system_admin") return { ok: false, error: "Solo l'amministratore di sistema cambia i permessi dei ruoli." };
  if (role === "system_admin") return { ok: false, error: "L'amministratore di sistema ha sempre tutti i permessi." };
  if (!(role in ROLE_LABELS) || !(PERMESSI_RUOLO.some((p) => p.chiave === chiave) || PERMESSI_AREA.some((p) => p.chiave === chiave))) return { ok: false, error: "Permesso sconosciuto" };
  const db = await getDb();
  const acceso = fd.get("v") === "on";
  const tabella = { ...(db.settings.permessiRuoli ?? {}) };
  const riga = { ...(tabella[role] ?? {}) };
  // uguale al predefinito: non serve scriverlo (se un giorno i predefiniti cambiano, vale il nuovo)
  if (acceso === PERMESSI_PREDEFINITI[role][chiave]) delete riga[chiave];
  else riga[chiave] = acceso;
  if (Object.keys(riga).length) tabella[role] = riga; else delete tabella[role];
  db.settings.permessiRuoli = tabella;
  await saveDb(db);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Torna ai permessi predefiniti per tutti i ruoli. */
export async function ripristinaPermessiRuoli(): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireUser();
  if (admin.role !== "system_admin") return { ok: false, error: "Non consentito" };
  const db = await getDb();
  db.settings.permessiRuoli = undefined;
  await saveDb(db);
  revalidatePath("/", "layout");
  return { ok: true };
}

/* ================== Utenti e ruoli → Email: il benvenuto di GT One ================== */

/** Il Consorzio (amministratore di sistema) il testo comune; insegna e PV la loro versione. */
function ambitoBenvenutoGtOne(admin: User): { tenantId?: string; storeId?: string } | null {
  if (admin.role === "system_admin") return {};
  if (!permessoRuolo(admin.role, "modelliEmail")) return null;
  if (admin.role === "store_admin" && admin.tenantId && admin.storeId) return { tenantId: admin.tenantId, storeId: admin.storeId };
  if (admin.role === "group_admin" && admin.tenantId) return { tenantId: admin.tenantId };
  return null;
}

export async function salvaBenvenutoGtOne(fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireUser();
  const ambito = ambitoBenvenutoGtOne(admin);
  if (!ambito) return { ok: false, error: "Non puoi modificare questo modello." };
  const db = await getDb();
  const base = db.templates.find((t) => t.type === "benvenuto_gtone" && !t.tenantId && !t.storeId);
  if (!base) return { ok: false, error: "Modello non trovato: ricarica la pagina." };
  let tpl = db.templates.find((t) => t.type === "benvenuto_gtone" && t.tenantId === ambito.tenantId && t.storeId === ambito.storeId);
  if (!tpl) {
    tpl = { ...base, tenantId: ambito.tenantId, storeId: ambito.storeId };
    db.templates.push(tpl);
  }
  const subject = String(fd.get("subject") ?? "").trim();
  const body = String(fd.get("body") ?? "").trim();
  if (!subject || !body) return { ok: false, error: "Servono oggetto e testo." };
  tpl.subject = subject.slice(0, 200);
  tpl.body = body.slice(0, 5000);
  if (admin.role === "system_admin") tpl.enabled = fd.get("enabled") === "on";
  await saveDb(db);
  revalidatePath("/ruoli/email");
  return { ok: true };
}

/** Torna al testo comune (insegna/PV) o al testo predefinito (Consorzio). */
export async function ripristinaBenvenutoGtOne(): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireUser();
  const ambito = ambitoBenvenutoGtOne(admin);
  if (!ambito) return { ok: false, error: "Non consentito" };
  const db = await getDb();
  if (admin.role === "system_admin") {
    const def = DEFAULT_TEMPLATES.find((t) => t.type === "benvenuto_gtone")!;
    const tpl = db.templates.find((t) => t.type === "benvenuto_gtone" && !t.tenantId && !t.storeId);
    if (tpl) { tpl.subject = def.subject; tpl.body = def.body; tpl.enabled = true; }
  } else {
    db.templates = db.templates.filter((t) => !(t.type === "benvenuto_gtone" && t.tenantId === ambito.tenantId && t.storeId === ambito.storeId));
  }
  await saveDb(db);
  revalidatePath("/ruoli/email");
  return { ok: true };
}

/** Manda a chi è collegato il benvenuto GT One come lo riceverebbe un nuovo collega (senza registrarlo). */
export async function provaBenvenutoGtOne(): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireUser();
  if (!ambitoBenvenutoGtOne(admin)) return { ok: false, error: "Non consentito" };
  const db = await getDb();
  const r = renderTemplate(db, admin, "benvenuto_gtone", {});
  if (!r) return { ok: false, error: "Il benvenuto GT One è disattivato." };
  const esito = await sendMail(admin.email, `[PROVA] ${r.subject}`, `${r.body}

Per entrare la prima volta scegli la tua password qui (il link vale 7 giorni):
${siteUrl()}/reimposta?token=…

(Prova: il link vero arriva solo ai nuovi colleghi.)`, { marchio: "gtone" });
  return esito.sent === false ? { ok: false, error: `Invio non riuscito: ${esito.error ?? "errore"}` }
    : { ok: true, error: esito.sent ? `Mandata a ${admin.email}` : "Invio reale non configurato" };
}
