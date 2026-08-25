import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessArea } from "@/lib/stampe";
import { createSignedUploadUrl } from "@/lib/supabase";

/**
 * Rilascia un URL firmato per ciascun nome file richiesto: il browser carica poi
 * le foto direttamente su Supabase Storage (bucket zoo-foto), senza farle
 * transitare per la funzione serverless — è quello che permette di caricare
 * centinaia di foto in alta risoluzione in un colpo solo senza sbattere contro
 * il limite di dimensione del body di Vercel.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !canAccessArea(user, "zoo")) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { fileNames?: unknown } | null;
  const fileNames = Array.isArray(body?.fileNames)
    ? body!.fileNames.filter((f): f is string => typeof f === "string" && f.length > 0).slice(0, 500)
    : [];
  if (fileNames.length === 0) return NextResponse.json({ urls: [] });

  const urls = await Promise.all(
    fileNames.map(async (fileName) => {
      try {
        const signedUrl = await createSignedUploadUrl(`zoo-foto/${fileName}`);
        return { fileName, signedUrl };
      } catch {
        return { fileName, signedUrl: null };
      }
    })
  );
  return NextResponse.json({ urls });
}
