import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { revalidatePath } from "next/cache";
import { decifra } from "./auth";
import { getDb } from "./db";
import { uploadPublicFile } from "./supabase";
import {
  getArticoliDb, saveArticoliDb, pubblicaArticoli, ripulisciHtml, testoInHtml, linkNelTesto,
  type Allegato, type ArticoliDB, type VoceRegistroEmail,
} from "./articoli";
import type { DB } from "./types";

/*
 * Articoli spediti per email: oggetto = titolo, corpo = descrizione, PDF e
 * immagini = allegati, indirizzi web nel testo = link. Il mittente dev'essere
 * una persona che può pubblicare; gli altri si rifiutano o vanno in bozza.
 *
 * Due strade portano qui: la casella letta via IMAP (Zoho) dal giro qui sotto,
 * e l'indirizzo POST /api/articoli/inbound per i servizi che spingono i
 * messaggi da soli.
 */

const MAX_ALLEGATO = 15 * 1024 * 1024;
const TIPI = /^(image\/(jpeg|png|gif|webp)|application\/pdf)$/;

export interface MessaggioIngresso {
  from: string;
  subject: string;
  text?: string;
  html?: string;
  allegati: { nome: string; tipo: string; bytes: Buffer }[];
}

function indirizzo(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim().toLowerCase();
}

