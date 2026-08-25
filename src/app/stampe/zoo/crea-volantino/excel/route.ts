import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/auth";
import { canAccessArea, isZooEditor } from "@/lib/stampe";
import { getZooDb, volantinoCellRows } from "@/lib/zoo";

/**
 * Export del volantino composto, pensato per il grafico: una riga per cella,
 * con pagina, posizione (riga/colonna), estensione, sezione di appartenenza,
 * contenuto (offerte con EAN/prezzi, testo, immagine, etichetta) e il commento
 * lasciato da chi ha impaginato.
 */
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
  const rows = volantinoCellRows(db, campaignId);

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "volantino");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="volantino_per_grafico.xlsx"`,
    },
  });
}
