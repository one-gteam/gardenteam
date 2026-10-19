"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "./auth";
import { getDb, saveDb } from "./db";
import { getZooDb, saveZooDb, campagnaInLavorazione, campagnaInCorso, type ZooScopeGiacenze } from "./zoo";
import { getStampeDb, saveStampeDb } from "./stampe";
import { indirizzoLetturaValido, leggiQuantitaArredo } from "./arredo-lettura";
import { registra } from "./registro";
import { leggiConnettoriFox, scriviConnettoriFox, nuovaChiaveFox } from "./fox-connettore";
import { permessoRuolo, type DB, type User } from "./types";

/*
 * Area Connettori: i collegamenti fra GT One e i sistemi delle insegne e dei
 * punti vendita, tutti in una pagina. Per Zoo e Arredo due versi:
 *  - «GT One legge»: il gestionale espone un indirizzo e GT One lo chiama
 *    (Zoo: giacenze e prezzi per EAN, quando servono; Arredo: le quantità del
 *    catalogo, ogni mattina). Si accende, si spegne, si prova.
 *  - «il gestionale invia»: con una chiave (Authorization: Bearer) manda i
 *    dati a GT One (Zoo: /api/connettori/fox, anche col programma per Fox;
 *    Arredo: /api/arredo-giacenze). Si crea, si rigenera, si spegne.
 *  - SSO: il sistema dell'insegna fa entrare i suoi collaboratori con un link
 *    firmato con la chiave dell'insegna (come My Rosaflor fa per Rosàflor).
 *  - Zoo, «il gestionale legge»: il gestionale legge le offerte Zoo con una
 *    chiave (GET /api/zoo/offerte), per stampare i cartelli dal proprio
 *    programma e controllare a scaffale. Si crea, si rigenera, si spegne.
 * Chi entra: per permesso del ruolo (accesso_connettori), ciascuno sulla
 * propria insegna; l'amministratore di sistema su tutte.
 */

type Esito = { ok: boolean; error?: string };
type TipoAmbito = "tenant" | "store";

/** Chi può toccare questo ambito: l'amministratore di sistema, o chi ha il permesso ed è di quell'insegna. */
async function autorizzato(tipo: TipoAmbito, id: string): Promise<User | null> {
  const u = await getCurrentUser();
  if (!u || !permessoRuolo(u.role, "accesso_connettori")) return null;
  if (u.role === "system_admin") return u;
  const academyDb = await getDb();
  const insegna = tipo === "tenant" ? id : academyDb.stores.find((s) => s.id === id)?.tenantId;
  return u.tenantId && insegna === u.tenantId ? u : null;
}
const NEGATO = "Non puoi toccare i connettori di questa insegna.";

function nomeAmbito(academyDb: DB, tipo: TipoAmbito, id: string): string {
  return tipo === "tenant"
    ? academyDb.tenants.find((t) => t.id === id)?.name ?? id
    : academyDb.stores.find((s) => s.id === id)?.name ?? id;
}

function ambitoValido(academyDb: DB, tipo: TipoAmbito, id: string): boolean {
  return tipo === "tenant" ? academyDb.tenants.some((t) => t.id === id) : academyDb.stores.some((s) => s.id === id);
}

const trova = (lista: ZooScopeGiacenze[], tipo: TipoAmbito, id: string) =>
  lista.find((g) => g.scopeType === tipo && g.scopeId === id);

/* ================== Zoo: giacenze e prezzi, GT One interroga ================== */

