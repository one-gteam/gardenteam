import { NextRequest, NextResponse } from "next/server";
import { inviaNewsletterArticoli } from "@/lib/articoli-newsletter";

/**
 * Chiamata dal cron di Vercel (vercel.json) una volta al giorno: manda la
 * newsletter degli articoli se è dovuta. Vercel mette il segreto CRON_SECRET
 * nell'intestazione Authorization; senza, non risponde.
 */
export async function GET(req: NextRequest) {
  const segreto = process.env.CRON_SECRET;
  if (!segreto || req.headers.get("authorization") !== `Bearer ${segreto}`) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const r = await inviaNewsletterArticoli(false);
  return NextResponse.json(r);
}
