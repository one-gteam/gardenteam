import { NextRequest, NextResponse } from "next/server";
import { segretoUguale } from "@/lib/auth";
import { inviaRiepilogoRegistrazioni } from "@/lib/registrazioni-riepilogo";

/**
 * Chiamata dal cron di Vercel (vercel.json), una volta al giorno al mattino:
 * manda agli amministratori di sistema il riepilogo delle richieste di
 * registrazione in attesa, se ce ne sono. Vercel mette il segreto CRON_SECRET
 * nell'intestazione Authorization; senza, non risponde.
 */
export async function GET(req: NextRequest) {
  const segreto = process.env.CRON_SECRET;
  if (!segreto || !segretoUguale(req.headers.get("authorization"), `Bearer ${segreto}`)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  return NextResponse.json(await inviaRiepilogoRegistrazioni());
}
