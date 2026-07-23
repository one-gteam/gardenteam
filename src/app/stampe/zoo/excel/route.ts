import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/auth";
import { canAccessStampe, resolveScope } from "@/lib/stampe";
import { getDb } from "@/lib/db";
import { getZooDb, activeCampaign, zooImageUrl, effectiveParentText, pvPriceFor } from "@/lib/zoo";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !canAccessStampe(user)) return new NextResponse("Non autorizzato", { status: 403 });

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const db = await getZooDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, sp.scope, academyDb);

  let rows: Record<string, string>[];
  let filename: string;

  if (sp.template === "1") {
    // modello import prodotti base
    rows = [
      {
        EAN: "8001234567890", "CODICE FORNITORE": "PET-0132", DESCRIZIONE: "Croccantini adult pollo 3 kg",
        MARCA: "HappyDog", FORNITORE: "PetFood Italia", CATEGORIA: "Cane secco", PREZZO: "14,90",
      },
    ];
    filename = "modello_prodotti_zoo.xlsx";
  } else if (sp.offerte === "1") {
    // modello import offerte mensili
    rows = [
      {
        EAN: "8001234567890", "DESCRIZIONE PROMO": "Croccantini adult pollo 3 kg", "PREZZO PROMO": "11,90",
        "PREZZO LISTINO": "14,90", CONDIZIONI: "Fino a esaurimento scorte",
        "CODICE FORNITORE": "PET-0132", MARCA: "HappyDog", FORNITORE: "PetFood Italia", CATEGORIA: "Cane secco",
      },
    ];
    filename = "modello_offerte_zoo.xlsx";
  } else if (sp.prezzi === "1") {
    // modello prezzi PV precompilato con le offerte in corso
    const campaign = activeCampaign(db);
    const offers = campaign ? db.offers.filter((o) => o.campaignId === campaign.id && o.selezionata) : [];
    rows = (offers.length > 0 ? offers : campaign ? db.offers.filter((o) => o.campaignId === campaign.id) : []).map((o) => {
      const p = db.products.find((x) => x.id === o.productId);
      return {
        EAN: o.ean,
        "CODICE FORNITORE": p?.codice ?? "",
        DESCRIZIONE: o.descrizione,
        "PREZZO PROMO CONSORZIO": o.prezzoPromo,
        PREZZO: pvPriceFor(db, scope, o.ean, academyDb) ?? "",
      };
    });
    filename = "prezzi_pv_zoo.xlsx";
  } else if (sp.volantino === "1") {
    // export per il grafico: offerte selezionate con testi e riferimento foto
    const campaign = db.campaigns.find((c) => c.id === sp.campagna) ?? activeCampaign(db);
    const offers = campaign ? db.offers.filter((o) => o.campaignId === campaign.id && o.selezionata) : [];
    rows = offers
      .sort((a, b) => (a.schedaId ?? "").localeCompare(b.schedaId ?? "") || (a.ordine ?? 0) - (b.ordine ?? 0))
      .map((o) => {
        const p = db.products.find((x) => x.id === o.productId);
        const parent = p?.parentId ? db.parents.find((x) => x.id === p.parentId) : undefined;
        return {
          SCHEDA: campaign?.schede.find((s) => s.id === o.schedaId)?.nome ?? "",
          EAN: o.ean,
          MARCA: p?.marca ?? "",
          TITOLO: parent ? effectiveParentText(db, scope, parent, "nome", academyDb).value : (p?.descrizione ?? o.descrizione),
          "DESCRIZIONE VOLANTINO": parent ? effectiveParentText(db, scope, parent, "descVolantino", academyDb).value : o.descrizione,
          "PREZZO PROMO": o.prezzoPromo,
          "PREZZO LISTINO": o.prezzoListino ?? "",
          ETICHETTA: o.label ?? "",
          "AREA TEMATICA": o.gruppo ?? "",
          "DESCRIZIONE AREA": o.gruppoDescrizione ?? "",
          "TENERE VICINO A": o.tieniVicinoA
            ? (db.offers.find((x) => x.id === o.tieniVicinoA)?.descrizione ?? "")
            : "",
          CONDIZIONI: o.condizioni ?? "",
          FOTO: zooImageUrl(p, parent),
          "VALIDITA'": campaign ? `${campaign.dal} - ${campaign.al}` : "",
        };
      });
    filename = `volantino_${(campaign?.nome ?? "zoo").replace(/\s+/g, "_").toLowerCase()}.xlsx`;
  } else {
    // export catalogo completo
    rows = db.products.map((p) => {
      const parent = p.parentId ? db.parents.find((x) => x.id === p.parentId) : undefined;
      return {
        EAN: p.ean, "CODICE FORNITORE": p.codice, DESCRIZIONE: p.descrizione,
        MARCA: p.marca, FORNITORE: p.fornitore, CATEGORIA: p.categoria ?? "", PREZZO: p.prezzo ?? "",
        "PRODOTTO PADRE": parent?.nome ?? "", FOTO: p.image ?? "",
      };
    });
    filename = "catalogo_zoo.xlsx";
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "zoo");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
