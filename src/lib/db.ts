import { DB, DEFAULT_SETTINGS, DEFAULT_TEMPLATES } from "./types";
import { buildSeed } from "./seed";
import { readDomain, writeDomain } from "./supabase";

function isEmpty(db: DB | null | undefined): boolean {
  return !db || !db.users || db.users.length === 0;
}

export async function getDb(): Promise<DB> {
  let db = await readDomain<DB>("academy", null as unknown as DB);
  if (isEmpty(db)) {
    db = buildSeed();
    await writeDomain("academy", db);
    return db;
  }
  // retro-compatibilità con database creati da versioni precedenti
  if (!db.emails) db.emails = [];
  if (!db.settings) db.settings = { ...DEFAULT_SETTINGS };
  if (!db.groups) db.groups = [];
  if (!db.customTemplates) db.customTemplates = [];
  if (!db.registrations) db.registrations = [];
  if (db.settings.urgentDays === undefined) db.settings.urgentDays = 7;
  if (!db.settings.font) db.settings.font = "system";
  if (!db.templates) db.templates = [];
  // garantisce la presenza dei modelli di sistema
  for (const t of DEFAULT_TEMPLATES) {
    if (!db.templates.some((x) => x.type === t.type && !x.tenantId)) db.templates.push({ ...t });
  }
  // il modello "assegnazione" è passato da un singolo corso a un elenco: aggiorna
  // solo se nessun admin lo ha mai personalizzato (testo ancora identico al vecchio default)
  const oldAssegnazione = db.templates.find((t) => t.type === "assegnazione" && !t.tenantId);
  if (oldAssegnazione?.subject === "📬 Nuovo corso assegnato: «{{corso}}»") {
    const fresh = DEFAULT_TEMPLATES.find((t) => t.type === "assegnazione")!;
    oldAssegnazione.subject = fresh.subject;
    oldAssegnazione.body = fresh.body;
  }
  for (const u of db.users) if (u.active === undefined) u.active = true;
  // le vecchie tipologie "testo" e "slide" confluiscono in "pdf" (Testo / lettura)
  for (const c of db.courses) {
    for (const l of c.lessons) {
      if ((l.type as string) === "testo" || (l.type as string) === "slide") l.type = "pdf";
    }
  }
  return db;
}

export async function saveDb(db: DB): Promise<void> {
  await writeDomain("academy", db);
}
