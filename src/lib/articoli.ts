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
  /** Il modello da cui è nato (circolare, scheda prodotto…). */
  modelloId?: string;
  /** Ultima modifica sostanziale (testo o allegati) dopo la pubblicazione. */
  aggiornato?: string;
  /** Com'era prima di ogni modifica sostanziale: testo e allegati di allora. */
  versioni?: VersioneArticolo[];
}

export interface VersioneArticolo {
  data: string;
  autoreNome: string;
  titolo: string;
  testo: string;
  allegati: Allegato[];
}

/**
 * Modello di articolo: categoria, scheletro del testo, destinatari e istruzioni
 * per l'AI già pronti. "Circolare", "Scheda prodotto", "Procedura".
 */
export interface ModelloArticolo {
  id: string;
  nome: string;
  emoji?: string;
  categoriaId?: string;
  /** HTML di partenza dell'editor. */
  testo: string;
  /** Come deve scrivere l'AI per questo tipo di articolo. */
  istruzioniAi?: string;
  destinatari?: Destinatari;
}

/** Un'email letta dalla casella: cosa ne è stato. */
export interface VoceRegistroEmail {
  data: string;
  da: string;
  oggetto: string;
  esito: "pubblicato" | "bozza" | "rifiutato" | "errore";
  nota?: string;
  articoloId?: string;
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
  /**
   * La casella letta via IMAP (Zoho, Gmail…): la imposta solo l'amministratore
   * di sistema. La password è cifrata e non torna mai al browser.
   */
  imap?: { host: string; porta: number; utente: string; passwordCifrata?: string; cartella: string };
  ultimoControllo?: string;
  ultimoErrore?: string;
  /** Un giro alla volta: chi trova questo segno recente non riparte. */
  inCorso?: string;
  /** Message-ID già lette, per non importare due volte (le ultime 500). */
  visti?: string[];
  registro?: VoceRegistroEmail[];
}

export interface ArticoliDB {
  articoli: Articolo[];
  categorie: Categoria[];
  accesso: Destinatari;
  pubblicatori: Destinatari;
  gestori: Destinatari;
  newsletter: Newsletter;
  email: EmailIngresso;
  modelli: ModelloArticolo[];
}

/** I modelli di partenza: si creano la prima volta, poi si correggono dalla Gestione. */
const MODELLI_INIZIALI: ModelloArticolo[] = [
  {
    id: "mod_circolare", nome: "Circolare", emoji: "📣",
    testo: "<h3>Cosa cambia</h3><p></p><h3>Da quando</h3><p></p><h3>Cosa fare in negozio</h3><ul><li></li></ul><p><b>Riferimento:</b> </p>",
    istruzioniAi: "È una circolare: di' subito cosa cambia, da quando vale e cosa deve fare il personale in negozio. Chiudi con il referente se c'è.",
  },
  {
    id: "mod_scheda", nome: "Scheda prodotto", emoji: "🏷️",
    testo: "<h3>Il prodotto</h3><p></p><h3>Punti di forza da dire al cliente</h3><ul><li></li></ul><h3>Come si usa</h3><p></p>",
    istruzioniAi: "È una scheda prodotto per il venditore: cos'è, a chi si consiglia, 3-4 argomenti di vendita in elenco, come si usa. Riporta prezzi e formati se ci sono.",
  },
  {
    id: "mod_procedura", nome: "Procedura", emoji: "🧭",
    testo: "<h3>Quando si applica</h3><p></p><h3>Passo per passo</h3><ol><li></li></ol><h3>Attenzione a</h3><ul><li></li></ul>",
    istruzioniAi: "È una procedura operativa: quando si applica, i passi numerati nell'ordine in cui si fanno, gli errori da evitare.",
  },
];

const VUOTO: ArticoliDB = {
  articoli: [],
  categorie: [],
  accesso: { tutti: true },
  pubblicatori: { ruoli: ["system_admin", "group_admin", "store_admin"] },
  gestori: {},
  newsletter: { attiva: false, ogni: "settimana", minimo: 1, iscritti: [] },
  email: { attiva: false, sconosciuti: "rifiuta" },
  modelli: MODELLI_INIZIALI,
};

