"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "./auth";
import { canAccessArea, isZooEditor } from "./stampe";
import { readDomain, writeDomain } from "./supabase";
import { getDb } from "./db";
import { getZooDb } from "./zoo";
import { sendMail } from "./mailer";

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
/** Un incontro fissato in anticipo per una squadra (Zoo, Comunicazione…). */
export interface IncontroProgrammato {
  id: string;
  campaignId: string;
  squadra: string;
  quando: string; // ISO
  durataMin: number;
  partecipanti: string[];
  testo?: string;
  creatoDa: string;
  mailInviateIl?: string;
}
interface DbIncontri { incontri: Incontro[]; programmati?: IncontroProgrammato[]; squadre?: Record<string, string[]> }

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

/** «Inizio»: il tempo dell'incontro aperto riparte da adesso (es. se era partito da solo mentre si guardava la pagina). */
export async function iniziaDaOra(campaignId: string): Promise<StatoIncontro> {
  const user = await editor();
  if (!user) return { minutiInattivita: INATTIVITA_MIN };
  const db = await readDomain<DbIncontri>("zoo_incontri", vuoto);
  db.incontri ??= [];
  chiudiScaduti(db);
  const ora = new Date().toISOString();
  let aperto = db.incontri.find((i) => i.campaignId === campaignId && !i.fine);
  if (aperto) { aperto.inizio = ora; aperto.ultimo = ora; aperto.auto = undefined; }
  else {
    aperto = { id: `inc_${Date.now().toString(36)}`, campaignId, inizio: ora, ultimo: ora, partecipanti: [user.id], avviatoDa: user.id };
    db.incontri.push(aperto);
  }
  await writeDomain("zoo_incontri", db);
  revalidatePath("/stampe/zoo/dashboard");
  return stato(db, campaignId);
}

/* ================== incontri fissati in anticipo ================== */

export async function incontriProgrammati(campaignId: string): Promise<{ programmati: IncontroProgrammato[]; squadre: Record<string, string[]> }> {
  const db = await readDomain<DbIncontri>("zoo_incontri", vuoto);
  return {
    programmati: (db.programmati ?? []).filter((p) => p.campaignId === campaignId).sort((a, b) => a.quando.localeCompare(b.quando)),
    squadre: db.squadre ?? {},
  };
}

/** Fissa un incontro di squadra; se richiesto manda la mail a ogni partecipante. Le persone si ricordano per la squadra. */
export async function programmaIncontro(campaignId: string, fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!isZooEditor(user)) return { ok: false, error: "Solo chi cura lo Zoo per il Consorzio." };
  const squadra = String(fd.get("squadra") ?? "").trim().slice(0, 40);
  const quando = String(fd.get("quando") ?? "");
  const durataMin = Math.max(15, Math.min(480, Number(fd.get("durata")) || 60));
  const testo = String(fd.get("testo") ?? "").trim().slice(0, 2000) || undefined;
  const partecipanti = [...new Set((fd.getAll("partecipanti") as string[]).filter(Boolean))].slice(0, 60);
  if (!squadra) return { ok: false, error: "Scegli la squadra." };
  // il campo datetime-local è l'ora italiana del browser: la si legge come ora di Roma
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(quando);
  if (!m) return { ok: false, error: "Scegli data e ora." };
  const quandoIso = romaInIso(quando);
  if (partecipanti.length === 0) return { ok: false, error: "Scegli almeno una persona." };

  const db = await readDomain<DbIncontri>("zoo_incontri", vuoto);
  db.incontri ??= [];
  db.programmati ??= [];
  db.squadre = { ...(db.squadre ?? {}), [squadra]: partecipanti };
  const p: IncontroProgrammato = { id: `prog_${Date.now().toString(36)}`, campaignId, squadra, quando: quandoIso, durataMin, partecipanti, testo, creatoDa: user.id };
  db.programmati.push(p);

  let esito = "Incontro fissato.";
  if (fd.get("invia") === "1") {
    const [academy, zoo] = await Promise.all([getDb(), getZooDb()]);
    const volantino = zoo.campaigns.find((c) => c.id === campaignId)?.nome ?? "volantino Zoo";
    const quandoTesto = new Date(quandoIso).toLocaleString("it-IT", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });
    const sito = (process.env.SITE_URL || "https://gardenteam.vercel.app").replace(/\/$/, "");
    let inviate = 0;
    for (const id of partecipanti) {
      const u = academy.users.find((x) => x.id === id);
      if (!u?.email) continue;
      const corpo = [
        `Ciao ${u.firstName},`,
        "",
        `incontro della squadra ${squadra} per «${volantino}»: ${quandoTesto}, durata ${durataMin} minuti.`,
        testo ? `\n${testo}\n` : "",
        `Partecipano: ${partecipanti.map((pid) => { const x = academy.users.find((y) => y.id === pid); return x ? `${x.firstName} ${x.lastName}` : ""; }).filter(Boolean).join(", ")}.`,
        "",
        `Per lavorare sul volantino: ${sito}/stampe/zoo/crea-volantino`,
        "",
        `${user.firstName} ${user.lastName}`,
      ].join("\n");
      const r = await sendMail(u.email, `Incontro ${squadra} · ${volantino} · ${quandoTesto}`, corpo, { marchio: "gtone" }).catch(() => ({ sent: false as const }));
      if (r.sent === true) inviate++;
    }
    p.mailInviateIl = new Date().toISOString();
    esito = inviate > 0
      ? `Incontro fissato e mail mandata a ${inviate} ${inviate === 1 ? "persona" : "persone"}.`
      : "Incontro fissato, ma nessuna mail è partita (invio mail non configurato o indirizzi mancanti).";
  }
  await writeDomain("zoo_incontri", db);
  revalidatePath("/stampe/zoo/dashboard");
  return { ok: true, error: esito };
}

export async function eliminaProgrammato(id: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!isZooEditor(user)) return { ok: false, error: "Non autorizzato." };
  const db = await readDomain<DbIncontri>("zoo_incontri", vuoto);
  db.programmati = (db.programmati ?? []).filter((p) => p.id !== id);
  await writeDomain("zoo_incontri", db);
  revalidatePath("/stampe/zoo/dashboard");
  return { ok: true };
}

/** "2026-10-14T15:00" letto come ora di Roma → ISO (UTC). */
function romaInIso(locale: string): string {
  const comeUtc = Date.parse(`${locale}:00Z`);
  // differenza fra Roma e UTC in quel momento (CET +1, CEST +2), letta pezzo per pezzo
  const parti = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(comeUtc)).map((p) => [p.type, p.value]));
  const comeRoma = Date.UTC(Number(parti.year), Number(parti.month) - 1, Number(parti.day), Number(parti.hour), Number(parti.minute));
  return new Date(comeUtc - (comeRoma - comeUtc)).toISOString();
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
