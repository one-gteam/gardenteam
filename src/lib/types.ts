export type Role =
  | "system_admin"
  | "group_admin"
  | "store_admin"
  | "dept_head"
  | "course_manager"
  | "student";

export const ROLE_LABELS: Record<Role, string> = {
  system_admin: "Amministratore di sistema",
  group_admin: "Amministratore di insegna",
  store_admin: "Amministratore punto vendita",
  dept_head: "Capo reparto",
  course_manager: "Gestore corsi",
  student: "Studente",
};

export interface Tenant {
  id: string;
  name: string;
  color: string;
  emoji: string;
  logoUrl?: string; // logo dell'insegna (in /loghi)
  welcome?: string; // messaggio in evidenza per gli studenti dell'insegna
  secretWord?: string; // parola segreta per l'auto-registrazione
  approvalEmail?: string; // email che riceve le richieste di registrazione
}

export interface Store {
  id: string;
  tenantId: string;
  name: string;
  city: string;
  welcome?: string;
  secretWord?: string;
  approvalEmail?: string;
}

export interface Department {
  id: string;
  name: string;
  emoji: string;
  tenantId?: string; // presente = reparto specifico di un'insegna
  storeId?: string; // presente = reparto specifico di un punto vendita
}

/** Gruppo di persone (es. "Referenti sicurezza"), a livello sistema, insegna o punto vendita. */
export interface Group {
  id: string;
  name: string;
  emoji: string;
  tenantId?: string;
  storeId?: string;
}

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  tenantId?: string;
  storeId?: string;
  departmentId?: string;
  jobTitle?: string;
  hireDate: string; // ISO date
  points: number;
  badges: string[];
  active: boolean; // false = cessato: accesso bloccato
  passwordHash?: string; // "salt:hash" — assente finché l'utente non attiva l'account
  birthDate?: string;
  taxCode?: string;
  groupIds?: string[]; // gruppi di appartenenza
  gender?: "m" | "f"; // per declinare i testi delle email ([benvenuto|benvenuta])
  sites?: SiteId[]; // macroaree accessibili; assente = default per ruolo
}

export type SiteId = "academy" | "stampe";

/** Macroaree accessibili: default studenti = solo Academy, altri ruoli = entrambe. */
export function userSites(user: User): SiteId[] {
  if (user.sites && user.sites.length > 0) return user.sites;
  return user.role === "student" ? ["academy"] : ["academy", "stampe"];
}

/** Destinazione dopo il login: diretta se una sola macroarea, pagina di scelta se più di una. */
export function postLoginPath(user: User): string {
  const sites = userSites(user);
  if (sites.length > 1) return "/scegli";
  if (sites[0] === "stampe") return "/stampe";
  return user.role === "student" ? "/studente" : "/admin";
}

export type LessonType = "video" | "slide" | "pdf" | "testo" | "quiz";

export interface Lesson {
  id: string;
  title: string;
  type: LessonType;
  minutes: number;
  content: string;
  questions?: QuizQuestion[]; // solo per le lezioni di tipo "quiz" (quiz intermedi)
}

export interface QuizQuestion {
  id: string;
  text: string;
  options: string[];
  correct: number;
}

export type CourseLevel = "sistema" | "insegna" | "punto_vendita";

export const LEVEL_LABELS: Record<CourseLevel, string> = {
  sistema: "Sistema",
  insegna: "Insegna",
  punto_vendita: "Punto vendita",
};

export interface Course {
  id: string;
  title: string;
  description: string;
  category: string;
  emoji: string;
  level: CourseLevel;
  tenantId?: string;
  storeId?: string;
  departments?: string[]; // department ids; empty/undefined = tutti
  groups?: string[]; // group ids; presente = riservato ai membri di quei gruppi
  onlyNewHires?: boolean; // assunti negli ultimi 90 giorni
  mandatory: boolean;
  dueDays?: number; // giorni dalla data di assegnazione/assunzione
  lessons: Lesson[];
  quiz: QuizQuestion[];
  passScore: number; // percentuale
  points: number;
  coverUrl?: string; // immagine di copertina (in /uploads o URL esterno)
}

export interface LearningPath {
  id: string;
  title: string;
  description: string;
  emoji: string;
  courseIds: string[];
  level: CourseLevel;
  tenantId?: string;
  departments?: string[];
  onlyNewHires?: boolean;
}

export interface Progress {
  userId: string;
  courseId: string;
  completedLessons: string[];
  quizScore?: number;
  quizPassed?: boolean;
  completedAt?: string;
}

export interface Certificate {
  id: string;
  userId: string;
  courseId: string;
  issuedAt: string;
}

export interface Feedback {
  id: string;
  userId: string;
  courseId: string;
  rating: number;
  comment: string;
  date: string;
}

export type EmailType = "benvenuto" | "assegnazione" | "promemoria" | "scadenza" | "completamento" | "certificato";

export const EMAIL_TYPE_LABELS: Record<EmailType, { label: string; emoji: string }> = {
  benvenuto: { label: "Benvenuto", emoji: "👋" },
  assegnazione: { label: "Nuovo corso assegnato", emoji: "📬" },
  promemoria: { label: "Promemoria corso da completare", emoji: "⏰" },
  scadenza: { label: "Corso in scadenza", emoji: "🚨" },
  completamento: { label: "Corso completato", emoji: "🎉" },
  certificato: { label: "Certificato emesso", emoji: "📜" },
};

