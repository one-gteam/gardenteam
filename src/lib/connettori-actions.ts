"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "./auth";
import { getDb } from "./db";
import { getZooDb, saveZooDb, campagnaInLavorazione, campagnaInCorso, type ZooScopeGiacenze } from "./zoo";
import { getStampeDb, saveStampeDb } from "./stampe";
import { registra } from "./registro";
import type { DB } from "./types";

/*
 * Area Connettori: i collegamenti fra GT One e i gestionali delle insegne e
 * dei punti vendita, tutti in una pagina, solo per l'amministratore di sistema.
 * Due famiglie:
 *  - Zoo, «interroga»: GT One chiede al gestionale giacenze e prezzi per EAN
 *    (per Rosàflor: Linfa). Si accende, si spegne, si prova.
 *  - Arredo, «riceve»: il gestionale del PV manda le quantità del catalogo
 *    online con una chiave (Authorization: Bearer). Si crea, si rigenera, si spegne.
 */

type Esito = { ok: boolean; error?: string };
type TipoAmbito = "tenant" | "store";

async function amministratore() {
  const u = await getCurrentUser();
  return u && u.role === "system_admin" ? u : null;
}

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
  const user = await amministratore();
  if (!user) return { ok: false, error: "Solo l'amministratore di sistema." };
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
  const user = await amministratore();
  if (!user) return { ok: false, error: "Solo l'amministratore di sistema." };
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
  const user = await amministratore();
  if (!user) return { ok: false, error: "Solo l'amministratore di sistema." };
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
  const user = await amministratore();
  if (!user) return { ok: false, error: "Solo l'amministratore di sistema." };
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

/* ================== Arredo: quantità del catalogo, il gestionale le manda ================== */

export async function creaChiaveArredo(storeId: string): Promise<Esito> {
  const user = await amministratore();
  if (!user) return { ok: false, error: "Solo l'amministratore di sistema." };
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
  const user = await amministratore();
  if (!user) return { ok: false, error: "Solo l'amministratore di sistema." };
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
  const user = await amministratore();
  if (!user) return { ok: false, error: "Solo l'amministratore di sistema." };
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
