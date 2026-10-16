import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessArea, isZooEditor } from "@/lib/stampe";
import { getZooDb } from "@/lib/zoo";
import { rispostaZipVolantino } from "@/lib/zip-volantino";

// Il fetch di decine/centinaia di foto in alta risoluzione può richiedere più
// dei 10s di default: alza il limite dove la piattaforma lo consente (Hobby lo
// riduce comunque al proprio massimo, non è un errore se resta più basso).
export const maxDuration = 300;

/** ZIP per il grafico (Excel, PDF e foto), per chi compone il volantino. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !canAccessArea(user, "zoo")) return new NextResponse("Non autorizzato", { status: 403 });
  const db = await getZooDb();
  if (!(isZooEditor(user) || (db.settings.volantinoEditors ?? []).includes(user.id))) {
    return new NextResponse("Non autorizzato", { status: 403 });
  }
  const campaignId = req.nextUrl.searchParams.get("campagna") ?? "";
  if (!db.volantinoLayouts.some((l) => l.campaignId === campaignId)) {
    return new NextResponse("Volantino non ancora salvato", { status: 404 });
  }
  return rispostaZipVolantino(db, campaignId);
}
