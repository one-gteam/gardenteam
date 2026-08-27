import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessArea, isZooEditor } from "@/lib/stampe";
import { createSignedUploadUrl } from "@/lib/supabase";

/**
 * URL firmato per caricare il PDF del volantino (generato nel browser, una
 * pagina per foglio) direttamente su Supabase Storage: stesso schema delle
 * foto, per non passare centinaia di KB/MB per la funzione serverless.
 * Un file per campagna (percorso fisso, upsert): il ZIP "per il grafico" lo
 * trova sempre all'ultima versione generata.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !canAccessArea(user, "zoo") || !isZooEditor(user)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { campaignId?: string } | null;
  const campaignId = body?.campaignId;
  if (!campaignId || !/^[a-zA-Z0-9_-]+$/.test(campaignId)) {
    return NextResponse.json({ error: "campaignId mancante o non valido" }, { status: 400 });
  }
  const signedUrl = await createSignedUploadUrl(`volantino-pdf/${campaignId}.pdf`);
  return NextResponse.json({ signedUrl });
}