/** Crea l'articolo dal messaggio (senza salvare: lo fa chi chiama). */
export async function articoloDaMessaggio(
  db: ArticoliDB, academy: DB, msg: MessaggioIngresso
): Promise<VoceRegistroEmail> {
  const mittente = indirizzo(msg.from);
  const titolo = (msg.subject ?? "").trim();
  const voce: VoceRegistroEmail = { data: new Date().toISOString(), da: mittente, oggetto: titolo || "(senza oggetto)", esito: "rifiutato" };
  if (!mittente || !titolo) return { ...voce, nota: "Manca il mittente o l'oggetto" };

  const autore = academy.users.find((u) => u.email.toLowerCase() === mittente && u.active !== false);
  const puo = autore ? pubblicaArticoli(autore, db) : false;
  if (!puo && db.email.sconosciuti === "rifiuta") return { ...voce, nota: "Mittente non abilitato a pubblicare" };

  const id = `art_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const allegati: Allegato[] = [];
  for (const a of msg.allegati.slice(0, 10)) {
    const tipo = a.tipo.split(";")[0].trim().toLowerCase();
    if (!TIPI.test(tipo) || a.bytes.length === 0 || a.bytes.length > MAX_ALLEGATO) continue;
    const nome = (a.nome || "allegato").split(/[\\/]/).pop()!.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100);
    const url = await uploadPublicFile(`articoli/${id}/${Date.now()}_${nome}`, a.bytes, tipo);
    allegati.push({ nome: a.nome || nome, url, tipo, dimensione: a.bytes.length });
  }
  // le firme dei programmi di posta ("Inviato da iPhone", righe "--") non fanno parte dell'articolo
  const testoGrezzo = (msg.text ?? "").split(/\n-- ?\n|\nInviato da |\nSent from /)[0];
  const testo = msg.html ? ripulisciHtml(msg.html) : testoInHtml(testoGrezzo);
  const adesso = new Date().toISOString();
  db.articoli.unshift({
    id, titolo, testo, allegati,
    link: linkNelTesto(testoGrezzo || msg.html || ""),
    copertina: allegati.find((x) => x.tipo.startsWith("image/"))?.url,
    autoreId: autore?.id,
    autoreNome: autore ? `${autore.firstName} ${autore.lastName}` : mittente,
    origine: "email", mittenteEmail: mittente,
    creato: adesso, pubblicato: puo ? adesso : undefined,
    stato: puo ? "pubblicato" : "bozza",
    destinatari: {}, letture: {},
  });
  return { ...voce, esito: puo ? "pubblicato" : "bozza", articoloId: id, nota: allegati.length ? `${allegati.length} allegati` : undefined };
}

function registra(db: ArticoliDB, voci: VoceRegistroEmail[]) {
  db.email.registro = [...voci, ...(db.email.registro ?? [])].slice(0, 100);
}

async function apri(db: ArticoliDB): Promise<ImapFlow> {
  const c = db.email.imap;
  if (!c?.host || !c.utente || !c.passwordCifrata) throw new Error("Casella non configurata");
  const client = new ImapFlow({
    host: c.host, port: c.porta || 993, secure: true,
    auth: { user: c.utente, pass: decifra(c.passwordCifrata) },
    logger: false,
    socketTimeout: 20_000,
  });
  await client.connect();
  return client;
}

/** "Prova connessione": entra, conta i messaggi, esce. Non importa niente. */
export async function provaCasella(): Promise<{ ok: boolean; messaggio: string }> {
  const db = await getArticoliDb();
  let client: ImapFlow | null = null;
  try {
    client = await apri(db);
    const cartella = db.email.imap?.cartella || "INBOX";
    const stato = await client.status(cartella, { messages: true, unseen: true });
    if (!stato) return { ok: false, messaggio: `Collegata, ma la cartella «${cartella}» non esiste.` };
    return { ok: true, messaggio: `Collegata: in «${cartella}» ${stato.messages ?? 0} messaggi, ${stato.unseen ?? 0} da leggere.` };
  } catch (e) {
    return { ok: false, messaggio: spiega(e) };
  } finally {
    await client?.logout().catch(() => undefined);
  }
}

/*
 * L'errore in parole. Si guardano prima i codici (rete, tempo) e il segno di
 * autenticazione fallita di imapflow, poi il testo: cercare solo parole come
 * "invalid" scambiava un server inesistente per una password sbagliata.
 */
function spiega(e: unknown): string {
  const err = e as { code?: string; authenticationFailed?: boolean; responseText?: string; message?: string; serverResponseCode?: string };
  const t = `${err?.message ?? String(e)} ${err?.responseText ?? ""}`;
  // la risposta esatta del server, accanto alla spiegazione: senza, "accesso rifiutato" copriva motivi diversi
  const server = err?.responseText ? ` Risposta del server: «${err.responseText.slice(0, 160)}»${err.serverResponseCode ? ` [${err.serverResponseCode}]` : ""}.` : "";
  if (/unable to authenticate data|Formato cifrato/i.test(t)) return "La password salvata non si decifra con la chiave di questo server: reinseriscila.";
  if (err?.code === "ENOTFOUND" || /getaddrinfo|ENOTFOUND/i.test(t)) return "Server non trovato: controlla l'indirizzo IMAP.";
  if (err?.code === "ETIMEDOUT" || err?.code === "ECONNREFUSED" || /timeout|ETIMEDOUT|ECONNREFUSED/i.test(t)) return "Il server non risponde: controlla indirizzo e porta.";
  if (err?.authenticationFailed || /AUTHENTICATIONFAILED|authentication failed|invalid credentials|LOGIN failed/i.test(t)) {
    return `Accesso rifiutato da Zoho.${server}`;
  }
  return `Errore: ${t.trim().slice(0, 200)}`;
}

/**
 * Il giro sulla casella: legge i messaggi non letti, ne fa articoli, li segna
 * come letti. Al massimo 10 per giro, un giro alla volta; senza `forzato` non
 * riparte prima di 5 minuti dall'ultimo.
 */
export async function controllaCasella(forzato = false): Promise<{ importati: number; nota?: string }> {
  const db = await getArticoliDb();
  const e = db.email;
  if (!e.attiva || !e.imap?.passwordCifrata) return { importati: 0, nota: "casella non attiva" };
  const adesso = Date.now();
  if (!forzato && e.ultimoControllo && adesso - new Date(e.ultimoControllo).getTime() < 5 * 60_000) return { importati: 0, nota: "controllata da poco" };
  if (e.inCorso && adesso - new Date(e.inCorso).getTime() < 2 * 60_000) return { importati: 0, nota: "un altro giro è in corso" };
  e.inCorso = new Date().toISOString();
  await saveArticoliDb(db);

  const academy = await getDb();
  const voci: VoceRegistroEmail[] = [];
  let client: ImapFlow | null = null;
  let errore: string | undefined;
  try {
    client = await apri(db);
    const lock = await client.getMailboxLock(e.imap.cartella || "INBOX");
    try {
      const nonLetti = ((await client.search({ seen: false }, { uid: true })) || []).slice(0, 10);
      for (const uid of nonLetti) {
        const m = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
        if (!m || !m.source) continue;
        const idMessaggio = m.envelope?.messageId ?? `uid:${uid}`;
        if (e.visti?.includes(idMessaggio)) {
          await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
          continue;
        }
        try {
          const p = await simpleParser(m.source);
          const voce = await articoloDaMessaggio(db, academy, {
            from: p.from?.text ?? "",
            subject: p.subject ?? "",
            text: p.text ?? undefined,
            html: typeof p.html === "string" ? p.html : undefined,
            allegati: (p.attachments ?? []).map((a) => ({ nome: a.filename ?? "allegato", tipo: a.contentType, bytes: a.content })),
          });
          voci.push(voce);
        } catch (err) {
          voci.push({ data: new Date().toISOString(), da: m.envelope?.from?.[0]?.address ?? "?", oggetto: m.envelope?.subject ?? "?", esito: "errore", nota: spiega(err) });
        }
        e.visti = [idMessaggio, ...(e.visti ?? [])].slice(0, 500);
        await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    errore = spiega(err);
  } finally {
    await client?.logout().catch(() => undefined);
  }
  e.inCorso = undefined;
  e.ultimoControllo = new Date().toISOString();
  e.ultimoErrore = errore;
  registra(db, voci);
  await saveArticoliDb(db);
  if (voci.some((v) => v.articoloId)) revalidatePath("/articoli", "layout");
  return { importati: voci.filter((v) => v.articoloId).length, nota: errore };
}

/** Per l'indirizzo POST: stesso percorso, messaggio già spacchettato dal servizio che lo manda. */
export async function importaMessaggio(msg: MessaggioIngresso): Promise<VoceRegistroEmail> {
  const db = await getArticoliDb();
  const academy = await getDb();
  const voce = await articoloDaMessaggio(db, academy, msg);
  registra(db, [voce]);
  await saveArticoliDb(db);
  if (voce.articoloId) revalidatePath("/articoli", "layout");
  return voce;
}
