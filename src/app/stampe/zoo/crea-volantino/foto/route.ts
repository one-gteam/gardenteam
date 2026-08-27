import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { Zip, ZipPassThrough } from "fflate";
import { getCurrentUser } from "@/lib/auth";
import { canAccessArea, isZooEditor } from "@/lib/stampe";
import { getZooDb, volantinoCellRows, volantinoPhotoRefs } from "@/lib/zoo";
import { publicUrlFor } from "@/lib/supabase";

// Il fetch di decine/centinaia di foto in alta risoluzione può richiedere più
// dei 10s di default: alza il limite dove la piattaforma lo consente (Hobby lo
// riduce comunque al proprio massimo, non è un errore se resta più basso).
export const maxDuration = 300;

/**
 * ZIP per il grafico: l'Excel per cella (stesso di crea-volantino/excel) più le
 * foto degli articoli davvero impaginati, alla stessa risoluzione con cui sono
 * state caricate — nessuna ricompressione, i file entrano "as-is" nello ZIP.
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
  const photos = volantinoPhotoRefs(db, campaignId);

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "volantino");
  const excelBuf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const usedNames = new Set<string>();
  const uniqueName = (base: string, ext: string) => {
    const clean = base.toLowerCase().replace(/[^a-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "foto";
    let name = `${clean}.${ext}`;
    let i = 2;
    while (usedNames.has(name)) name = `${clean}_${i++}.${ext}`;
    usedNames.add(name);
    return name;
  };

  // il PDF (generato nel browser, una pagina per foglio) è opzionale: se non è mai
  // stato generato per questa campagna, il fetch restituisce 404 e lo ZIP parte comunque
  const pdfUrl = publicUrlFor(`volantino-pdf/${campaignId}.pdf`);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const zip = new Zip((err, data, final) => {
        if (err) { controller.error(err); return; }
        if (data) controller.enqueue(data);
        if (final) controller.close();
      });

      /** Scarica un URL e lo riversa in un'unica voce dello ZIP, senza bufferizzarlo tutto in memoria. */
      const aggiungiDaUrl = async (url: string, nomeFile: string) => {
        let res: Response;
        try {
          res = await fetch(url);
        } catch {
          return false; // un file irraggiungibile non deve far fallire tutto lo ZIP
        }
        if (!res.ok || !res.body) return false;
        const entry = new ZipPassThrough(nomeFile);
        zip.add(entry);
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            entry.push(new Uint8Array(0), true);
            return true;
          }
          entry.push(value, false);
        }
      };

      (async () => {
        try {
          const excelEntry = new ZipPassThrough("volantino_per_grafico.xlsx");
          zip.add(excelEntry);
          excelEntry.push(new Uint8Array(excelBuf), true);

          await aggiungiDaUrl(pdfUrl, "volantino_anteprima.pdf");

          for (const photo of photos) {
            const pathOnly = photo.url.split("?")[0];
            const ext = (pathOnly.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
            await aggiungiDaUrl(photo.url, uniqueName(photo.nome, ext));
          }
          zip.end();
        } catch (e) {
          controller.error(e);
        }
      })();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="volantino_foto.zip"`,
    },
  });
}
