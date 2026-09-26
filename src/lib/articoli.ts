import { readDomain, writeDomain } from "./supabase";
import type { DB, Role, User } from "./types";

/*
 * Articoli informativi: comunicazioni, circolari, schede tecniche, novità.
 * Vivono in un blob loro ("articoli"), separato da formazione e cartelli.
 *
 * Tre livelli di permesso, tutti espressi come "destinatari" (ruoli, insegne,
 * punti vendita, reparti, gruppi, singole persone):
 *  - chi VEDE l'area (accesso);
 *  - chi PUBBLICA (pubblicatori): scrive articoli e li vede tutti, anche in bozza;
 *  - chi GESTISCE (gestori): categorie, permessi, newsletter, email in ingresso.
 * L'amministratore di sistema può tutto. Ogni articolo, in più, può restringere
 * chi lo vede fra quelli che hanno accesso.
 */

export interface Destinatari {
  tutti?: boolean;
  ruoli?: Role[];
  tenantIds?: string[];
  storeIds?: string[];
  departmentIds?: string[];
  groupIds?: string[];
  userIds?: string[];
}

export interface Allegato {
  nome: string;
  url: string;
  tipo: string; // MIME
  dimensione: number;
}

export interface LinkEsterno {
  url: string;
  titolo?: string;
}

export interface Articolo {
  id: string;
  titolo: string;
  /** HTML ripulito (solo i tag dell'editor). */
  testo: string;
  categoriaId?: string;
  allegati: Allegato[];
  link: LinkEsterno[];
  /** Immagine in testa alla scheda: la prima immagine allegata, se c'è. */
  copertina?: string;
  autoreId?: string;
  autoreNome: string;
  /** Da dove è arrivato: scritto sul sito o spedito per email. */
  origine: "web" | "email";
  mittenteEmail?: string;
  creato: string;
  pubblicato?: string;
  stato: "bozza" | "pubblicato";
  /** Vuoto = tutti quelli che hanno accesso all'area. */
  destinatari: Destinatari;
  inEvidenza?: boolean;
  /** Dopo questa data l'articolo sparisce dall'elenco (resta in archivio per chi pubblica). */
  scadenza?: string;
  /** Chi l'ha aperto, e quando. */
  letture: Record<string, string>;
  /** Gli articoli già inclusi in una newsletter non si rimandano. */
  inNewsletter?: string;
}

export interface Categoria {
  id: string;
  nome: string;
  emoji?: string;
}

export interface Newsletter {
  attiva: boolean;
  ogni: "giorno" | "settimana" | "mese";
  /** Si manda solo se ci sono almeno tanti articoli nuovi. */
  minimo: number;
  oggetto?: string;
  ultimoInvio?: string;
  iscritti: string[];
}

export interface EmailIngresso {
  attiva: boolean;
  /** L'indirizzo a cui spedire, scritto per chi pubblica (la consegna la fa il servizio di posta). */
  indirizzo?: string;
  /** Email da mittenti non riconosciuti: rifiutate, o messe in bozza da rivedere. */
  sconosciuti: "rifiuta" | "bozza";
}

export interface ArticoliDB {
  articoli: Articolo[];
  categorie: Categoria[];
  accesso: Destinatari;
  pubblicatori: Destinatari;
  gestori: Destinatari;
  newsletter: Newsletter;
  email: EmailIngresso;
}

const VUOTO: ArticoliDB = {
  articoli: [],
  categorie: [],
  accesso: { tutti: true },
  pubblicatori: { ruoli: ["system_admin", "group_admin", "store_admin"] },
  gestori: {},
  newsletter: { attiva: false, ogni: "settimana", minimo: 1, iscritti: [] },
  email: { attiva: false, sconosciuti: "rifiuta" },
};

export async function getArticoliDb(): Promise<ArticoliDB> {
  const db = await readDomain<Partial<ArticoliDB> | null>("articoli", null);
  const out: ArticoliDB = { ...VUOTO, ...(db ?? {}) };
  out.articoli ??= [];
  out.categorie ??= [];
  out.newsletter = { ...VUOTO.newsletter, ...(out.newsletter ?? {}) };
  out.email = { ...VUOTO.email, ...(out.email ?? {}) };
  for (const a of out.articoli) {
    a.allegati ??= [];
    a.link ??= [];
    a.letture ??= {};
    a.destinatari ??= {};
  }
  return out;
}

