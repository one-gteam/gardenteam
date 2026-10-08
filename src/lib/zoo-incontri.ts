"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "./auth";
import { canAccessArea, isZooEditor } from "./stampe";
import { readDomain, writeDomain } from "./supabase";

/*
 * Incontri di lavoro sul volantino: quando ci si trova, quanto dura, chi c'è.
 * Si avviano e si chiudono con un pulsante in Crea Volantino, e anche da soli:
 * il primo gesto sulla pagina avvia un incontro se non ce n'è uno aperto, e
 * dopo INATTIVITA_MIN minuti senza gesti l'incontro si chiude all'ultimo gesto
 * (anche se la pagina è stata chiusa senza premere «Termina»).
 *
 * Stanno in un dominio a parte («zoo_incontri»): il battito ogni minuto non
 * deve riscrivere tutto il database Zoo.
 */

export interface Incontro {
  id: string;
  campaignId: string;
  inizio: string; // ISO
  /** ultimo gesto registrato: se è vecchio di più di INATTIVITA_MIN, l'incontro è finito lì */
  ultimo: string;
  fine?: string;
  partecipanti: string[]; // id utente
  avviatoDa: string;
  /** avviato da solo al primo gesto, non col pulsante */
  auto?: boolean;
  /** chiuso da solo per inattività */
  chiusoAuto?: boolean;
}
interface DbIncontri { incontri: Incontro[] }

const INATTIVITA_MIN = 15;
const vuoto: DbIncontri = { incontri: [] };

async function editor() {
  const user = await requireUser();
  if (!canAccessArea(user, "zoo")) return null;
  return user;
}

/** Chiude gli incontri rimasti aperti senza gesti da troppo tempo; true se ha cambiato qualcosa. */
function chiudiScaduti(db: DbIncontri, ora = Date.now()): boolean {
  let cambiato = false;
  for (const i of db.incontri) {
    if (!i.fine && ora - Date.parse(i.ultimo) > INATTIVITA_MIN * 60_000) {
      i.fine = i.ultimo;
      i.chiusoAuto = true;
      cambiato = true;
    }
  }
  return cambiato;
}

export async function incontriDelVolantino(campaignId: string): Promise<Incontro[]> {
  const db = await readDomain<DbIncontri>("zoo_incontri", vuoto);
  chiudiScaduti(db);
  return (db.incontri ?? []).filter((i) => i.campaignId === campaignId).sort((a, b) => b.inizio.localeCompare(a.inizio));
}

export type StatoIncontro = { aperto?: Incontro; minutiInattivita: number };

async function stato(db: DbIncontri, campaignId: string): Promise<StatoIncontro> {
  return { aperto: db.incontri.find((i) => i.campaignId === campaignId && !i.fine), minutiInattivita: INATTIVITA_MIN };
}

export async function statoIncontro(campaignId: string): Promise<StatoIncontro> {
  const db = await readDomain<DbIncontri>("zoo_incontri", vuoto);
  if (chiudiScaduti(db)) await writeDomain("zoo_incontri", db);
  return stato(db, campaignId);
}

/** Avvio col pulsante (o automatico, al primo gesto). Se ce n'è già uno aperto, resta quello. */
export async function avviaIncontro(campaignId: string, auto = false): Promise<StatoIncontro> {
  const user = await editor();
  if (!user) return { minutiInattivita: INATTIVITA_MIN };
  const db = await readDomain<DbIncontri>("zoo_incontri", vuoto);
  db.incontri ??= [];
  chiudiScaduti(db);
  let aperto = db.incontri.find((i) => i.campaignId === campaignId && !i.fine);
  const ora = new Date().toISOString();
  if (!aperto) {
    aperto = { id: `inc_${Date.now().toString(36)}`, campaignId, inizio: ora, ultimo: ora, partecipanti: [user.id], avviatoDa: user.id, auto: auto || undefined };
    db.incontri.push(aperto);
  } else {
    aperto.ultimo = ora;
    if (!aperto.partecipanti.includes(user.id)) aperto.partecipanti.push(user.id);
  }
  await writeDomain("zoo_incontri", db);
  revalidatePath("/stampe/zoo/dashboard");
  return stato(db, campaignId);
}

/**
 * Il battito della pagina: c'è stato un gesto. Tiene vivo l'incontro aperto
 * (e aggiunge chi sta lavorando ai partecipanti); se non ce n'è uno, lo avvia.
 */
export async function battitoIncontro(campaignId: string): Promise<StatoIncontro> {
  return avviaIncontro(campaignId, true);
}

export async function terminaIncontro(campaignId: string, perInattivita = false): Promise<StatoIncontro> {
  const user = await editor();
  if (!user) return { minutiInattivita: INATTIVITA_MIN };
  const db = await readDomain<DbIncontri>("zoo_incontri", vuoto);
  db.incontri ??= [];
  chiudiScaduti(db);
  const aperto = db.incontri.find((i) => i.campaignId === campaignId && !i.fine);
  if (aperto) {
    aperto.fine = perInattivita ? aperto.ultimo : new Date().toISOString();
    if (perInattivita) aperto.chiusoAuto = true;
    await writeDomain("zoo_incontri", db);
  }
  revalidatePath("/stampe/zoo/dashboard");
  return stato(db, campaignId);
}

/** Chi c'era: si spunta a mano (anche per un incontro già chiuso). */
export async function partecipantiIncontro(incontroId: string, userIds: string[]): Promise<{ ok: boolean }> {
  const user = await editor();
  if (!user) return { ok: false };
  const db = await readDomain<DbIncontri>("zoo_incontri", vuoto);
  const i = (db.incontri ?? []).find((x) => x.id === incontroId);
  if (!i) return { ok: false };
  i.partecipanti = [...new Set(userIds.filter((x) => typeof x === "string").slice(0, 60))];
  await writeDomain("zoo_incontri", db);
  revalidatePath("/stampe/zoo/dashboard");
  return { ok: true };
}

/** Correzione a mano (dashboard): orari e cancellazione di un incontro registrato per sbaglio. */
export async function correggiIncontro(incontroId: string, fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!isZooEditor(user)) return { ok: false, error: "Solo chi cura lo Zoo per il Consorzio." };
  const db = await readDomain<DbIncontri>("zoo_incontri", vuoto);
  db.incontri ??= [];
  if (fd.get("elimina") === "1") {
    db.incontri = db.incontri.filter((x) => x.id !== incontroId);
  } else {
    const i = db.incontri.find((x) => x.id === incontroId);
    if (!i) return { ok: false, error: "Incontro non trovato." };
    const ini = String(fd.get("inizio") ?? ""), fin = String(fd.get("fine") ?? "");
    if (ini && !Number.isNaN(Date.parse(ini))) i.inizio = new Date(ini).toISOString();
    if (fin && !Number.isNaN(Date.parse(fin))) { i.fine = new Date(fin).toISOString(); i.ultimo = i.fine; }
  }
  await writeDomain("zoo_incontri", db);
  revalidatePath("/stampe/zoo/dashboard");
  return { ok: true };
}
