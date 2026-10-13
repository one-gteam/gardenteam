import { createHash } from "crypto";
import { headers } from "next/headers";
import { supabase, APP_DATA_TABLE } from "./supabase";

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

/*
 * Letture e scritture dirette sulla riga «tentativi», con il controllo di
 * updated_at: se due richieste scrivono insieme, una delle due rilegge e
 * riprova. Prima si leggeva, si controllava e si scriveva dopo: tante
 * richieste lanciate insieme passavano tutte il controllo prima che il primo
 * errore fosse scritto, e il limite si poteva superare di molto.
 */
async function leggiRiga(): Promise<{ registro: Registro; versione?: string }> {
  try {
    const { data } = await supabase().from(APP_DATA_TABLE).select("data, updated_at").eq("domain", DOMINIO).maybeSingle();
    return { registro: (data?.data as Registro) ?? {}, versione: data?.updated_at as string | undefined };
  } catch {
    return { registro: {} };
  }
}

async function leggi(): Promise<Registro> {
  return (await leggiRiga()).registro;
}

function pulisci(registro: Registro, ora: number) {
  // via tutto quello che ha più di un giorno
  for (const [k, tempi] of Object.entries(registro)) {
    const vivi = tempi.filter((t) => ora - t < 24 * 3_600_000);
    if (vivi.length === 0) delete registro[k];
    else registro[k] = vivi.slice(-100);
  }
}

/** Cambia il registro in modo atomico; `cambia` può rinunciare restituendo false. Fallisce aperto: l'accesso non deve rompersi. */
async function aggiorna(cambia: (registro: Registro, ora: number) => boolean | void): Promise<void> {
  for (let tentativo = 0; tentativo < 10; tentativo++) {
    if (tentativo) await new Promise((r) => setTimeout(r, 30 + Math.random() * 120 * tentativo));
    const { registro, versione } = await leggiRiga();
    const ora = Date.now();
    if (cambia(registro, ora) === false) return;
    pulisci(registro, ora);
    const adesso = new Date().toISOString();
    try {
      if (!versione) {
        const { error } = await supabase().from(APP_DATA_TABLE).insert({ domain: DOMINIO, data: registro, updated_at: adesso });
        if (!error) return;
      } else {
        const { data } = await supabase().from(APP_DATA_TABLE).update({ data: registro, updated_at: adesso })
          .eq("domain", DOMINIO).eq("updated_at", versione).select("updated_at");
        if (data && data.length) return;
      }
    } catch { return; }
  }
}

function attesaDa(registro: Registro, regole: Regola[], ora: number): number {
  let attesa = 0;
  for (const r of regole) {
    const finestra = r.minuti * 60_000;
    const recenti = (registro[impronta(r.chiave)] ?? []).filter((t) => ora - t < finestra);
    if (recenti.length >= r.massimo) {
      // si riapre quando il più vecchio dei tentativi che fanno scattare il blocco esce dalla finestra
      const sblocco = recenti.sort((a, b) => b - a)[r.massimo - 1] + finestra;
      attesa = Math.max(attesa, Math.ceil((sblocco - ora) / 60_000));
    }
  }
  return attesa;
}

/**
 * Controlla e conta in un colpo solo: se c'è da aspettare non conta niente e
 * restituisce i minuti; altrimenti segna il tentativo e restituisce 0. Da usare
 * al posto di attesaMinuti + segnaErrore, che fra le due chiamate lasciavano
 * passare le raffiche.
 */
export async function prenota(regole: Regola[]): Promise<number> {
  let attesa = 0;
  await aggiorna((registro, ora) => {
    attesa = attesaDa(registro, regole, ora);
    if (attesa > 0) return false;
    for (const r of regole) { const k = impronta(r.chiave); registro[k] = [...(registro[k] ?? []), ora]; }
  });
  return attesa;
}

/** Minuti di attesa ancora da fare (0 = si può provare). */
export async function attesaMinuti(regole: Regola[]): Promise<number> {
  return attesaDa(await leggi(), regole, Date.now());
}

export async function segnaErrore(regole: Regola[]) {
  await aggiorna((registro, ora) => {
    for (const r of regole) {
      const k = impronta(r.chiave);
      registro[k] = [...(registro[k] ?? []), ora];
    }
  });
}

export async function azzera(chiavi: string[]) {
  const registro = await leggi();
  if (!chiavi.some((c) => registro[impronta(c)])) return;
  await aggiorna((reg) => {
    for (const c of chiavi) delete reg[impronta(c)];
  });
}
