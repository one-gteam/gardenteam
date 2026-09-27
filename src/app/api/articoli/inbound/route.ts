import { NextRequest, NextResponse } from "next/server";
import { getArticoliDb } from "@/lib/articoli";
import { importaMessaggio } from "@/lib/articoli-email";

/*
 * Articoli spediti per email, per i servizi che spingono i messaggi da soli
 * (Resend in ricezione, un Worker di Cloudflare Email Routing…). La strada
 * principale è la casella IMAP letta dal sito (vedi articoli-email.ts); questa
 * resta per chi preferisce un inoltro.
 *
 *   POST /api/articoli/inbound
 *   X-Articoli-Secret: <ARTICOLI_INBOUND_SECRET>
 *   { "from", "subject", "text", "html",
 *     "attachments": [ { "filename", "contentType", "content": "<base64>" } | { "filename", "contentType", "url" } ] }
 */
interface AllegatoIn { filename?: string; contentType?: string; content?: string; url?: string }
interface MessaggioIn { from?: string; subject?: string; text?: string; html?: string; attachments?: AllegatoIn[] }

export async function POST(req: NextRequest) {
  const segreto = process.env.ARTICOLI_INBOUND_SECRET;
  if (!segreto || req.headers.get("x-articoli-secret") !== segreto) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const db = await getArticoliDb();
  if (!db.email.attiva) return NextResponse.json({ error: "Ricezione per email disattivata" }, { status: 409 });

  let msg: MessaggioIn;
  try { msg = (await req.json()) as MessaggioIn; } catch { return NextResponse.json({ error: "Corpo non valido" }, { status: 400 }); }

  const allegati: { nome: string; tipo: string; bytes: Buffer }[] = [];
  for (const a of (msg.attachments ?? []).slice(0, 10)) {
    let bytes: Buffer | null = null;
    if (a.content) bytes = Buffer.from(a.content, "base64");
    else if (a.url && /^https:\/\//.test(a.url)) {
      try { const r = await fetch(a.url); if (r.ok) bytes = Buffer.from(await r.arrayBuffer()); } catch { /* si salta */ }
    }
    if (bytes) allegati.push({ nome: a.filename ?? "allegato", tipo: a.contentType ?? "", bytes });
  }
  const voce = await importaMessaggio({ from: msg.from ?? "", subject: msg.subject ?? "", text: msg.text, html: msg.html, allegati });
  if (!voce.articoloId) return NextResponse.json({ error: voce.nota ?? "Rifiutato" }, { status: voce.esito === "errore" ? 500 : 403 });
  return NextResponse.json({ ok: true, id: voce.articoloId, stato: voce.esito });
}