export async function salvaConnettoreZoo(tipo: TipoAmbito, id: string, fd: FormData): Promise<Esito> {
  const user = await autorizzato(tipo, id);
  if (!user) return { ok: false, error: NEGATO };
  const academyDb = await getDb();
  if (!ambitoValido(academyDb, tipo, id)) return { ok: false, error: "Ambito non trovato." };
  const url = String(fd.get("url") ?? "").trim();
  const nome = String(fd.get("nome") ?? "").trim().slice(0, 40);
  if (!/^https:\/\/\S+$/.test(url)) return { ok: false, error: "Serve un indirizzo che inizi con https://" };
  const db = await getZooDb();
  const esistente = trova(db.giacenze, tipo, id);
  const prima = esistente?.url ?? "";
  if (esistente) {
    esistente.url = url;
    esistente.nome = nome || undefined;
    // indirizzo nuovo: la prova vecchia non dice più niente
    if (prima !== url) { esistente.provatoIl = undefined; esistente.esito = undefined; }
  } else {
    db.giacenze.push({ scopeType: tipo, scopeId: id, url, nome: nome || undefined, attivo: true });
  }
  await saveZooDb(db);
  registra(user, { area: "connettori", cosa: esistente ? "Connettore Zoo modificato" : "Connettore Zoo creato", oggetto: nomeAmbito(academyDb, tipo, id), prima: prima || undefined, dopo: url });
  revalidatePath("/connettori");
  return { ok: true };
}

export async function accendiConnettoreZoo(tipo: TipoAmbito, id: string, acceso: boolean): Promise<Esito> {
  const user = await autorizzato(tipo, id);
  if (!user) return { ok: false, error: NEGATO };
  const db = await getZooDb();
  const g = trova(db.giacenze, tipo, id);
  if (!g) return { ok: false, error: "Connettore non trovato." };
  g.attivo = acceso;
  await saveZooDb(db);
  const academyDb = await getDb();
  registra(user, { area: "connettori", cosa: acceso ? "Connettore Zoo acceso" : "Connettore Zoo spento", oggetto: nomeAmbito(academyDb, tipo, id) });
  revalidatePath("/connettori");
  return { ok: true };
}

export async function scollegaConnettoreZoo(tipo: TipoAmbito, id: string): Promise<Esito> {
  const user = await autorizzato(tipo, id);
  if (!user) return { ok: false, error: NEGATO };
  const db = await getZooDb();
  const g = trova(db.giacenze, tipo, id);
  if (!g) return { ok: false, error: "Connettore non trovato." };
  db.giacenze = db.giacenze.filter((x) => x !== g);
  await saveZooDb(db);
  const academyDb = await getDb();
  registra(user, { area: "connettori", cosa: "Connettore Zoo scollegato", oggetto: nomeAmbito(academyDb, tipo, id), prima: g.url });
  revalidatePath("/connettori");
  return { ok: true };
}

/**
 * Prova il collegamento con qualche EAN del volantino in corso: dice quanti
 * articoli il gestionale conosce e se manda anche il prezzo. L'esito resta
 * scritto sul connettore, così si vede quando è stato provato l'ultima volta.
 */
export async function provaConnettoreZoo(tipo: TipoAmbito, id: string): Promise<Esito & { esito?: string }> {
  const user = await autorizzato(tipo, id);
  if (!user) return { ok: false, error: NEGATO };
  const db = await getZooDb();
  const g = trova(db.giacenze, tipo, id);
  if (!g) return { ok: false, error: "Connettore non trovato." };
  const campagna = campagnaInLavorazione(db) ?? campagnaInCorso(db);
  const eans = [...new Set((campagna ? db.offers.filter((o) => o.campaignId === campagna.id) : db.offers).map((o) => o.ean).filter(Boolean))].slice(0, 25);
  if (eans.length === 0) return { ok: false, error: "Nessun EAN da provare: serve un volantino con offerte." };
  const inizio = Date.now();
  let esito: string;
  try {
    const r = await fetch(`${g.url}${g.url.includes("?") ? "&" : "?"}ean=${encodeURIComponent(eans.join(","))}`, {
      signal: AbortSignal.timeout(8000), cache: "no-store", headers: { accept: "application/json" },
    });
    if (!r.ok) esito = `Risposta ${r.status} dal gestionale`;
    else {
      const j = (await r.json().catch(() => null)) as { giacenze?: Record<string, { giacenza?: number; prezzo?: number }> } | null;
      if (!j || typeof j.giacenze !== "object") esito = "Risposta non nel formato atteso (manca «giacenze»)";
      else {
        const voci = Object.values(j.giacenze);
        const conPrezzo = voci.filter((v) => typeof v.prezzo === "number" && v.prezzo > 0).length;
        esito = `OK in ${Date.now() - inizio} ms: ${voci.length} su ${eans.length} EAN conosciuti, ${conPrezzo} con prezzo`;
      }
    }
  } catch (e) {
    esito = e instanceof Error && e.name === "TimeoutError" ? "Nessuna risposta entro 8 secondi" : "Gestionale non raggiungibile";
  }
  g.provatoIl = new Date().toISOString();
  g.esito = esito;
  await saveZooDb(db);
  revalidatePath("/connettori");
  return { ok: esito.startsWith("OK"), error: esito.startsWith("OK") ? undefined : esito, esito };
}

