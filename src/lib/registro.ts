import { after } from "next/server";
import { supabase, APP_DATA_TABLE } from "./supabase";

/*
 * Registro delle modifiche: chi ha cambiato cosa, quando, con il valore di
 * prima e quello di dopo. Una riga di app_data per mese («registro_2026_10»),
 * così nessuna scrittura porta con sé anni di storia. Si scrive dopo aver
 * risposto (after): chi modifica non aspetta il registro, e se il registro
 * non riesce a scrivere la modifica vera resta comunque salvata.
 */

export type AreaRegistro = "zoo" | "arredo" | "academy" | "utenti";

export interface VoceRegistro {
  il: string;
  chi: string;
  chiNome: string;
  area: AreaRegistro;
  /** Cosa è stato fatto, in parole: «Titolo del padre», «Prezzo dell'offerta», «Import offerte». */
  cosa: string;
  /** Su cosa: il nome del padre, la descrizione dell'offerta, il titolo del corso… */
  oggetto: string;
  prima?: string;
  dopo?: string;
  /** Ambito, se non è il Consorzio: «Flover», «Il Germoglio». */
  ambito?: string;
}

const MAX_TESTO = 400;
let coda: VoceRegistro[] = [];
let programmato = false;
const taglia = (v?: string) => (v === undefined ? undefined : v.length > MAX_TESTO ? `${v.slice(0, MAX_TESTO)}…` : v);

export function dominioRegistro(d = new Date()): string {
  return `registro_${d.toISOString().slice(0, 7).replace("-", "_")}`;
}

async function scriviVoci(voci: VoceRegistro[]): Promise<void> {
  const dominio = dominioRegistro();
  for (let tentativo = 0; tentativo < 12; tentativo++) {
    if (tentativo) await new Promise((r) => setTimeout(r, 50 + Math.random() * 200 * tentativo));
    const { data: riga } = await supabase().from(APP_DATA_TABLE).select("data, updated_at").eq("domain", dominio).maybeSingle();
    const ora = new Date().toISOString();
    if (!riga) {
      const { error } = await supabase().from(APP_DATA_TABLE).insert({ domain: dominio, data: { voci }, updated_at: ora });
      if (!error) return;
      continue; // l'ha creata qualcun altro nel frattempo: si riprova accodando
    }
    const esistenti = ((riga.data as { voci?: VoceRegistro[] })?.voci ?? []);
    const { data: scritte } = await supabase().from(APP_DATA_TABLE)
      .update({ data: { voci: [...esistenti, ...voci] }, updated_at: ora })
      .eq("domain", dominio).eq("updated_at", riga.updated_at).select("updated_at");
    if (scritte && scritte.length) return;
  }
}

/**
 * Annota una modifica. Si chiama dentro un'azione server, dopo aver deciso di
 * salvare: niente da aspettare, niente da gestire se fallisce.
 */
export function registra(
  user: { id: string; firstName: string; lastName: string },
  voce: Omit<VoceRegistro, "il" | "chi" | "chiNome">,
): void {
  if (voce.prima !== undefined && voce.dopo !== undefined && voce.prima === voce.dopo) return; // nessun cambiamento vero
  const v: VoceRegistro = {
    ...voce, il: new Date().toISOString(), chi: user.id, chiNome: `${user.firstName} ${user.lastName}`.trim(),
    oggetto: taglia(voce.oggetto) ?? "", prima: taglia(voce.prima), dopo: taglia(voce.dopo),
  };
  /*
   * Le voci della stessa richiesta (es. 20 persone cancellate insieme) vanno in
   * una scrittura sola: prima ogni voce faceva la sua e, in concorrenza sulla
   * stessa riga del mese, molte andavano perse.
   */
  coda.push(v);
  if (programmato) return;
  programmato = true;
  const lavoro = () => { const tutte = coda; coda = []; programmato = false; return scriviVoci(tutte).catch(() => undefined); };
  try { after(lavoro); } catch { void lavoro(); }
}

/** Le voci dei mesi chiesti (es. ["2026_10", "2026_09"]), dalla più recente. */
export async function leggiRegistro(mesi: string[]): Promise<VoceRegistro[]> {
  const { data } = await supabase().from(APP_DATA_TABLE).select("data").in("domain", mesi.map((m) => `registro_${m}`));
  const tutte = (data ?? []).flatMap((r) => ((r.data as { voci?: VoceRegistro[] })?.voci ?? []));
  return tutte.sort((a, b) => b.il.localeCompare(a.il));
}

/** Gli ultimi n mesi nel formato dei domini («2026_10»). */
export function ultimiMesi(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(x.toISOString().slice(0, 7).replace("-", "_"));
  }
  return out;
}
