"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "./auth";
import { getDb, saveDb } from "./db";
import { puoModificareLayout, resolveScope } from "./stampe";
import { uploadPublicFile } from "./supabase";
import { registra } from "./registro";
import type { FontProprio } from "./font-propri";

const FORMATI: Record<string, { formato: FontProprio["formato"]; tipo: string }> = {
  woff2: { formato: "woff2", tipo: "font/woff2" },
  woff: { formato: "woff", tipo: "font/woff" },
  ttf: { formato: "truetype", tipo: "font/ttf" },
  otf: { formato: "opentype", tipo: "font/otf" },
};

/** Carica uno o più font per l'ambito (insegna, PV o Consorzio), da usare nei layout dei cartelli. */
export async function caricaFont(area: "arredo" | "zoo", scopeParam: string, fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const db = await getDb();
  const scope = resolveScope(user, scopeParam, db);
  if (!puoModificareLayout(user, area, scope, db)) return { ok: false, error: "Non puoi modificare i layout di questo ambito." };
  const file = fd.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (file.length === 0) return { ok: false, error: "Scegli uno o più file di font (.woff2, .woff, .ttf, .otf)." };
  const nomeScelto = String(fd.get("nome") ?? "").trim().slice(0, 40);
  const nuovi: FontProprio[] = [];
  for (const f of file.slice(0, 10)) {
    const ext = (f.name.split(".").pop() ?? "").toLowerCase();
    const tipo = FORMATI[ext];
    if (!tipo) return { ok: false, error: `«${f.name}»: servono file .woff2, .woff, .ttf o .otf.` };
    if (f.size > 3 * 1024 * 1024) return { ok: false, error: `«${f.name}» è troppo grande (massimo 3 MB).` };
    const id = `u_${randomBytes(6).toString("hex")}`;
    const url = await uploadPublicFile(`uploads/fonts/${id}.${ext}`, Buffer.from(await f.arrayBuffer()), tipo.tipo);
    if (!url) return { ok: false, error: `«${f.name}» non caricato: riprova.` };
    // il nome: quello scritto (col numero se sono più file), altrimenti il nome del file pulito
    const base = f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim().slice(0, 40);
    const nome = nomeScelto ? (file.length > 1 ? `${nomeScelto} ${base}` : nomeScelto) : base;
    nuovi.push({ id, nome, url, formato: tipo.formato, scopeType: scope.type, scopeId: scope.id, caricatoIl: new Date().toISOString() });
  }
  db.settings.fontPropri = [...(db.settings.fontPropri ?? []), ...nuovi];
  await saveDb(db);
  registra(user, { area, cosa: "Font caricati", oggetto: nuovi.map((n) => n.nome).join(", "), ambito: scope.type === "system" ? undefined : scope.label });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Toglie un font dell'ambito: i campi che lo usavano tornano al carattere predefinito. */
export async function togliFont(area: "arredo" | "zoo", scopeParam: string, id: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const db = await getDb();
  const scope = resolveScope(user, scopeParam, db);
  if (!puoModificareLayout(user, area, scope, db)) return { ok: false, error: "Non puoi modificare i layout di questo ambito." };
  const f = (db.settings.fontPropri ?? []).find((x) => x.id === id && x.scopeType === scope.type && x.scopeId === scope.id);
  if (!f) return { ok: false, error: "Font non trovato (o non di questo ambito)." };
  db.settings.fontPropri = (db.settings.fontPropri ?? []).filter((x) => x !== f);
  await saveDb(db);
  registra(user, { area, cosa: "Font tolto", oggetto: f.nome, ambito: scope.type === "system" ? undefined : scope.label });
  revalidatePath("/", "layout");
  return { ok: true };
}
