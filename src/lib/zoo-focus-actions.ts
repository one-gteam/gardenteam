"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "./auth";
import { canAccessArea, isZooEditor } from "./stampe";
import { getZooDb, saveZooDb, animaleFocus, fotoDaAbbinare, type ZooDB } from "./zoo";
import { listStorageFiles } from "./supabase";

/*
 * Storico focus modificabile e foto da ignorare. Rispondono { ok, error } e
 * non ricaricano la pagina: le usano ModuloInvio / ModuloAutoSalva /
 * PulsanteAzione. Le modifiche sono del Consorzio (chi cura lo Zoo).
 */

type Esito = { ok: boolean; error?: string };

async function editorZoo() {
  const user = await requireUser();
  if (!canAccessArea(user, "zoo") || !isZooEditor(user)) return null;
  return user;
}

const testo = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);
const data = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
const nuovoId = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function aggiorna() {
  revalidatePath("/stampe/zoo/focus");
  revalidatePath("/stampe/zoo/crea-volantino");
  revalidatePath("/stampe/zoo/dashboard");
}

const stesso = (a?: string, b?: string) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
const COLORI_FOCUS = ["#e8f3ea", "#fde8ef", "#e6eefb", "#fff3d6", "#efe6fb", "#e0f4f4", "#fbe9df"];
function defDi(db: ZooDB, campaignId: string, nome: string) {
  return db.focusDef.find((f) => f.campaignId === campaignId && stesso(f.nome, nome));
}

/* ================== Focus del volantino in lavorazione (pagina Focus, Crea Volantino) ================== */

/**
 * Crea un focus (nomePrima null) o ne cambia nome, descrizione e colore. Il
 * nome nuovo si riporta su tutte le offerte che avevano quello vecchio.
 */
export async function salvaFocusDef(campaignId: string, nomePrima: string | null, fd: FormData): Promise<Esito> {
  if (!(await editorZoo())) return { ok: false, error: "Solo chi cura lo Zoo per il Consorzio." };
  const db = await getZooDb();
  const nome = testo(fd, "nome", 120);
  if (!nome) return { ok: false, error: "Scrivi il nome del focus." };
  const descrizione = String(fd.get("descrizione") ?? "").trim().slice(0, 2000);
  const libero = String(fd.get("coloreLibero") ?? "");
  const scelto = String(fd.get("colore") ?? "");
  const colore = /^#[0-9a-f]{6}$/i.test(scelto) ? scelto : /^#[0-9a-f]{6}$/i.test(libero) ? libero : undefined;
  if (nomePrima === null) {
    if (defDi(db, campaignId, nome) || db.offers.some((o) => o.campaignId === campaignId && stesso(o.focus, nome))) return { ok: false, error: "C'è già un focus con questo nome." };
    const n = db.focusDef.filter((f) => f.campaignId === campaignId).length;
    db.focusDef.push({ id: nuovoId("fd"), campaignId, nome, descrizione: descrizione || undefined, colore: colore ?? COLORI_FOCUS[n % COLORI_FOCUS.length] });
  } else {
    let def = defDi(db, campaignId, nomePrima);
    if (!def) { def = { id: nuovoId("fd"), campaignId, nome: nomePrima }; db.focusDef.push(def); }
    if (!stesso(nome, nomePrima)) {
      if (defDi(db, campaignId, nome)) return { ok: false, error: "C'è già un focus con questo nome: per metterli insieme trascina l'intestazione sull'altro." };
      for (const o of db.offers) if (o.campaignId === campaignId && stesso(o.focus, nomePrima)) o.focus = nome;
    }
    def.nome = nome;
    def.descrizione = descrizione || undefined;
    if (colore) def.colore = colore;
  }
  await saveZooDb(db);
  aggiorna();
  return { ok: true };
}

