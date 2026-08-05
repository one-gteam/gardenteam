import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/auth";
import { canAccessArea, isZooEditor } from "@/lib/stampe";
import { getZooDb } from "@/lib/zoo";

/**
 * Export del volantino composto, pensato per il grafico: una riga per spazio,
 * con pagina, riga, posizione, larghezza, contenuto (offerta con EAN/prezzi
 * oppure testo libero).
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !canAccessArea(user, "zoo")) return new NextResponse("Non autorizzato", { status: 403 });
  const db = await getZooDb();
  if (!(isZooEditor(user) || (db.settings.volantinoEditors ?? []).includes(user.id))) {
    return new NextResponse("Non autorizzato", { status: 403 });
  }

  const campaignId = req.nextUrl.searchParams.get("campagna") ?? "";
  const layout = db.volantinoLayouts.find((l) => l.campaignId === campaignId);
  if (!layout) return new NextResponse("Volantino non ancora salvato", { status: 404 });

  const rows: Record<string, string | number>[] = [];
  layout.pages.forEach((page, pi) => {
    page.rows.forEach((row, ri) => {
      row.cells.forEach((cell, ci) => {
        const offer = cell.tipo === "offerta" ? db.offers.find((o) => o.id === cell.offerId) : undefined;
        const product = offer ? db.products.find((p) => p.id === offer.productId) : undefined;
        rows.push({
          Pagina: page.titolo || `Pagina ${pi + 1}`,
          Riga: ri + 1,
          Posizione: ci + 1,
          "Spazi riga": row.cols,
          "Larghezza (spazi)": cell.span,
          Tipo: cell.tipo === "offerta" ? "Offerta" : cell.tipo === "testo" ? "Testo" : "Vuoto",
          EAN: offer?.ean ?? "",
          Descrizione: cell.descrizione ?? offer?.descrizione ?? "",
          Marca: product?.marca ?? "",
          "Prezzo promo": cell.prezzo ?? offer?.prezzoPromo ?? "",
          "Prezzo listino": offer?.prezzoListino ?? "",
          Label: offer?.label ?? "",
          Testo: cell.testo ?? "",
        });
      });
    });
  });

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
