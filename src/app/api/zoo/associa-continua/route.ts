import { NextRequest, NextResponse, after } from "next/server";
import { getZooDb } from "@/lib/zoo";
import { eseguiAssociazione } from "@/lib/zoo-ai-lavoro";

/**
 * Giro successivo di "Associa tutti con l'AI": lo chiama il giro precedente
 * quando il suo tempo sta per finire, con il segreto CRON_SECRET. Risponde
 * subito e lavora dopo la risposta, con 300 s nuovi a disposizione.
 */
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const segreto = process.env.CRON_SECRET;
  if (!segreto || req.headers.get("authorization") !== `Bearer ${segreto}`) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const db = await getZooDb();
  const l = db.settings.aiLavoro;
  const apiKey = db.settings.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!l || l.stato !== "in corso" || !l.daFare?.length || !apiKey) {
    return NextResponse.json({ ok: false, nota: "niente da continuare" });
  }
  const ids = l.daFare;
  after(() => eseguiAssociazione(apiKey, ids));
  return NextResponse.json({ ok: true, articoli: ids.length });
}
