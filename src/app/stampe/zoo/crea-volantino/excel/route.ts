import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/auth";
import { canAccessArea, isZooEditor } from "@/lib/stampe";
import { getZooDb, migraVolantinoPages } from "@/lib/zoo";

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
  const layout = db.volantinoLayouts.find((l) => l.campaignId === campaignId);
  if (!layout) return new NextResponse("Volantino non ancora salvato", { status: 404 });
  const pages = migraVolantinoPages(layout.pages);

  const rows: Record<string, string | number>[] = [];
  pages.forEach((page, pi) => {
    const nomePagina = page.titolo || `Pagina ${pi + 1}`;
    page.blocks.forEach((b, bi) => {
      const offs = (b.offerIds ?? []).map((id) => db.offers.find((o) => o.id === id)).filter(Boolean);
      if (offs.length === 0 && !b.testo && !b.imageUrl && !b.label) return; // celle vuote: non servono al grafico
      // sezione che contiene questa cella (per lo sfondo comune)
      const sez = (page.sezioni ?? []).find(
        (s) => b.r >= s.r && b.r < s.r + s.rs && b.c >= s.c && b.c < s.c + s.cs
      );
      const primo = offs[0];
      rows.push({
        "N. pagina": pi + 1,
        Pagina: nomePagina,
        "Note della pagina": page.note ?? "",
        Cella: `${pi + 1}-${bi + 1}`,
        Riga: b.r + 1,
        Colonna: b.c + 1,
        "Righe occupate": b.rs,
        "Colonne occupate": b.cs,
        Sezione: sez?.titolo ?? "",
        "Sfondo sezione": sez?.bg ?? "",
        "N. offerte": offs.length,
        EAN: offs.map((o) => o!.ean).join(" / "),
        Descrizione: b.descrizione ?? offs.map((o) => o!.descrizione).join(" / "),
        Marca: offs.map((o) => db.products.find((p) => p.id === o!.productId)?.marca ?? "").join(" / "),
        "Prezzo promo": b.prezzo ?? offs.map((o) => o!.prezzoPromo).join(" / "),
        "Prezzo listino": offs.map((o) => o!.prezzoListino ?? "").join(" / "),
        Etichetta: b.label ?? primo?.label ?? "",
        Testo: b.testo ?? "",
        Immagine: b.imageUrl ?? "",
        "Commento per il grafico": b.commento ?? "",
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
