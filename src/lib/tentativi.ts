import { createHash } from "crypto";
import { headers } from "next/headers";
import { readDomain, writeDomain } from "./supabase";

/*
 * Limite ai tentativi sbagliati (password, parola segreta, attivazione).
 * Il sito gira su più istanze Vercel, quindi un contatore in memoria non basta:
 * i tentativi stanno in un blob a parte di app_data, non in quello "academy",
 * così una raffica di errori non riscrive mai il database degli utenti.
 * Le chiavi sono impronte sha256: nel blob non finiscono né email né indirizzi IP.
 */

const DOMINIO = "tentativi";

type Registro = Record<string, number[]>;

export interface Regola {
  chiave: string;
  massimo: number;
  /** Finestra in minuti: contano solo gli errori più recenti di così. */
  minuti: number;
}

function impronta(chiave: string): string {
  return createHash("sha256").update(chiave).digest("base64url").slice(0, 32);
}

/** L'indirizzo di chi chiama, come lo passa Vercel. */
export async function ipChiamante(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-real-ip") ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "sconosciuto"
  );
}

async function leggi(): Promise<Registro> {
  try {
    return (await readDomain<Registro>(DOMINIO, {})) ?? {};
  } catch {
    return {};
  }
}

/** Minuti di attesa ancora da fare (0 = si può provare). */
export async function attesaMinuti(regole: Regola[]): Promise<number> {
  const registro = await leggi();
  const ora = Date.now();
  let attesa = 0;
  for (const r of regole) {
    const finestra = r.minuti * 60_000;
    const recenti = (registro[impronta(r.chiave)] ?? []).filter((t) => ora - t < finestra);
    if (recenti.length >= r.massimo) {
      // si riapre quando il più vecchio degli errori che fanno scattare il blocco esce dalla finestra
      const sblocco = recenti.sort((a, b) => b - a)[r.massimo - 1] + finestra;
      attesa = Math.max(attesa, Math.ceil((sblocco - ora) / 60_000));
    }
  }
  return attesa;
}

async function scrivi(cambia: (registro: Registro, ora: number) => void) {
  const registro = await leggi();
  const ora = Date.now();
  cambia(registro, ora);
  // pulizia: via tutto quello che ha più di un giorno
  for (const [k, tempi] of Object.entries(registro)) {
    const vivi = tempi.filter((t) => ora - t < 24 * 3_600_000);
    if (vivi.length === 0) delete registro[k];
    else registro[k] = vivi.slice(-100);
  }
  try {
    await writeDomain(DOMINIO, registro);
  } catch {
    // se il contatore non si salva, l'accesso non deve rompersi
  }
}

export async function segnaErrore(regole: Regola[]) {
  await scrivi((registro, ora) => {
    for (const r of regole) {
      const k = impronta(r.chiave);
      registro[k] = [...(registro[k] ?? []), ora];
    }
  });
}

export async function azzera(chiavi: string[]) {
  const registro = await leggi();
  if (!chiavi.some((c) => registro[impronta(c)])) return;
  await scrivi((reg) => {
    for (const c of chiavi) delete reg[impronta(c)];
  });
}