/** Sposta offerte in un focus (nome vuoto = senza focus). */
export async function spostaInFocus(campaignId: string, offerIds: string[], nome: string): Promise<Esito> {
  if (!(await editorZoo())) return { ok: false, error: "Non autorizzato." };
  const db = await getZooDb();
  const def = nome ? defDi(db, campaignId, nome) : undefined;
  let n = 0;
  for (const o of db.offers) {
    if (o.campaignId !== campaignId || !offerIds.includes(o.id)) continue;
    o.focus = nome ? (def?.nome ?? nome) : undefined;
    if (!nome) o.focusAnimale = undefined;
    n++;
  }
  if (!n) return { ok: false, error: "Offerte non trovate: ricarica la pagina." };
  await saveZooDb(db);
  aggiorna();
  return { ok: true };
}

/** Assegna un focus (anche nuovo) alle offerte di una o più celle di Crea Volantino; risponde col colore. */
export async function assegnaFocusOfferte(campaignId: string, offerIds: string[], nome: string): Promise<{ ok: boolean; colore?: string; error?: string }> {
  if (!(await editorZoo())) return { ok: false, error: "Non autorizzato." };
  const db = await getZooDb();
  const n = nome.trim().slice(0, 120);
  let def = n ? defDi(db, campaignId, n) : undefined;
  if (n && !def) {
    const quanti = db.focusDef.filter((f) => f.campaignId === campaignId).length;
    def = { id: nuovoId("fd"), campaignId, nome: n, colore: COLORI_FOCUS[quanti % COLORI_FOCUS.length] };
    db.focusDef.push(def);
  }
  for (const o of db.offers) if (o.campaignId === campaignId && offerIds.includes(o.id)) o.focus = def?.nome || undefined;
  await saveZooDb(db);
  aggiorna();
  return { ok: true, colore: def?.colore };
}

/** Unisce il focus «da» dentro «in»: le offerte passano tutte in «in», la descrizione si accoda. */
export async function unisciFocus(campaignId: string, da: string, dentro: string): Promise<Esito> {
  if (!(await editorZoo())) return { ok: false, error: "Non autorizzato." };
  const db = await getZooDb();
  const dest = defDi(db, campaignId, dentro);
  const orig = defDi(db, campaignId, da);
  for (const o of db.offers) if (o.campaignId === campaignId && stesso(o.focus, da)) o.focus = dest?.nome ?? dentro;
  if (dest && orig?.descrizione) dest.descrizione = [dest.descrizione, orig.descrizione].filter(Boolean).join("\n\n");
  if (orig) db.focusDef = db.focusDef.filter((f) => f !== orig);
  await saveZooDb(db);
  aggiorna();
  return { ok: true };
}

/** Elimina un focus: le offerte restano nel volantino, senza focus. */
export async function eliminaFocus(campaignId: string, nome: string): Promise<Esito> {
  if (!(await editorZoo())) return { ok: false, error: "Non autorizzato." };
  const db = await getZooDb();
  for (const o of db.offers) if (o.campaignId === campaignId && stesso(o.focus, nome)) { o.focus = undefined; o.focusAnimale = undefined; }
  db.focusDef = db.focusDef.filter((f) => !(f.campaignId === campaignId && stesso(f.nome, nome)));
  await saveZooDb(db);
  aggiorna();
  return { ok: true };
}

/** Storico: elimina TUTTI i focus di un volantino (es. quelli di prova). */
export async function eliminaTuttiIFocus(campaignId: string): Promise<Esito> {
  if (!(await editorZoo())) return { ok: false, error: "Non autorizzato." };
  const db = await getZooDb();
  for (const o of db.offers) if (o.campaignId === campaignId) { o.focus = undefined; o.focusAnimale = undefined; }
  db.focusDef = db.focusDef.filter((f) => f.campaignId !== campaignId);
  const c = db.campaigns.find((x) => x.id === campaignId);
  if (c) c.focusNote = undefined;
  await saveZooDb(db);
  aggiorna();
  return { ok: true };
}

/** Storico: archivia (o riapre) i focus di un volantino: restano salvati ma non si vedono più. */
export async function archiviaFocusVolantino(campaignId: string, archivia: boolean): Promise<Esito> {
  if (!(await editorZoo())) return { ok: false, error: "Non autorizzato." };
  const db = await getZooDb();
  const c = db.campaigns.find((x) => x.id === campaignId);
  if (!c) return { ok: false, error: "Volantino non trovato." };
  c.focusArchiviato = archivia || undefined;
  await saveZooDb(db);
  aggiorna();
  return { ok: true };
}