export async function saveArticoliDb(db: ArticoliDB): Promise<void> {
  await writeDomain("articoli", db);
}

/* ---------- permessi ---------- */

/** Destinatari senza nessuna scelta: vale "nessuna restrizione". */
export function destinatariVuoti(d: Destinatari | undefined): boolean {
  if (!d) return true;
  return !d.tutti && !d.ruoli?.length && !d.tenantIds?.length && !d.storeIds?.length
    && !d.departmentIds?.length && !d.groupIds?.length && !d.userIds?.length;
}

/** La persona rientra nei destinatari? Basta una voce che la riguardi. */
export function corrisponde(user: User, d: Destinatari | undefined): boolean {
  if (!d || d.tutti) return true;
  if (d.userIds?.includes(user.id)) return true;
  if (d.ruoli?.includes(user.role)) return true;
  if (user.tenantId && d.tenantIds?.includes(user.tenantId)) return true;
  if (user.storeId && d.storeIds?.includes(user.storeId)) return true;
  if (user.departmentId && d.departmentIds?.includes(user.departmentId)) return true;
  if (user.groupIds?.some((g) => d.groupIds?.includes(g))) return true;
  return false;
}

export function gestisceArticoli(user: User, db: ArticoliDB): boolean {
  if (user.active === false) return false;
  return user.role === "system_admin" || (!destinatariVuoti(db.gestori) && corrisponde(user, db.gestori));
}

export function pubblicaArticoli(user: User, db: ArticoliDB): boolean {
  if (user.active === false) return false;
  return gestisceArticoli(user, db) || (!destinatariVuoti(db.pubblicatori) && corrisponde(user, db.pubblicatori));
}

/** Entra nell'area: chi è fra i destinatari dell'accesso, chi pubblica, chi gestisce. */
export function vedeArticoli(user: User, db: ArticoliDB): boolean {
  if (user.active === false) return false;
  return pubblicaArticoli(user, db) || (destinatariVuoti(db.accesso) ? true : corrisponde(user, db.accesso));
}

/** L'articolo è per questa persona? Pubblicato, non scaduto, e nei suoi destinatari. */
export function articoloPer(user: User, a: Articolo, db: ArticoliDB, oggi = new Date()): boolean {
  if (!vedeArticoli(user, db)) return false;
  if (a.stato !== "pubblicato") return false;
  if (a.scadenza && new Date(`${a.scadenza}T23:59:59`) < oggi) return false;
  return destinatariVuoti(a.destinatari) || corrisponde(user, a.destinatari);
}

/** Lo può modificare: chi gestisce, o chi l'ha scritto. */
export function modificaArticolo(user: User, a: Articolo, db: ArticoliDB): boolean {
  return gestisceArticoli(user, db) || (pubblicaArticoli(user, db) && a.autoreId === user.id);
}

/** Gli articoli che la persona vede in elenco, dal più recente; quelli in evidenza prima. */
export function articoliVisibili(user: User, db: ArticoliDB): Articolo[] {
  const oggi = new Date();
  return db.articoli
    .filter((a) => articoloPer(user, a, db, oggi))
    .sort((a, b) => Number(!!b.inEvidenza) - Number(!!a.inEvidenza) || (b.pubblicato ?? b.creato).localeCompare(a.pubblicato ?? a.creato));
}

/* ---------- destinatari in chiaro ---------- */

/** Come si leggono i destinatari nelle schede ("Rosàflor, Capi reparto, gruppo Sicurezza"). */
export function testoDestinatari(d: Destinatari | undefined, academy: DB, etichetteRuoli: Record<Role, string>): string {
  if (destinatariVuoti(d) || d?.tutti) return "tutti";
  const parti: string[] = [];
  for (const r of d?.ruoli ?? []) parti.push(etichetteRuoli[r] ?? r);
  for (const id of d?.tenantIds ?? []) parti.push(academy.tenants.find((t) => t.id === id)?.name ?? id);
  for (const id of d?.storeIds ?? []) parti.push(academy.stores.find((s) => s.id === id)?.name ?? id);
  for (const id of d?.departmentIds ?? []) parti.push(`reparto ${academy.departments.find((x) => x.id === id)?.name ?? id}`);
  for (const id of d?.groupIds ?? []) parti.push(`gruppo ${academy.groups.find((g) => g.id === id)?.name ?? id}`);
  for (const id of d?.userIds ?? []) {
    const u = academy.users.find((x) => x.id === id);
    parti.push(u ? `${u.firstName} ${u.lastName}` : id);
  }
  return parti.join(", ");
}

