"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "./auth";
import { uploadPublicFile } from "./supabase";
import {
  getArticoliDb, saveArticoliDb, gestisceArticoli, pubblicaArticoli, modificaArticolo, vedeArticoli, articoloPer,
  destinatariDaModulo, ripulisciHtml, type Allegato, type Articolo, type LinkEsterno,
} from "./articoli";
import { descrizioneConAi } from "./articoli-ai";

type Esito = { ok: boolean; error?: string };

const MAX_ALLEGATO = 15 * 1024 * 1024;
const TIPI_ALLEGATO = /^(image\/(jpeg|png|gif|webp)|application\/pdf)$/;

function nomeSicuro(nome: string): string {
  const solo = nome.split(/[\\/]/).pop() ?? "file";
  return solo.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 100) || "file";
}

async function caricaAllegati(files: File[], cartella: string): Promise<{ allegati: Allegato[]; errore?: string }> {
  const allegati: Allegato[] = [];
  for (const f of files) {
    if (!f || f.size === 0) continue;
    if (!TIPI_ALLEGATO.test(f.type)) return { allegati, errore: `«${f.name}»: si accettano PDF e immagini (JPG, PNG, GIF, WebP).` };
    if (f.size > MAX_ALLEGATO) return { allegati, errore: `«${f.name}» supera i 15 MB.` };
    const nome = nomeSicuro(f.name);
    const url = await uploadPublicFile(`articoli/${cartella}/${Date.now()}_${nome}`, Buffer.from(await f.arrayBuffer()), f.type);
    allegati.push({ nome: f.name, url, tipo: f.type, dimensione: f.size });
  }
  return { allegati };
}