/* ================== Focus dei volantini fatti col sito ================== */

/** Rinomina un focus e/o lo sposta sotto un altro animale: vale per tutte le sue offerte. */
export async function modificaFocus(campaignId: string, animale: string, focusChiave: string, fd: FormData): Promise<Esito> {
  if (!(await editorZoo())) return { ok: false, error: "Solo chi cura lo Zoo per il Consorzio modifica lo storico." };
  const db = await getZooDb();
  const nuovoFocus = testo(fd, "focus");
  const nuovoAnimale = testo(fd, "animale", 60);
  if (!nuovoFocus) return { ok: false, error: "Scrivi il focus." };
  let n = 0;
  for (const o of db.offers) {
    if (o.campaignId !== campaignId || (o.focus ?? "").trim().toLowerCase() !== focusChiave) continue;
    if (animaleFocus(db, o) !== animale) continue;
    o.focus = nuovoFocus;
    if (nuovoAnimale && nuovoAnimale !== animaleFocus(db, { ...o, focusAnimale: undefined })) o.focusAnimale = nuovoAnimale;
    else o.focusAnimale = undefined;
    n++;
  }
  if (!n) return { ok: false, error: "Focus non trovato: ricarica la pagina." };
  await saveZooDb(db);
  aggiorna();
  return { ok: true };
}

/** Toglie un'offerta dal suo focus (l'offerta resta nel volantino). */
export async function togliDalFocus(offerId: string): Promise<Esito> {
  if (!(await editorZoo())) return { ok: false, error: "Non autorizzato." };
  const db = await getZooDb();
  const o = db.offers.find((x) => x.id === offerId);
  if (!o) return { ok: false, error: "Offerta non trovata." };
  o.focus = undefined;
  o.focusAnimale = undefined;
  await saveZooDb(db);
  aggiorna();
  return { ok: true };
}

/** Mette un'offerta del volantino sotto un focus (nuovo o esistente). */
export async function aggiungiAlFocus(campaignId: string, fd: FormData): Promise<Esito> {
  if (!(await editorZoo())) return { ok: false, error: "Non autorizzato." };
  const db = await getZooDb();
  const o = db.offers.find((x) => x.id === testo(fd, "offerId", 80) && x.campaignId === campaignId);
  const focus = testo(fd, "focus");
  const animale = testo(fd, "animale", 60);
  if (!o) return { ok: false, error: "Scegli un'offerta del volantino." };
  if (!focus) return { ok: false, error: "Scrivi il focus." };
  o.focus = focus;
  o.focusAnimale = animale && animale !== animaleFocus(db, { ...o, focusAnimale: undefined }) ? animale : undefined;
  await saveZooDb(db);
  aggiorna();
  return { ok: true };
}

/** Nota libera del volantino nello storico. */
export async function notaFocusCampagna(campaignId: string, fd: FormData): Promise<Esito> {
  if (!(await editorZoo())) return { ok: false, error: "Non autorizzato." };
  const db = await getZooDb();
  const c = db.campaigns.find((x) => x.id === campaignId);
  if (!c) return { ok: false, error: "Volantino non trovato." };
  c.focusNote = testo(fd, "note", 2000) || undefined;
  await saveZooDb(db);
  aggiorna();
  return { ok: true };
}

/* ================== Volantini riportati a mano ================== */

export async function creaVolantinoFocus(fd: FormData): Promise<Esito> {
  if (!(await editorZoo())) return { ok: false, error: "Non autorizzato." };
  const nome = testo(fd, "nome", 120);
  const dal = data(testo(fd, "dal", 10));
  if (!nome || !dal) return { ok: false, error: "Servono nome e data di uscita." };
  const db = await getZooDb();
  db.focusManuali.push({
    id: nuovoId("fv"), nome, dal, al: data(testo(fd, "al", 10)) || undefined,
    gruppi: [], creatoIl: new Date().toISOString(),
  });
  await saveZooDb(db);
  aggiorna();
  return { ok: true };
}

