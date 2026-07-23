import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/auth";
import { canAccessStampe, filterProducts, getStampeDb, resolveScope, effectiveValue } from "@/lib/stampe";
import { getDb } from "@/lib/db";

const HEADERS = [
  "CODICE FORNITORE", "EAN", "TIPOLOGIA", "MARCA", "Titolo", "Sottotitolo", "Materiali",
  "Parti incluse", "Colori", "Misure imballo", "Buono a sapersi", "Consigli utili",
  "Prezzo", "Prezzo listino", "Trasporto",
];

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !canAccessStampe(user)) return new NextResponse("Non autorizzato", { status: 403 });

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const db = await getStampeDb();
  const academyDb = await getDb();

  let rows: Record<string, string>[];
  let filename: string;
  let headers = HEADERS;
  if (sp.associa === "1") {
    // modello per l'associazione dei codici interni dell'insegna/PV
    const scope = resolveScope(user, sp.scope, academyDb);
    headers = ["CODICE FORNITORE", "EAN", "MARCA", "Titolo", "CODICE INTERNO"];
    rows = db.products.map((p) => ({
      "CODICE FORNITORE": p.codice,
      EAN: p.ean,
      MARCA: p.marca,
      Titolo: p.fields.titolo ?? "",
      "CODICE INTERNO": scope.type === "system" ? "" : effectiveValue(db, scope, p, "codiceInterno", academyDb).value,
    }));
    filename = "associazione_codici_interni.xlsx";
  } else if (sp.catalogo === "1") {
    rows = db.products.map((p) => ({
      "CODICE FORNITORE": p.codice, EAN: p.ean, TIPOLOGIA: p.tipologia, MARCA: p.marca,
      Titolo: p.fields.titolo ?? "", Sottotitolo: p.fields.sottotitolo ?? "", Materiali: p.fields.materiali ?? "",
      "Parti incluse": p.fields.partiIncluse ?? "", Colori: p.fields.colori ?? "", "Misure imballo": p.fields.misure ?? "",
      "Buono a sapersi": p.fields.buono ?? "", "Consigli utili": p.fields.consigli ?? "",
      Prezzo: p.fields.prezzo ?? "", "Prezzo listino": p.fields.prezzoListino ?? "", Trasporto: p.fields.trasporto ?? "",
    }));
    filename = "catalogo_completo_arredo.xlsx";
  } else if (sp.template === "1") {
    rows = [
      {
        "CODICE FORNITORE": "72558232", EAN: "2701725582328", TIPOLOGIA: "Lettini + Sdraio", MARCA: "Outsidehome",
        Titolo: "Lettino alluminio", Sottotitolo: "Lettino prendisole in alluminio",
        Materiali: "Struttura alluminio e seduta textilene", "Parti incluse": "1 lettino 181x67xh39 cm  Portata 120 kg",
        Colori: "Antracite  Tortora", "Misure imballo": "1 box 153x72xh20 cm  Peso 6 kg",
        "Buono a sapersi": "Tettuccio regolabile", "Consigli utili": "Completa con il cuscino coordinato",
        Prezzo: "109,00", "Prezzo listino": "", Trasporto: "Trasporto e montaggio senza stress? Chiedi al nostro Infopoint!",
      },
    ];
    filename = "modello_import_cartelli.xlsx";
  } else {
    const selIds = (sp.sel ?? "").split(",").filter(Boolean);
    const products = selIds.length > 0
      ? db.products.filter((p) => selIds.includes(p.id))
      : filterProducts(db, sp);
    rows = products.map((p) => ({
      "CODICE FORNITORE": p.codice, EAN: p.ean, TIPOLOGIA: p.tipologia, MARCA: p.marca,
      Titolo: p.fields.titolo ?? "", Sottotitolo: p.fields.sottotitolo ?? "", Materiali: p.fields.materiali ?? "",
      "Parti incluse": p.fields.partiIncluse ?? "", Colori: p.fields.colori ?? "", "Misure imballo": p.fields.misure ?? "",
      "Buono a sapersi": p.fields.buono ?? "", "Consigli utili": p.fields.consigli ?? "",
      Prezzo: p.fields.prezzo ?? "", "Prezzo listino": p.fields.prezzoListino ?? "", Trasporto: p.fields.trasporto ?? "",
    }));
    filename = `prodotti_arredo_${new Date().toISOString().slice(0, 10)}.xlsx`;
  }

  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "dati_arredo");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
