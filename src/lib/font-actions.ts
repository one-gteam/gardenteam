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

const PESI_GOOGLE: Record<string, string> = { "300": "Light", "400": "Regular", "500": "Medium", "600": "SemiBold", "700": "Bold", "800": "ExtraBold", "900": "Black" };

/**
 * Importa un font da Google Fonts scrivendone solo il nome: il server scarica
 * i file (sottoinsieme «latin», che ha accenti e €) e li mette nel nostro
 * archivio, come se fossero stati caricati a mano. Così valgono uguali in
 * editor, stampa e PDF, e chi apre i cartelli non si collega a Google.
 * Un peso per voce del menu Carattere («Lato Bold», «Lato Black»…).
 */
export async function importaGoogleFont(area: "arredo" | "zoo", scopeParam: string, fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const db = await getDb();
  const scope = resolveScope(user, scopeParam, db);
  if (!puoModificareLayout(user, area, scope, db)) return { ok: false, error: "Non puoi modificare i layout di questo ambito." };
  const famiglia = String(fd.get("famiglia") ?? "").trim().replace(/\s+/g, " ");
  if (!/^[A-Za-z0-9][A-Za-z0-9 ]{1,39}$/.test(famiglia)) return { ok: false, error: "Scrivi il nome del font come su Google Fonts (es. Lato, Open Sans)." };
  const pesi = (fd.getAll("peso") as string[]).filter((p) => p in PESI_GOOGLE);
  const corsivo = fd.get("corsivo") === "1";
  if (pesi.length === 0) return { ok: false, error: "Scegli almeno uno spessore (es. Regular e Bold)." };
  const varianti = pesi.flatMap((p) => (corsivo ? [{ peso: p, ital: 0 }, { peso: p, ital: 1 }] : [{ peso: p, ital: 0 }]));
  const nuovi: FontProprio[] = [];
  const mancanti: string[] = [];
  for (const v of varianti) {
    const nome = `${famiglia} ${PESI_GOOGLE[v.peso]}${v.ital ? " Italic" : ""}`;
    if ((db.settings.fontPropri ?? []).some((f) => f.nome === nome && f.scopeType === scope.type && f.scopeId === scope.id)) continue;
    try {
      const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(famiglia).replace(/%20/g, "+")}:ital,wght@${v.ital},${v.peso}&display=swap`;
      // con un browser moderno Google risponde in woff2
      const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36" }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) { mancanti.push(nome); continue; }
      const css = await r.text();
      const blocchi = [...css.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)];
      const latin = blocchi.find((b) => b[1] === "latin") ?? blocchi[0];
      const src = latin ? /url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+\.woff2)\)/.exec(latin[2])?.[1] : undefined;
      if (!src) { mancanti.push(nome); continue; }
      const f = await fetch(src, { signal: AbortSignal.timeout(10000) });
      const dati = Buffer.from(await f.arrayBuffer());
      if (!f.ok || dati.length === 0 || dati.length > 3 * 1024 * 1024) { mancanti.push(nome); continue; }
      const id = `u_${randomBytes(6).toString("hex")}`;
      const pubblico = await uploadPublicFile(`uploads/fonts/${id}.woff2`, dati, "font/woff2");
      if (!pubblico) { mancanti.push(nome); continue; }
      nuovi.push({ id, nome, url: pubblico, formato: "woff2", scopeType: scope.type, scopeId: scope.id, caricatoIl: new Date().toISOString() });
    } catch {
      mancanti.push(nome);
    }
  }
  if (nuovi.length === 0) {
    return { ok: false, error: mancanti.length ? `Non trovato su Google Fonts: ${mancanti.join(", ")}. Controlla il nome e gli spessori.` : "Questi spessori ci sono già." };
  }
  db.settings.fontPropri = [...(db.settings.fontPropri ?? []), ...nuovi];
  await saveDb(db);
  registra(user, { area, cosa: "Font importati da Google Fonts", oggetto: nuovi.map((n) => n.nome).join(", "), ambito: scope.type === "system" ? undefined : scope.label });
  revalidatePath("/", "layout");
  return { ok: true, error: mancanti.length ? `Importati ${nuovi.length}; non disponibili: ${mancanti.join(", ")}.` : undefined };
}
