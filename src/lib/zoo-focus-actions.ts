"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "./auth";
import { canAccessArea, isZooEditor } from "./stampe";
import { getZooDb, saveZooDb, animaleFocus, fotoDaAbbinare } from "./zoo";
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
  revalidatePath("/stampe/zoo/dati");
  return { ok: true, error: `${elenco.length} foto ignorate` };
}

/** Rimette fra quelle da abbinare le foto ignorate. */
export async function ripristinaZooFotoIgnorate(): Promise<Esito> {
  if (!(await editorZoo())) return { ok: false, error: "Non autorizzato." };
  const db = await getZooDb();
  db.settings.fotoIgnorate = [];
  await saveZooDb(db);
  revalidatePath("/stampe/zoo/dati");
  return { ok: true };
}