export interface EmailMessage {
  id: string;
  userId: string;
  to: string;
  subject: string;
  body: string;
  type: EmailType;
  date: string; // ISO datetime
  status: "inviata" | "in_coda";
}

export interface EmailTemplate {
  type: EmailType;
  subject: string;
  body: string;
  enabled: boolean; // significativo solo sul modello di sistema: le automazioni le governa l'admin di sistema
  tenantId?: string; // presente = personalizzazione dell'insegna
  storeId?: string; // presente = personalizzazione del punto vendita
}

/** Modello email aggiuntivo, creato dagli amministratori e collegato a un'automazione. */
export interface CustomTemplate {
  id: string;
  name: string;
  trigger: EmailType; // automazione a cui è collegato
  subject: string;
  body: string;
  enabled: boolean;
  tenantId?: string; // scope: assente = sistema
  storeId?: string;
}

/**
 * Variabili disponibili nei modelli: {{nome}} {{cognome}} {{corso}} {{punti}} {{elenco}}.
 * Declinazione di genere: [maschile|femminile] — es. "[Benvenuto|Benvenuta]".
 */
export const DEFAULT_TEMPLATES: EmailTemplate[] = [
  { type: "benvenuto", enabled: true, subject: "[Benvenuto|Benvenuta] in Academy GT, {{nome}}!", body: "Ciao {{nome}}, il tuo account Academy GT è attivo. Nella tua area personale trovi i corsi già assegnati in base al tuo profilo." },
  { type: "assegnazione", enabled: true, subject: "📬 Nuovo corso assegnato: «{{corso}}»", body: "Ciao {{nome}}, ti è stato assegnato il corso «{{corso}}». Lo trovi nella tua area personale." },
  { type: "promemoria", enabled: true, subject: "⏰ Promemoria: hai corsi da completare", body: "Ciao {{nome}}, ti ricordiamo i corsi obbligatori da completare: {{elenco}}." },
  { type: "scadenza", enabled: true, subject: "🚨 Corsi in scadenza: completa la formazione obbligatoria", body: "Ciao {{nome}}, attenzione: questi corsi sono in scadenza o già scaduti: {{elenco}}. Completali al più presto." },
  { type: "completamento", enabled: true, subject: "🎉 Hai completato «{{corso}}»", body: "Ottimo lavoro {{nome}}: corso completato e {{punti}} punti guadagnati." },
  { type: "certificato", enabled: true, subject: "📜 Certificato emesso: «{{corso}}»", body: "Complimenti {{nome}}! Hai completato il corso «{{corso}}» e il certificato è disponibile nella tua area personale." },
];

export interface Registration {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  gender?: "m" | "f";
  tenantId: string;
  storeId: string;
  departmentId?: string;
  birthDate: string;
  taxCode: string;
  date: string;
  status: "pending" | "approved" | "rejected";
}

/** Impostazioni globali del portale, gestite dall'amministratore di sistema. */
export interface PortalSettings {
  portalName: string;
  logoUrl: string;
  colorPrimary: string; // verde scuro GT
  colorAccent: string; // verde chiaro GT
  welcome?: string; // messaggio per tutti gli studenti del consorzio
  supportEmail?: string;
  font?: string; // "system" | "inter" | "nunito" | "poppins" | "quicksand"
  urgentDays?: number; // giorni prima della scadenza per l'avviso urgente (default 7)
}

export const FONT_OPTIONS: { id: string; label: string; desc: string }[] = [
  { id: "system", label: "Segoe UI (sistema)", desc: "Il font attuale: neutro, zero caricamenti" },
  { id: "inter", label: "Inter", desc: "Moderno e professionale, ottima leggibilità" },
  { id: "nunito", label: "Nunito", desc: "Arrotondato e amichevole, adatto al mondo garden" },
  { id: "poppins", label: "Poppins", desc: "Geometrico e contemporaneo, titoli d'impatto" },
  { id: "quicksand", label: "Quicksand", desc: "Leggero e informale, tono giovane" },
];

export const DEFAULT_SETTINGS: PortalSettings = {
  portalName: "Academy GT",
  logoUrl: "/loghi/gardenteam.png",
  colorPrimary: "#00652e",
  colorAccent: "#8dc63f",
};

export interface DB {
  settings: PortalSettings;
  tenants: Tenant[];
  stores: Store[];
  departments: Department[];
  groups: Group[];
  users: User[];
  courses: Course[];
  paths: LearningPath[];
  progress: Progress[];
  certificates: Certificate[];
  feedback: Feedback[];
  emails: EmailMessage[];
  templates: EmailTemplate[];
  customTemplates: CustomTemplate[];
  registrations: Registration[];
}

export const BADGE_DEFS: Record<string, { label: string; emoji: string; desc: string }> = {
  primo_corso: { label: "Primo passo", emoji: "🌱", desc: "Primo corso completato" },
  tre_corsi: { label: "Pollice verde", emoji: "🌿", desc: "3 corsi completati" },
  cinque_corsi: { label: "Giardiniere esperto", emoji: "🌳", desc: "5 corsi completati" },
  quiz_perfetto: { label: "Quiz perfetto", emoji: "🏆", desc: "100% in un quiz" },
  onboarding: { label: "Benvenuto a bordo", emoji: "🚀", desc: "Onboarding completato" },
};
