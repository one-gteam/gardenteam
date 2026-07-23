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
  for (const u of db.users) if (u.active === undefined) u.active = true;
  return db;
}

export async function saveDb(db: DB): Promise<void> {
  await writeDomain("academy", db);
}