export async function getArticoliDb(): Promise<ArticoliDB> {
  const db = await readDomain<Partial<ArticoliDB> | null>("articoli", null);
  const out: ArticoliDB = { ...VUOTO, ...(db ?? {}) };
  out.articoli ??= [];
  out.categorie ??= [];
  out.newsletter = { ...VUOTO.newsletter, ...(out.newsletter ?? {}) };
  out.email = { ...VUOTO.email, ...(out.email ?? {}) };
  out.modelli ??= MODELLI_INIZIALI.map((m) => ({ ...m }));
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
/** Pubblicato e con la data di uscita già arrivata (i programmati aspettano la loro ora). */
export function uscito(a: Articolo, oggi = new Date()): boolean {
  return a.stato === "pubblicato" && !!a.pubblicato && new Date(a.pubblicato) <= oggi;
}

/** Scaduto: passa in archivio, fuori dall'elenco. */
export function scaduto(a: Articolo, oggi = new Date()): boolean {
  return !!a.scadenza && new Date(`${a.scadenza}T23:59:59`) < oggi;
}

/** La persona rientra fra chi lo vede (a prescindere da uscita e scadenza). */
export function destinatarioDi(user: User, a: Articolo, db: ArticoliDB): boolean {
  return vedeArticoli(user, db) && (destinatariVuoti(a.destinatari) || corrisponde(user, a.destinatari));
}

export function articoloPer(user: User, a: Articolo, db: ArticoliDB, oggi = new Date()): boolean {
  return uscito(a, oggi) && !scaduto(a, oggi) && destinatarioDi(user, a, db);
}

/** L'archivio: gli articoli scaduti che la persona avrebbe visto, dal più recente. */
export function articoliArchivio(user: User, db: ArticoliDB): Articolo[] {
  const oggi = new Date();
  return db.articoli
    .filter((a) => uscito(a, oggi) && scaduto(a, oggi) && destinatarioDi(user, a, db))
    .sort((a, b) => (b.pubblicato ?? b.creato).localeCompare(a.pubblicato ?? a.creato));
}

/** Programmati: pubblicati con la data di uscita nel futuro. */
export function programmato(a: Articolo, oggi = new Date()): boolean {
  return a.stato === "pubblicato" && !!a.pubblicato && new Date(a.pubblicato) > oggi;
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

/**
 * "2026-10-01T08:00" scritto da una persona in Italia → istante vero. Il
 * server gira in UTC: senza questo conto un articolo programmato alle 8
 * usciva alle 10 d'estate e alle 9 d'inverno.
 */
export function oraRomaInIso(locale: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(locale);
  if (!m) return undefined;
  const [, a, me, g, h, mi] = m.map(Number) as unknown as number[];
  const comeUtc = Date.UTC(a, me - 1, g, h, mi);
  // quanto è avanti Roma rispetto a UTC in quel momento (1 o 2 ore)
  const parti = new Intl.DateTimeFormat("en-GB", {
    timeZone: FUSO_ARTICOLI, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(comeUtc));
  const v = (t: string) => Number(parti.find((p) => p.type === t)?.value);
  const romaComeUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour") % 24, v("minute"));
  return new Date(comeUtc - (romaComeUtc - comeUtc)).toISOString();
}

/** L'istante in ora italiana, nel formato del campo datetime-local. */
export function isoInOraRoma(iso?: string): string {
  if (!iso) return "";
  const parti = new Intl.DateTimeFormat("en-GB", {
    timeZone: FUSO_ARTICOLI, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const v = (t: string) => parti.find((p) => p.type === t)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")}T${v("hour") === "24" ? "00" : v("hour")}:${v("minute")}`;
}

export function dataOraItaliana(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.toLocaleDateString("it-IT", { day: "numeric", month: "long", timeZone: FUSO_ARTICOLI })} alle ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: FUSO_ARTICOLI })}`;
}

export function dataItaliana(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: FUSO_ARTICOLI });
}