/* ================== Zoo: il gestionale legge le offerte ================== */

export async function creaChiaveLettura(tipo: TipoAmbito, id: string): Promise<Esito> {
  const user = await autorizzato(tipo, id);
  if (!user) return { ok: false, error: NEGATO };
  const academyDb = await getDb();
  if (!ambitoValido(academyDb, tipo, id)) return { ok: false, error: "Ambito non trovato." };
  const db = await getZooDb();
  let k = db.letture.find((x) => x.scopeType === tipo && x.scopeId === id);
  const nuova = !k;
  if (!k) { k = { scopeType: tipo, scopeId: id, token: "" }; db.letture.push(k); }
  k.token = `gtz_${randomBytes(24).toString("base64url")}`;
  k.attivo = true;
  k.creataIl = new Date().toISOString();
  await saveZooDb(db);
  registra(user, { area: "connettori", cosa: nuova ? "Chiave lettura offerte Zoo creata" : "Chiave lettura offerte Zoo rigenerata", oggetto: nomeAmbito(academyDb, tipo, id) });
  revalidatePath("/connettori");
  return { ok: true };
}

export async function accendiLettura(tipo: TipoAmbito, id: string, acceso: boolean): Promise<Esito> {
  const user = await autorizzato(tipo, id);
  if (!user) return { ok: false, error: NEGATO };
  const db = await getZooDb();
  const k = db.letture.find((x) => x.scopeType === tipo && x.scopeId === id);
  if (!k) return { ok: false, error: "Nessuna chiave per questo ambito." };
  k.attivo = acceso;
  await saveZooDb(db);
  const academyDb = await getDb();
  registra(user, { area: "connettori", cosa: acceso ? "Lettura offerte Zoo accesa" : "Lettura offerte Zoo spenta", oggetto: nomeAmbito(academyDb, tipo, id) });
  revalidatePath("/connettori");
  return { ok: true };
}

export async function togliChiaveLettura(tipo: TipoAmbito, id: string): Promise<Esito> {
  const user = await autorizzato(tipo, id);
  if (!user) return { ok: false, error: NEGATO };
  const db = await getZooDb();
  const prima = db.letture.length;
  db.letture = db.letture.filter((x) => !(x.scopeType === tipo && x.scopeId === id));
  if (db.letture.length === prima) return { ok: false, error: "Nessuna chiave per questo ambito." };
  await saveZooDb(db);
  const academyDb = await getDb();
  registra(user, { area: "connettori", cosa: "Chiave lettura offerte Zoo tolta", oggetto: nomeAmbito(academyDb, tipo, id) });
  revalidatePath("/connettori");
  return { ok: true };
}

/* ================== Zoo: il programma Fox manda giacenze e prezzi ================== */