/** Legge i destinatari da un modulo (campi dest_ruoli, dest_tenantIds, … a scelta multipla). */
export function destinatariDaModulo(fd: FormData, prefisso = "dest"): Destinatari {
  const lista = (k: string) => (fd.getAll(`${prefisso}_${k}`) as string[]).filter(Boolean);
  const d: Destinatari = {};
  if (fd.get(`${prefisso}_tutti`) === "1") d.tutti = true;
  const ruoli = lista("ruoli") as Role[];
  if (ruoli.length) d.ruoli = ruoli;
  for (const k of ["tenantIds", "storeIds", "departmentIds", "groupIds", "userIds"] as const) {
    const v = lista(k);
    if (v.length) d[k] = v;
  }
  return d;
}

/* ---------- testo ---------- */

/*
 * L'editor produce HTML: si tengono solo i tag della formattazione e, sui
 * link, solo l'indirizzo (http, https, mailto). Tutto il resto, script
 * compresi, sparisce. Le email arrivano con HTML di ogni genere: passa da qui.
 */
const TAG_AMMESSI = new Set(["p", "br", "b", "strong", "i", "em", "u", "s", "ul", "ol", "li", "h2", "h3", "h4", "a", "blockquote", "hr", "div", "span"]);

export function ripulisciHtml(html: string): string {
  if (!html) return "";
  // via blocchi interi che non hanno niente da dire sul sito
  let s = html.replace(/<(script|style|head|title|iframe|object|embed|svg|math)[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (tutto, nomeGrezzo: string, attrs: string) => {
    const nome = nomeGrezzo.toLowerCase();
    const chiusura = tutto.startsWith("</");
    if (!TAG_AMMESSI.has(nome)) return "";
    if (chiusura) return `</${nome}>`;
    if (nome === "a") {
      const m = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      const href = (m?.[2] ?? m?.[3] ?? m?.[4] ?? "").trim();
      if (/^(https?:|mailto:)/i.test(href)) {
        return `<a href="${href.replace(/"/g, "&quot;")}" target="_blank" rel="noopener noreferrer">`;
      }
      return "<span>";
    }
    return `<${nome}>`;
  });
  // un "<a" trasformato in span deve chiudersi come span
  s = s.replace(/<\/a>/gi, (m, offset: number) => {
    const prima = s.lastIndexOf("<a ", offset);
    const primaSpan = s.lastIndexOf("<span>", offset);
    return primaSpan > prima ? "</span>" : m;
  });
  return s.trim();
}

/** Solo il testo, per anteprime e newsletter. */
export function soloTesto(html: string, max = 220): string {
  const t = html.replace(/<br\s*\/?>/gi, " ").replace(/<\/(p|li|h[2-4]|div)>/gi, " ").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : t;
}

/** Testo semplice (email) → paragrafi HTML, con gli indirizzi web cliccabili. */
export function testoInHtml(testo: string): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return testo.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const conLink = esc(p).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
    return `<p>${conLink.replace(/\n/g, "<br>")}</p>`;
  }).join("\n");
}

/** Gli indirizzi web dentro a un testo: diventano i link dell'articolo. */
export function linkNelTesto(testo: string): LinkEsterno[] {
  const trovati = new Set(testo.match(/https?:\/\/[^\s<>")]+/g) ?? []);
  return [...trovati].map((url) => ({ url }));
}

/* ---------- newsletter ---------- */

/** Tocca mandarla? Dipende dalla cadenza e dall'ultimo invio. */
export function newsletterDovuta(n: Newsletter, adesso = new Date()): boolean {
  if (!n.attiva) return false;
  if (!n.ultimoInvio) return true;
  const passati = (adesso.getTime() - new Date(n.ultimoInvio).getTime()) / 86_400_000;
  // un po' meno del periodo pieno: il cron passa una volta al giorno e non deve slittare
  return passati >= (n.ogni === "giorno" ? 0.9 : n.ogni === "settimana" ? 6.9 : 29.9);
}

export const FUSO_ARTICOLI = "Europe/Rome";

export function dataItaliana(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: FUSO_ARTICOLI });
}