function linkDaModulo(fd: FormData): LinkEsterno[] {
  const urls = (fd.getAll("link_url") as string[]).map((u) => u.trim());
  const titoli = fd.getAll("link_titolo") as string[];
  return urls
    .map((url, i) => ({ url: /^https?:\/\//i.test(url) ? url : url ? `https://${url}` : "", titolo: (titoli[i] ?? "").trim() || undefined }))
    .filter((l) => l.url);
}

/** Crea o aggiorna un articolo (dal modulo web). */
export async function salvaArticolo(id: string | null, formData: FormData): Promise<Esito & { id?: string }> {
  const user = await requireUser();
  const db = await getArticoliDb();
  if (!pubblicaArticoli(user, db)) return { ok: false, error: "Non puoi pubblicare articoli" };

  const titolo = String(formData.get("titolo") ?? "").trim();
  if (!titolo) return { ok: false, error: "Serve il titolo" };
  const testo = ripulisciHtml(String(formData.get("testo") ?? ""));
  const categoriaId = String(formData.get("categoriaId") ?? "") || undefined;
  if (categoriaId && !db.categorie.some((c) => c.id === categoriaId)) return { ok: false, error: "Categoria sconosciuta" };
  const stato = formData.get("stato") === "bozza" ? "bozza" : "pubblicato";
  const scadenza = String(formData.get("scadenza") ?? "");
  const gestore = gestisceArticoli(user, db);

  let a = id ? db.articoli.find((x) => x.id === id) : undefined;
  if (id && !a) return { ok: false, error: "Articolo non trovato" };
  if (a && !modificaArticolo(user, a, db)) return { ok: false, error: "Non puoi modificare questo articolo" };

  const nuoviFile = (formData.getAll("allegati") as File[]).filter((f) => f && f.size > 0);
  const { allegati: nuovi, errore } = await caricaAllegati(nuoviFile, a?.id ?? "nuovi");
  if (errore) return { ok: false, error: errore };

  // gli allegati da togliere arrivano come url
  const daTogliere = new Set(formData.getAll("togli_allegato") as string[]);
  const allegati = [...(a?.allegati ?? []).filter((x) => !daTogliere.has(x.url)), ...nuovi];
  const copertina = allegati.find((x) => x.tipo.startsWith("image/"))?.url;

  const adesso = new Date().toISOString();
  if (!a) {
    a = {
      id: `art_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      titolo, testo, categoriaId, allegati, link: linkDaModulo(formData), copertina,
      autoreId: user.id, autoreNome: `${user.firstName} ${user.lastName}`,
      origine: "web", creato: adesso, stato, destinatari: destinatariDaModulo(formData), letture: {},
    };
    db.articoli.unshift(a);
  } else {
    Object.assign(a, { titolo, testo, categoriaId, allegati, copertina, link: linkDaModulo(formData), stato, destinatari: destinatariDaModulo(formData) });
  }
  a.inEvidenza = gestore ? formData.get("inEvidenza") === "1" || undefined : a.inEvidenza;
  a.scadenza = /^\d{4}-\d{2}-\d{2}$/.test(scadenza) ? scadenza : undefined;
  if (stato === "pubblicato" && !a.pubblicato) a.pubblicato = adesso;
  if (stato === "bozza") a.pubblicato = undefined;

  await saveArticoliDb(db);
  revalidatePath("/articoli", "layout");
  return { ok: true, id: a.id };
}

export async function eliminaArticolo(id: string): Promise<Esito> {
  const user = await requireUser();
  const db = await getArticoliDb();
  const a = db.articoli.find((x) => x.id === id);
  if (!a || !modificaArticolo(user, a, db)) return { ok: false, error: "Non puoi eliminare questo articolo" };
  db.articoli = db.articoli.filter((x) => x.id !== id);
  await saveArticoliDb(db);
  revalidatePath("/articoli", "layout");
  return { ok: true };
}

/** Chi apre un articolo resta segnato fra le letture (per il "letto da"). */
export async function segnaLetto(id: string): Promise<Esito> {
  const user = await requireUser();
  const db = await getArticoliDb();
  const a = db.articoli.find((x) => x.id === id);
  if (!a || !articoloPer(user, a, db)) return { ok: false };
  if (a.letture[user.id]) return { ok: true };
  a.letture[user.id] = new Date().toISOString();
  await saveArticoliDb(db);
  return { ok: true };
}

/** "Scrivi la descrizione con l'AI": titolo, appunti, link e i file scelti nel modulo. */
export async function descrizioneAi(formData: FormData): Promise<{ ok: boolean; testo?: string; error?: string }> {
  const user = await requireUser();
  const db = await getArticoliDb();
  if (!pubblicaArticoli(user, db)) return { ok: false, error: "Non puoi pubblicare articoli" };
  const files = (formData.getAll("allegati") as File[]).filter((f) => f && f.size > 0 && TIPI_ALLEGATO.test(f.type));
  const documenti = await Promise.all(files.slice(0, 5).map(async (f) => ({ nome: f.name, tipo: f.type, bytes: Buffer.from(await f.arrayBuffer()) })));
  // anche gli allegati già caricati in precedenza (articolo in modifica)
  for (const url of (formData.getAll("allegato_url") as string[]).slice(0, 5)) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const tipo = r.headers.get("content-type") ?? "";
      if (TIPI_ALLEGATO.test(tipo)) documenti.push({ nome: url.split("/").pop() ?? "file", tipo, bytes: Buffer.from(await r.arrayBuffer()) });
    } catch { /* si va avanti senza */ }
  }
  const r = await descrizioneConAi({
    titolo: String(formData.get("titolo") ?? ""),
    testo: String(formData.get("testo") ?? "").replace(/<[^>]+>/g, " ").trim(),
    link: (formData.getAll("link_url") as string[]).filter(Boolean),
    documenti,
  });
  return r.ok ? { ok: true, testo: ripulisciHtml(r.testo) } : { ok: false, error: r.errore };
}

/* ---------- categorie ---------- */

export async function salvaCategoria(id: string | null, formData: FormData): Promise<Esito> {
  const user = await requireUser();
  const db = await getArticoliDb();
  if (!gestisceArticoli(user, db)) return { ok: false, error: "Solo chi gestisce l'area" };
  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) return { ok: false, error: "Serve il nome" };
  const emoji = String(formData.get("emoji") ?? "").trim().slice(0, 4) || undefined;
  if (id) {
    const c = db.categorie.find((x) => x.id === id);
    if (!c) return { ok: false, error: "Categoria non trovata" };
    c.nome = nome; c.emoji = emoji;
  } else {
    db.categorie.push({ id: `cat_${Date.now()}`, nome, emoji });
  }
  await saveArticoliDb(db);
  revalidatePath("/articoli", "layout");
  return { ok: true };
}

export async function eliminaCategoria(id: string): Promise<Esito> {
  const user = await requireUser();
  const db = await getArticoliDb();
  if (!gestisceArticoli(user, db)) return { ok: false, error: "Solo chi gestisce l'area" };
  db.categorie = db.categorie.filter((c) => c.id !== id);
  for (const a of db.articoli) if (a.categoriaId === id) a.categoriaId = undefined;
  await saveArticoliDb(db);
  revalidatePath("/articoli", "layout");
  return { ok: true };
}

/* ---------- permessi, newsletter, email ---------- */

/** Chi vede, chi pubblica, chi gestisce: tre gruppi di destinatari nello stesso modulo (prefissi acc_, pub_, ges_). */
export async function salvaPermessiArticoli(formData: FormData): Promise<Esito> {
  const user = await requireUser();
  const db = await getArticoliDb();
  if (!gestisceArticoli(user, db)) return { ok: false, error: "Solo chi gestisce l'area" };
  db.accesso = destinatariDaModulo(formData, "acc");
  db.pubblicatori = destinatariDaModulo(formData, "pub");
  db.gestori = destinatariDaModulo(formData, "ges");
  await saveArticoliDb(db);
  revalidatePath("/articoli", "layout");
  revalidatePath("/scegli");
  return { ok: true };
}

export async function salvaNewsletterArticoli(formData: FormData): Promise<Esito> {
  const user = await requireUser();
  const db = await getArticoliDb();
  if (!gestisceArticoli(user, db)) return { ok: false, error: "Solo chi gestisce l'area" };
  const ogni = String(formData.get("ogni") ?? "settimana");
  db.newsletter.attiva = formData.get("attiva") === "on";
  db.newsletter.ogni = ogni === "giorno" || ogni === "mese" ? ogni : "settimana";
  db.newsletter.minimo = Math.max(1, Math.min(50, Number(formData.get("minimo")) || 1));
  db.newsletter.oggetto = String(formData.get("oggetto") ?? "").trim() || undefined;
  await saveArticoliDb(db);
  revalidatePath("/articoli", "layout");
  return { ok: true };
}

export async function salvaEmailArticoli(formData: FormData): Promise<Esito> {
  const user = await requireUser();
  const db = await getArticoliDb();
  if (!gestisceArticoli(user, db)) return { ok: false, error: "Solo chi gestisce l'area" };
  db.email.attiva = formData.get("attiva") === "on";
  db.email.indirizzo = String(formData.get("indirizzo") ?? "").trim() || undefined;
  db.email.sconosciuti = formData.get("sconosciuti") === "bozza" ? "bozza" : "rifiuta";
  await saveArticoliDb(db);
  revalidatePath("/articoli", "layout");
  return { ok: true };
}

/** La casella "Ricevi la newsletter" nella pagina degli articoli. */
export async function iscrizioneNewsletter(iscritto: boolean): Promise<Esito> {
  const user = await requireUser();
  const db = await getArticoliDb();
  if (!vedeArticoli(user, db)) return { ok: false, error: "Non hai accesso agli articoli" };
  const senza = db.newsletter.iscritti.filter((id) => id !== user.id);
  db.newsletter.iscritti = iscritto ? [...senza, user.id] : senza;
  await saveArticoliDb(db);
  revalidatePath("/articoli");
  return { ok: true };
}

/** Manda la newsletter adesso, a prescindere dalla cadenza (per chi gestisce). */
export async function mandaNewsletterAdesso(): Promise<Esito & { inviate?: number }> {
  const user = await requireUser();
  const db = await getArticoliDb();
  if (!gestisceArticoli(user, db)) return { ok: false, error: "Solo chi gestisce l'area" };
  const { inviaNewsletterArticoli } = await import("./articoli-newsletter");
  const r = await inviaNewsletterArticoli(true);
  return { ok: true, inviate: r.inviate, error: r.nota };
}

/** Utile a chi pubblica: un articolo arrivato per email in bozza si pubblica con un clic. */
export async function pubblicaBozza(id: string): Promise<Esito> {
  const user = await requireUser();
  const db = await getArticoliDb();
  const a = db.articoli.find((x) => x.id === id);
  if (!a || !modificaArticolo(user, a, db)) return { ok: false, error: "Non puoi pubblicare questo articolo" };
  a.stato = "pubblicato";
  a.pubblicato ??= new Date().toISOString();
  await saveArticoliDb(db);
  revalidatePath("/articoli", "layout");
  return { ok: true };
}
