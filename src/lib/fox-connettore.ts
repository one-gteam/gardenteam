import { randomBytes } from "crypto";
import { readDomain, writeDomain } from "./supabase";
import { segretoUguale } from "./auth";

/*
 * Connettore «Programma Fox»: per i garden che usano il gestionale Fox2000
 * (Areabyte) ma non hanno Linfa. Un programmino Windows senza installazione
 * (GTOne-Fox.exe) legge in sola lettura la cartella `db` del gestionale
 * (ARTICOLI.CSV e BARCODE.CSV, che Fox riscrive da solo) e manda a GT One
 * giacenza e prezzo di vendita degli articoli dello Zoo, per l'insegna o il
 * PV a cui la chiave appartiene. Il prezzo d'acquisto non esce mai dal PC.
 *
 * Due archivi:
 *  - «connettori_fox»: le chiavi (una per insegna/PV), accese o spente, con
 *    l'ultimo invio;
 *  - «giacenze_fox_<tipo>_<id>»: l'ultima fotografia mandata, per EAN.
 */

export interface ConnettoreFox {
  scopeType: "tenant" | "store";
  scopeId: string;
  chiave: string;
  attivo?: boolean;
  creatoIl: string;
  /** Ultimo invio ricevuto: quando, quante righe, e la data dei file letti. */
  ultimoInvio?: string;
  righe?: number;
  fileAl?: string;
  versione?: string;
}

export interface GiacenzaFox { g: number; p: number; c: string }
export interface FotografiaFox { aggiornatoIl: string; fileAl?: string; righe: Record<string, GiacenzaFox> }

const DOMINIO = "connettori_fox";
export const dominioFotografia = (tipo: string, id: string) => `giacenze_fox_${tipo}_${id}`;

export async function leggiConnettoriFox(): Promise<ConnettoreFox[]> {
  return (await readDomain<{ voci: ConnettoreFox[] }>(DOMINIO, { voci: [] })).voci ?? [];
}

export async function scriviConnettoriFox(voci: ConnettoreFox[]): Promise<void> {
  await writeDomain(DOMINIO, { voci });
}

export const nuovaChiaveFox = () => `gtf_${randomBytes(24).toString("base64url")}`;

/** Il connettore di una chiave (acceso), o undefined. */
export async function connettoreDaChiave(chiave: string | null): Promise<ConnettoreFox | undefined> {
  if (!chiave || !/^gtf_[A-Za-z0-9_-]{20,64}$/.test(chiave)) return undefined;
  return (await leggiConnettoriFox()).find((c) => c.attivo !== false && segretoUguale(chiave, c.chiave));
}

/** La fotografia più vicina all'ambito (il PV, altrimenti la sua insegna), se il connettore è acceso. */
export async function fotografiaFoxPer(catena: { type: string; id: string }[]): Promise<FotografiaFox | undefined> {
  const connettori = await leggiConnettoriFox();
  for (const s of catena) {
    if (s.type === "system") continue;
    const c = connettori.find((x) => x.scopeType === s.type && x.scopeId === s.id && x.attivo !== false);
    if (!c) continue;
    const f = await readDomain<FotografiaFox | null>(dominioFotografia(s.type, s.id), null);
    if (f?.righe) return f;
  }
  return undefined;
}