export async function creaChiaveFox(tipo: TipoAmbito, id: string): Promise<Esito> {
  const user = await autorizzato(tipo, id);
  if (!user) return { ok: false, error: NEGATO };
  const academyDb = await getDb();
  if (!ambitoValido(academyDb, tipo, id)) return { ok: false, error: "Ambito non trovato." };
  const voci = await leggiConnettoriFox();
  let c = voci.find((x) => x.scopeType === tipo && x.scopeId === id);
  const nuova = !c;
  if (!c) { c = { scopeType: tipo, scopeId: id, chiave: "", creatoIl: new Date().toISOString() }; voci.push(c); }
  c.chiave = nuovaChiaveFox();
  c.attivo = true;
  await scriviConnettoriFox(voci);
  registra(user, { area: "connettori", cosa: nuova ? "Chiave programma Fox creata" : "Chiave programma Fox rigenerata", oggetto: nomeAmbito(academyDb, tipo, id) });
  revalidatePath("/connettori");
  return { ok: true };
}

export async function accendiFox(tipo: TipoAmbito, id: string, acceso: boolean): Promise<Esito> {
  const user = await autorizzato(tipo, id);
  if (!user) return { ok: false, error: NEGATO };
  const voci = await leggiConnettoriFox();
  const c = voci.find((x) => x.scopeType === tipo && x.scopeId === id);
  if (!c) return { ok: false, error: "Nessuna chiave per questo ambito." };
  c.attivo = acceso;
  await scriviConnettoriFox(voci);
  const academyDb = await getDb();
  registra(user, { area: "connettori", cosa: acceso ? "Programma Fox acceso" : "Programma Fox spento", oggetto: nomeAmbito(academyDb, tipo, id) });
  revalidatePath("/connettori");
  return { ok: true };
}

export async function togliChiaveFox(tipo: TipoAmbito, id: string): Promise<Esito> {
  const user = await autorizzato(tipo, id);
  if (!user) return { ok: false, error: NEGATO };
  const voci = await leggiConnettoriFox();
  const resto = voci.filter((x) => !(x.scopeType === tipo && x.scopeId === id));
  if (resto.length === voci.length) return { ok: false, error: "Nessuna chiave per questo ambito." };
  await scriviConnettoriFox(resto);
  const academyDb = await getDb();
  registra(user, { area: "connettori", cosa: "Chiave programma Fox tolta", oggetto: nomeAmbito(academyDb, tipo, id) });
  revalidatePath("/connettori");
  return { ok: true };
}

/* ================== Arredo: quantità del catalogo, il gestionale le manda ================== */

export async function creaChiaveArredo(storeId: string): Promise<Esito> {
  const user = await autorizzato("store", storeId);
  if (!user) return { ok: false, error: NEGATO };
  const academyDb = await getDb();
  if (!academyDb.stores.some((s) => s.id === storeId)) return { ok: false, error: "Punto vendita non trovato." };
  const db = await getStampeDb();
  let g = db.giacenze.find((x) => x.storeId === storeId);
  if (!g) { g = { storeId, quantita: {} }; db.giacenze.push(g); }
  const nuova = !g.token;
  g.token = `gt_${randomBytes(18).toString("base64url")}`;
  g.apiAttiva = true;
  await saveStampeDb(db);
  registra(user, { area: "connettori", cosa: nuova ? "Chiave Arredo creata" : "Chiave Arredo rigenerata", oggetto: nomeAmbito(academyDb, "store", storeId) });
  revalidatePath("/connettori");
  revalidatePath("/stampe/arredo/catalogo");
  return { ok: true };
}

export async function accendiApiArredo(storeId: string, acceso: boolean): Promise<Esito> {
  const user = await autorizzato("store", storeId);
  if (!user) return { ok: false, error: NEGATO };
  const db = await getStampeDb();
  const g = db.giacenze.find((x) => x.storeId === storeId);
  if (!g?.token) return { ok: false, error: "Nessuna chiave per questo punto vendita." };
  g.apiAttiva = acceso;
  await saveStampeDb(db);
  const academyDb = await getDb();
  registra(user, { area: "connettori", cosa: acceso ? "Chiave Arredo accesa" : "Chiave Arredo spenta", oggetto: nomeAmbito(academyDb, "store", storeId) });
  revalidatePath("/connettori");
  return { ok: true };
}

