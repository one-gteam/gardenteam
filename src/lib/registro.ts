import { after } from "next/server";
import { supabase, APP_DATA_TABLE } from "./supabase";

/*
 * Registro delle modifiche: chi ha cambiato cosa, quando, con il valore di
 * prima e quello di dopo. Una riga di app_data per mese («registro_2026_10»),
 * così nessuna scrittura porta con sé anni di storia. Si scrive dopo aver
 * risposto (after): chi modifica non aspetta il registro, e se il registro
 * non riesce a scrivere la modifica vera resta comunque salvata.
 */

export type AreaRegistro = "zoo" | "arredo" | "academy" | "utenti" | "connettori";

/**
 * Dove sta il valore cambiato, per poterlo rimettere com'era. Solo le
 * modifiche di un campo hanno un riferimento: import, cancellazioni e corsi no.
 * vPrima/vDopo = valori interi quando quelli da mostrare sono tagliati.
 */
export type RifRegistro = { vPrima?: string; vDopo?: string } & (
  | { tipo: "zoo-padre-testo"; id: string; campo: "nome" | "descVolantino" | "descCartello"; scope: string }
  | { tipo: "zoo-animale"; id: string }
  | { tipo: "zoo-tipologia"; id: string; padre: boolean }
  | { tipo: "zoo-offerta"; id: string; campo: "descrizione" | "prezzoPromo" | "prezzoListino" | "focus" | "label" | "paginaId" | "meccanica" | "condizioni" | "prezzoUnita" }
  | { tipo: "zoo-articolo"; id: string }
  | { tipo: "zoo-foto"; padre?: string; articoli: string[] }
  | { tipo: "zoo-deadline"; id: string }
  | { tipo: "arredo-campo"; id: string; campo: string; scope: string }
  | { tipo: "utente-ruolo"; id: string; prima: string; dopo: string }
  | { tipo: "utente-aree"; id: string; prima: string[]; dopo: string[] }
  | { tipo: "utente-attivo"; id: string; prima: boolean }
);

export interface VoceRegistro {
  /** Dal 14/10/2026: serve per ripristinare (le voci più vecchie non ce l'hanno). */
  id?: string;
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
  rif?: RifRegistro;
  /** Rimessa com'era dall'amministratore di sistema. */
  ripristinataIl?: string;
  ripristinataDa?: string;
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
  voce: Omit<VoceRegistro, "il" | "chi" | "chiNome" | "id" | "ripristinataIl" | "ripristinataDa">,
): void {
  if (voce.prima !== undefined && voce.dopo !== undefined && voce.prima === voce.dopo) return; // nessun cambiamento vero
  let rif = voce.rif;
  // il valore intero serve per ripristinare un testo lungo (quello mostrato è tagliato)
  if (rif && ((voce.prima?.length ?? 0) > MAX_TESTO || (voce.dopo?.length ?? 0) > MAX_TESTO)) {
    rif = { ...rif, vPrima: voce.prima?.slice(0, 5000), vDopo: voce.dopo?.slice(0, 5000) };
  }
  const v: VoceRegistro = {
    ...voce, id: `r_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    il: new Date().toISOString(), chi: user.id, chiNome: `${user.firstName} ${user.lastName}`.trim(),
    oggetto: taglia(voce.oggetto) ?? "", prima: taglia(voce.prima), dopo: taglia(voce.dopo), rif,
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

/** Il mese (dominio) in cui cercare una voce: il suo e quello dopo, se è stata scritta a cavallo. */
function dominiDi(il: string): string[] {
  const d = new Date(il);
  return [dominioRegistro(d), dominioRegistro(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)))];
}

/** Una voce per id (il = la sua data, per sapere in che mese cercarla). */
export async function trovaVoce(id: string, il: string): Promise<VoceRegistro | undefined> {
  const { data } = await supabase().from(APP_DATA_TABLE).select("data").in("domain", dominiDi(il));
  return (data ?? []).flatMap((r) => ((r.data as { voci?: VoceRegistro[] })?.voci ?? [])).find((v) => v.id === id);
}

/** Segna una voce come ripristinata (scrittura condizionata, come le altre). */
export async function segnaRipristinata(id: string, il: string, chiNome: string): Promise<void> {
  for (const dominio of dominiDi(il)) {
    for (let tentativo = 0; tentativo < 8; tentativo++) {
      if (tentativo) await new Promise((r) => setTimeout(r, 50 + Math.random() * 150 * tentativo));
      const { data: riga } = await supabase().from(APP_DATA_TABLE).select("data, updated_at").eq("domain", dominio).maybeSingle();
      const voci = ((riga?.data as { voci?: VoceRegistro[] })?.voci ?? []);
      const v = voci.find((x) => x.id === id);
      if (!riga || !v) break; // non è in questo mese
      v.ripristinataIl = new Date().toISOString();
      v.ripristinataDa = chiNome;
      const { data: scritte } = await supabase().from(APP_DATA_TABLE)
        .update({ data: { voci }, updated_at: new Date().toISOString() })
        .eq("domain", dominio).eq("updated_at", riga.updated_at).select("updated_at");
      if (scritte && scritte.length) return;
    }
  }
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
