import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { Zip, ZipPassThrough } from "fflate";
import { volantinoCellRows, volantinoPhotoRefs, type ZooDB } from "./zoo";
import { publicUrlFor } from "./supabase";

/**
 * Lo ZIP per il grafico: l'Excel per cella più le foto degli articoli davvero
 * impaginati, alla risoluzione con cui sono state caricate (nessuna
 * ricompressione), più il PDF della bozza generato l'ultima volta. Lo usano il
 * pulsante «ZIP per il grafico» (con login) e il link per il grafico (con la
 * chiave nell'indirizzo, senza login).
 */
export function rispostaZipVolantino(db: ZooDB, campaignId: string, nomeFile = "volantino_foto.zip"): NextResponse {
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
      const aggiungiDaUrl = async (url: string, nome: string) => {
        let res: Response;
        try {
          res = await fetch(url, { cache: "no-store" });
        } catch {
          return false; // un file irraggiungibile non deve far fallire tutto lo ZIP
        }
        if (!res.ok || !res.body) return false;
        const entry = new ZipPassThrough(nome);
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
      "Content-Disposition": `attachment; filename="${nomeFile}"`,
      "Cache-Control": "no-store",
    },
  });
}