export async function togliChiaveArredo(storeId: string): Promise<Esito> {
  const user = await autorizzato("store", storeId);
  if (!user) return { ok: false, error: NEGATO };
  const db = await getStampeDb();
  const g = db.giacenze.find((x) => x.storeId === storeId);
  if (!g?.token) return { ok: false, error: "Nessuna chiave per questo punto vendita." };
  g.token = undefined;
  g.apiAttiva = undefined;
  await saveStampeDb(db);
  const academyDb = await getDb();
  registra(user, { area: "connettori", cosa: "Chiave Arredo tolta", oggetto: nomeAmbito(academyDb, "store", storeId) });
  revalidatePath("/connettori");
  revalidatePath("/stampe/arredo/catalogo");
  return { ok: true };
}

/* ================== Arredo: quantità del catalogo, GT One legge ================== */

export async function salvaLetturaArredo(storeId: string, fd: FormData): Promise<Esito & { esito?: string }> {
  const user = await autorizzato("store", storeId);
  if (!user) return { ok: false, error: NEGATO };
  const academyDb = await getDb();
  if (!academyDb.stores.some((s) => s.id === storeId)) return { ok: false, error: "Punto vendita non trovato." };
  const url = String(fd.get("url") ?? "").trim();
  if (!indirizzoLetturaValido(url)) return { ok: false, error: "Serve un indirizzo https raggiungibile da internet." };
  const db = await getStampeDb();
  let g = db.giacenze.find((x) => x.storeId === storeId);
  if (!g) { g = { storeId, quantita: {} }; db.giacenze.push(g); }
  const prima = g.url ?? "";
  g.url = url;
  g.urlAttivo = true;
  // si prova subito: chi lo collega vede se va
  const esito = await leggiQuantitaArredo(db, g);
  await saveStampeDb(db);
  registra(user, { area: "connettori", cosa: prima ? "Lettura Arredo modificata" : "Lettura Arredo collegata", oggetto: nomeAmbito(academyDb, "store", storeId), prima: prima || undefined, dopo: url });
  revalidatePath("/connettori");
  revalidatePath("/stampe/arredo/catalogo");
  return { ok: true, esito };
}

export async function leggiAdessoArredo(storeId: string): Promise<Esito & { esito?: string }> {
  const user = await autorizzato("store", storeId);
  if (!user) return { ok: false, error: NEGATO };
  const db = await getStampeDb();
  const g = db.giacenze.find((x) => x.storeId === storeId);
  if (!g?.url) return { ok: false, error: "Nessun indirizzo per questo punto vendita." };
  const esito = await leggiQuantitaArredo(db, g);
  await saveStampeDb(db);
  revalidatePath("/connettori");
  revalidatePath("/stampe/arredo/catalogo");
  return { ok: esito.startsWith("OK"), error: esito.startsWith("OK") ? undefined : esito, esito };
}

export async function accendiLetturaArredo(storeId: string, acceso: boolean): Promise<Esito> {
  const user = await autorizzato("store", storeId);
  if (!user) return { ok: false, error: NEGATO };
  const db = await getStampeDb();
  const g = db.giacenze.find((x) => x.storeId === storeId);
  if (!g?.url) return { ok: false, error: "Nessun indirizzo per questo punto vendita." };
  g.urlAttivo = acceso;
  await saveStampeDb(db);
  const academyDb = await getDb();
  registra(user, { area: "connettori", cosa: acceso ? "Lettura Arredo accesa" : "Lettura Arredo spenta", oggetto: nomeAmbito(academyDb, "store", storeId) });
  revalidatePath("/connettori");
  return { ok: true };
}

