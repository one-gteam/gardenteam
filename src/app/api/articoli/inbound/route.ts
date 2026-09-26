import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { uploadPublicFile } from "@/lib/supabase";
import {
  getArticoliDb, saveArticoliDb, pubblicaArticoli, ripulisciHtml, testoInHtml, linkNelTesto, type Allegato,
} from "@/lib/articoli";
import { revalidatePath } from "next/cache";

/*
 * Articoli spediti per email. Il servizio di posta che riceve la casella
 * (Resend in ricezione, un Worker di Cloudflare Email Routing, o qualsiasi
 * altro) chiama questo indirizzo con il messaggio già spacchettato:
 *
 *   POST /api/articoli/inbound
 *   X-Articoli-Secret: <ARTICOLI_INBOUND_SECRET>
 *   { "from": "nome@insegna.it", "subject": "…", "text": "…", "html": "…",
 *     "attachments": [ { "filename": "x.pdf", "contentType": "application/pdf", "content": "<base64>" }
 *                    | { "filename": "x.jpg", "contentType": "image/jpeg", "url": "https://…" } ] }
 *
 * Oggetto = titolo, corpo = descrizione, allegati = allegati, indirizzi web
 * nel corpo = link. Il mittente dev'essere una persona che può pubblicare:
 * altrimenti l'email si rifiuta, o va in bozza se l'area è impostata così.
 */
const MAX_ALLEGATO = 15 * 1024 * 1024;
const TIPI = /^(image\/(jpeg|png|gif|webp)|application\/pdf)$/;

interface AllegatoIn { filename?: string; contentType?: string; content?: string; url?: string }
interface MessaggioIn { from?: string; subject?: string; text?: string; html?: string; attachments?: AllegatoIn[] }

function emailDa(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim().toLowerCase();
}

export async function POST(req: NextRequest) {
  const segreto = process.env.ARTICOLI_INBOUND_SECRET;
  if (!segreto || req.headers.get("x-articoli-secret") !== segreto) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const db = await getArticoliDb();
  if (!db.email.attiva) return NextResponse.json({ error: "Ricezione per email disattivata" }, { status: 409 });

  let msg: MessaggioIn;
  try { msg = (await req.json()) as MessaggioIn; } catch { return NextResponse.json({ error: "Corpo non valido" }, { status: 400 }); }
  const mittente = emailDa(msg.from ?? "");
  const titolo = (msg.subject ?? "").trim();
  if (!mittente || !titolo) return NextResponse.json({ error: "Servono mittente e oggetto" }, { status: 400 });

  const academy = await getDb();
  const autore = academy.users.find((u) => u.email.toLowerCase() === mittente && u.active !== false);
  const puo = autore ? pubblicaArticoli(autore, db) : false;
  if (!puo && db.email.sconosciuti === "rifiuta") {
    return NextResponse.json({ error: "Mittente non abilitato a pubblicare" }, { status: 403 });
  }

  const id = `art_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const allegati: Allegato[] = [];
  for (const a of (msg.attachments ?? []).slice(0, 10)) {
    const tipo = (a.contentType ?? "").split(";")[0].trim().toLowerCase();
    if (!TIPI.test(tipo)) continue;
    let bytes: Buffer | null = null;
    if (a.content) bytes = Buffer.from(a.content, "base64");
    else if (a.url && /^https:\/\//.test(a.url)) {
      try { const r = await fetch(a.url); if (r.ok) bytes = Buffer.from(await r.arrayBuffer()); } catch { /* si salta */ }
    }
    if (!bytes || bytes.length === 0 || bytes.length > MAX_ALLEGATO) continue;
    const nome = (a.filename ?? "allegato").split(/[\\/]/).pop()!.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100);
    const url = await uploadPublicFile(`articoli/${id}/${Date.now()}_${nome}`, bytes, tipo);
    allegati.push({ nome: a.filename ?? nome, url, tipo, dimensione: bytes.length });
  }

  const testoGrezzo = msg.text ?? "";
  const testo = msg.html ? ripulisciHtml(msg.html) : testoInHtml(testoGrezzo);
  const adesso = new Date().toISOString();
  const pubblica = puo;
  db.articoli.unshift({
    id, titolo, testo, allegati,
    link: linkNelTesto(testoGrezzo || msg.html || ""),
    copertina: allegati.find((x) => x.tipo.startsWith("image/"))?.url,
    autoreId: autore?.id,
    autoreNome: autore ? `${autore.firstName} ${autore.lastName}` : mittente,
    origine: "email", mittenteEmail: mittente,
    creato: adesso, pubblicato: pubblica ? adesso : undefined,
    stato: pubblica ? "pubblicato" : "bozza",
    destinatari: {}, letture: {},
  });
  await saveArticoliDb(db);
  revalidatePath("/articoli", "layout");
  return NextResponse.json({ ok: true, id, stato: pubblica ? "pubblicato" : "bozza", allegati: allegati.length });
}
