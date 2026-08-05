import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/auth";
import { canAccessArea, filterProducts, getStampeDb, resolveScope, effectiveValue, PrintProduct, Scope, StampeDB } from "@/lib/stampe";
import { DB } from "@/lib/types";
import { getDb } from "@/lib/db";

const HEADERS = [
  "CODICE FORNITORE", "EAN", "TIPOLOGIA", "MARCA", "Anno collezione", "Titolo", "Sottotitolo", "Materiali",
  "Parti incluse", "Colori", "Misure imballo", "Buono a sapersi", "Consigli utili",
  "Prezzo", "Prezzo listino", "Trasporto",
];

/**
 * Riga di export per un prodotto. Per il Consorzio esporta la versione comune;
 * per insegna/PV esporta i valori EFFETTIVI del proprio ambito (personalizzazioni
 * comprese), così il file scaricato è quello che si vede nei propri cartelli.
 */
function rowFor(db: StampeDB, scope: Scope, p: PrintProduct, academyDb: DB): Record<string, string> {
  const val = (fieldId: string) =>
    scope.type === "system" ? p.fields[fieldId] ?? "" : effectiveValue(db, scope, p, fieldId, academyDb).value;
  return {
    "CODICE FORNITORE": p.codice, EAN: p.ean, TIPOLOGIA: p.tipologia, MARCA: p.marca,
    "Anno collezione": p.annoCollezione ?? "",
    Titolo: val("titolo"), Sottotitolo: val("sottotitolo"), Materiali: val("materiali"),
    "Parti incluse": val("partiIncluse"), Colori: val("colori"), "Misure imballo": val("misure"),
    "Buono a sapersi": val("buono"), "Consigli utili": val("consigli"),
    Prezzo: val("prezzo"), "Prezzo listino": val("prezzoListino"), Trasporto: val("trasporto"),
  };
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !canAccessArea(user, "arredo")) return new NextResponse("Non autorizzato", { status: 403 });

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const db = await getStampeDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, sp.scope, academyDb);

  let rows: Record<string, string>[];
  let filename: string;
  let headers = HEADERS;
  if (sp.associa === "1") {
    // modello per l'associazione dei codici interni dell'insegna/PV
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
    rows = db.products.map((p) => rowFor(db, scope, p, academyDb));
    filename = "catalogo_completo_arredo.xlsx";
  } else if (sp.template === "1") {
    rows = [
      {
        "CODICE FORNITORE": "72558232", EAN: "2701725582328", TIPOLOGIA: "Lettini + Sdraio", MARCA: "Outsidehome",
        "Anno collezione": "2026",
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
    rows = products.map((p) => rowFor(db, scope, p, academyDb));
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