export async function scollegaLetturaArredo(storeId: string): Promise<Esito> {
  const user = await autorizzato("store", storeId);
  if (!user) return { ok: false, error: NEGATO };
  const db = await getStampeDb();
  const g = db.giacenze.find((x) => x.storeId === storeId);
  if (!g?.url) return { ok: false, error: "Nessun indirizzo per questo punto vendita." };
  const prima = g.url;
  g.url = undefined; g.urlAttivo = undefined; g.provatoIl = undefined; g.esito = undefined;
  await saveStampeDb(db);
  const academyDb = await getDb();
  registra(user, { area: "connettori", cosa: "Lettura Arredo scollegata", oggetto: nomeAmbito(academyDb, "store", storeId), prima });
  revalidatePath("/connettori");
  return { ok: true };
}

/* ================== SSO: il sistema dell'insegna fa entrare i suoi ================== */

export async function generaChiaveSso(tenantId: string): Promise<Esito> {
  const user = await autorizzato("tenant", tenantId);
  if (!user) return { ok: false, error: NEGATO };
  const db = await getDb();
  const t = db.tenants.find((x) => x.id === tenantId);
  if (!t) return { ok: false, error: "Insegna non trovata." };
  const nuova = !t.ssoSecret;
  t.ssoSecret = randomBytes(32).toString("base64url");
  t.ssoAttivo = true;
  await saveDb(db);
  registra(user, { area: "connettori", cosa: nuova ? "Chiave SSO creata" : "Chiave SSO rigenerata", oggetto: t.name });
  revalidatePath("/connettori");
  return { ok: true };
}

export async function accendiSso(tenantId: string, acceso: boolean): Promise<Esito> {
  const user = await autorizzato("tenant", tenantId);
  if (!user) return { ok: false, error: NEGATO };
  const db = await getDb();
  const t = db.tenants.find((x) => x.id === tenantId);
  if (!t?.ssoSecret) return { ok: false, error: "Questa insegna non ha una chiave SSO." };
  t.ssoAttivo = acceso;
  await saveDb(db);
  registra(user, { area: "connettori", cosa: acceso ? "SSO acceso" : "SSO spento", oggetto: t.name });
  revalidatePath("/connettori");
  return { ok: true };
}

export async function togliChiaveSso(tenantId: string): Promise<Esito> {
  const user = await autorizzato("tenant", tenantId);
  if (!user) return { ok: false, error: NEGATO };
  const db = await getDb();
  const t = db.tenants.find((x) => x.id === tenantId);
  if (!t?.ssoSecret) return { ok: false, error: "Questa insegna non ha una chiave SSO." };
  t.ssoSecret = undefined;
  t.ssoAttivo = undefined;
  await saveDb(db);
  registra(user, { area: "connettori", cosa: "Chiave SSO tolta", oggetto: t.name });
  revalidatePath("/connettori");
  return { ok: true };
}

/** Il punto vendita in cui finiscono i collaboratori creati dall'SSO dell'insegna (vuoto = solo l'insegna). */
export async function salvaPvSso(tenantId: string, fd: FormData): Promise<Esito> {
  const user = await autorizzato("tenant", tenantId);
  if (!user) return { ok: false, error: NEGATO };
  const db = await getDb();
  const t = db.tenants.find((x) => x.id === tenantId);
  if (!t) return { ok: false, error: "Insegna non trovata." };
  const storeId = String(fd.get("storeId") ?? "");
  if (storeId && !db.stores.some((s) => s.id === storeId && s.tenantId === tenantId)) return { ok: false, error: "Punto vendita non dell'insegna." };
  const prima = t.ssoStoreId;
  t.ssoStoreId = storeId || undefined;
  await saveDb(db);
  const nome = (id?: string) => (id ? db.stores.find((s) => s.id === id)?.name : "") ?? "";
  registra(user, { area: "connettori", cosa: "PV dell'SSO", oggetto: t.name, prima: nome(prima), dopo: nome(t.ssoStoreId) });
  revalidatePath("/connettori");
  return { ok: true };
}
