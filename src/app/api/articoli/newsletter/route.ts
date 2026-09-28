import { segretoUguale } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { inviaNewsletterArticoli } from "@/lib/articoli-newsletter";
import { controllaCasella } from "@/lib/articoli-email";

/**
 * Chiamata dal cron di Vercel (vercel.json): legge la casella degli articoli
 * e manda la newsletter se è dovuta. Vercel mette il segreto CRON_SECRET
 * nell'intestazione Authorization; senza, non risponde.
 */
export const maxDuration = 300; // lettura casella + un invio ogni ~0,5 s per iscritto

export async function GET(req: NextRequest) {
  const segreto = process.env.CRON_SECRET;
  if (!segreto || !segretoUguale(req.headers.get("authorization"), `Bearer ${segreto}`)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const casella = await controllaCasella(true).catch((e) => ({ importati: 0, nota: String(e) }));
  const newsletter = await inviaNewsletterArticoli(false);
  return NextResponse.json({ casella, newsletter });
}
