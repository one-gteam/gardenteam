import { NextRequest, NextResponse } from "next/server";
import { segretoUguale } from "@/lib/auth";
import { inviaRiepilogoRegistrazioni } from "@/lib/registrazioni-riepilogo";
import { getStampeDb, saveStampeDb } from "@/lib/stampe";
import { leggiTuttiArredo } from "@/lib/arredo-lettura";

/**
 * Chiamata dal cron di Vercel (vercel.json), una volta al giorno al mattino:
 * manda agli amministratori di sistema il riepilogo delle richieste di
 * registrazione in attesa, se ce ne sono. Vercel mette il segreto CRON_SECRET
 * nell'intestazione Authorization; senza, non risponde.
 *
 * Nello stesso giro si leggono le quantità Arredo dei PV collegati in modo
 * «GT One legge» (Connettori): un cron in meno da tenere.
 */
export async function GET(req: NextRequest) {
  const segreto = process.env.CRON_SECRET;
  if (!segreto || !segretoUguale(req.headers.get("authorization"), `Bearer ${segreto}`)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  let arredo: { letti: number; ok: number } | { errore: string };
  try {
    const db = await getStampeDb();
    arredo = await leggiTuttiArredo(db);
    if (arredo.letti > 0) await saveStampeDb(db);
  } catch (e) {
    arredo = { errore: e instanceof Error ? e.message : "errore" };
  }
  return NextResponse.json({ registrazioni: await inviaRiepilogoRegistrazioni(), arredo });
}