export async function salvaVolantinoFocus(id: string, fd: FormData): Promise<Esito> {
  if (!(await editorZoo())) return { ok: false, error: "Non autorizzato." };
  const db = await getZooDb();
  const v = db.focusManuali.find((x) => x.id === id);
  if (!v) return { ok: false, error: "Volantino non trovato." };
  const nome = testo(fd, "nome", 120);
  const dal = data(testo(fd, "dal", 10));
  if (!nome || !dal) return { ok: false, error: "Servono nome e data di uscita." };
  v.nome = nome;
  v.dal = dal;
  v.al = data(testo(fd, "al", 10)) || undefined;
  v.note = testo(fd, "note", 2000) || undefined;
  await saveZooDb(db);
  aggiorna();
  return { ok: true };
}

export async function eliminaVolantinoFocus(id: string): Promise<Esito> {
  if (!(await editorZoo())) return { ok: false, error: "Non autorizzato." };
  const db = await getZooDb();
  db.focusManuali = db.focusManuali.filter((x) => x.id !== id);
  await saveZooDb(db);
  aggiorna();
  return { ok: true };
}

/** Crea (gruppoId null) o aggiorna un focus di un volantino riportato a mano. */
export async function salvaGruppoFocus(volantinoId: string, gruppoId: string | null, fd: FormData): Promise<Esito> {
  if (!(await editorZoo())) return { ok: false, error: "Non autorizzato." };
  const db = await getZooDb();
  const v = db.focusManuali.find((x) => x.id === volantinoId);
  if (!v) return { ok: false, error: "Volantino non trovato." };
  const focus = testo(fd, "focus");
  const animale = testo(fd, "animale", 60) || "Altro";
  const righe = String(fd.get("righe") ?? "").replace(/\r/g, "").slice(0, 4000);
  if (!focus) return { ok: false, error: "Scrivi il focus." };
  const g = gruppoId ? v.gruppi.find((x) => x.id === gruppoId) : undefined;
  if (g) Object.assign(g, { focus, animale, righe });
  else v.gruppi.push({ id: nuovoId("fg"), focus, animale, righe });
  await saveZooDb(db);
  aggiorna();
  return { ok: true };
}

export async function eliminaGruppoFocus(volantinoId: string, gruppoId: string): Promise<Esito> {
  if (!(await editorZoo())) return { ok: false, error: "Non autorizzato." };
  const db = await getZooDb();
  const v = db.focusManuali.find((x) => x.id === volantinoId);
  if (!v) return { ok: false, error: "Volantino non trovato." };
  v.gruppi = v.gruppi.filter((g) => g.id !== gruppoId);
  await saveZooDb(db);
  aggiorna();
  return { ok: true };
}

/* ================== Foto da abbinare: ignorare ================== */

/** Non propone più queste foto fra quelle da abbinare (null = tutte quelle in attesa adesso). */
export async function ignoraZooFoto(files: string[] | null): Promise<Esito> {
  if (!(await editorZoo())) return { ok: false, error: "Non autorizzato." };
  const db = await getZooDb();
  const elenco = files ?? fotoDaAbbinare(db, await listStorageFiles("zoo-foto")).daAbbinare;
  db.settings.fotoIgnorate = [...new Set([...(db.settings.fotoIgnorate ?? []), ...elenco.filter((f) => typeof f === "string" && f)])];
  await saveZooDb(db);
  revalidatePath("/stampe/zoo/prodotti");
  return { ok: true, error: `${elenco.length} foto ignorate` };
}

/** Rimette fra quelle da abbinare le foto ignorate. */
export async function ripristinaZooFotoIgnorate(): Promise<Esito> {
  if (!(await editorZoo())) return { ok: false, error: "Non autorizzato." };
  const db = await getZooDb();
  db.settings.fotoIgnorate = [];
  await saveZooDb(db);
  revalidatePath("/stampe/zoo/prodotti");
  return { ok: true };
}
