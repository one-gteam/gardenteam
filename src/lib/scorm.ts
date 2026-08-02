import { unzipSync } from "fflate";
import { uploadPublicFile, STORAGE_BUCKET, supabase } from "./supabase";
import { ScormPackage } from "./types";

/* ================== Gestione pacchetti SCORM ================== */

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html", htm: "text/html", js: "text/javascript", mjs: "text/javascript",
  css: "text/css", json: "application/json", xml: "application/xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  svg: "image/svg+xml", webp: "image/webp", ico: "image/x-icon",
  mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4",
  mp4: "video/mp4", webm: "video/webm", woff: "font/woff", woff2: "font/woff2",
  ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject",
  pdf: "application/pdf", txt: "text/plain", vtt: "text/vtt", swf: "application/x-shockwave-flash",
};

function contentType(name: string): string {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** Decodifica una porzione di file come testo per leggere il manifest. */
function asText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

/** Estrae versione e file di avvio dal manifest imsmanifest.xml. */
function parseManifest(xml: string): { entry: string | null; version: ScormPackage["version"] } {
  // versione: SCORM 2004 dichiara "2004" o "CAM 1.3", altrimenti 1.2
  const schema = /<schemaversion>\s*([^<]+)<\/schemaversion>/i.exec(xml)?.[1] ?? "";
  const version: ScormPackage["version"] = /2004|CAM 1\.3/i.test(schema) ? "2004" : "1.2";

  // risorsa lanciata dalla prima voce dell'organizzazione predefinita
  const defaultOrg = /<organizations[^>]*\bdefault="([^"]+)"/i.exec(xml)?.[1];
  let ref: string | undefined;
  if (defaultOrg) {
    const orgBlock = new RegExp(`<organization[^>]*identifier="${defaultOrg}"[\\s\\S]*?</organization>`, "i").exec(xml)?.[0];
    ref = orgBlock ? /<item[^>]*\bidentifierref="([^"]+)"/i.exec(orgBlock)?.[1] : undefined;
  }
  ref = ref ?? /<item[^>]*\bidentifierref="([^"]+)"/i.exec(xml)?.[1];

  let entry: string | null = null;
  if (ref) {
    const res = new RegExp(`<resource[^>]*identifier="${ref}"[^>]*>`, "i").exec(xml)?.[0];
    entry = res ? /\bhref="([^"]+)"/i.exec(res)?.[1] ?? null : null;
  }
  // fallback: prima risorsa con un href
  if (!entry) entry = /<resource[^>]*\bhref="([^"]+)"/i.exec(xml)?.[1] ?? null;
  return { entry: entry ? decodeURIComponent(entry) : null, version };
}

/** Carica in parallelo (a piccoli lotti) i file scompattati sullo Storage. */
async function uploadAll(prefix: string, files: [string, Uint8Array][]) {
  const BATCH = 6;
  for (let i = 0; i < files.length; i += BATCH) {
    await Promise.all(
      files.slice(i, i + BATCH).map(([name, bytes]) =>
        uploadPublicFile(`${prefix}/${name}`, Buffer.from(bytes), contentType(name))
      )
    );
  }
}

/**
 * Scompatta un pacchetto SCORM (zip), lo carica su Storage e ritorna dove
 * avviarlo. Ritorna un errore leggibile se manca il manifest o il file di avvio.
 */
export async function importScormPackage(
  lessonId: string,
  fileName: string,
  zip: Buffer
): Promise<{ ok: true; pkg: ScormPackage } | { ok: false; error: string }> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(zip));
  } catch {
    return { ok: false, error: "Il file non è uno zip valido." };
  }

  // percorso del manifest (di solito alla radice, a volte in una sottocartella)
  const entries = Object.entries(files).filter(([, b]) => b.length > 0); // scarta le cartelle
  const manifestPath = entries.find(([n]) => n.toLowerCase().endsWith("imsmanifest.xml"))?.[0];
  if (!manifestPath) {
    return { ok: false, error: "Manifest imsmanifest.xml non trovato: non è un pacchetto SCORM." };
  }
  // se il manifest è in una sottocartella, quella è la radice del contenuto
  const root = manifestPath.slice(0, manifestPath.length - "imsmanifest.xml".length);
  const { entry, version } = parseManifest(asText(files[manifestPath]));
  if (!entry) return { ok: false, error: "Nel manifest non è indicato il file di avvio (href)." };

  // riporta i percorsi alla radice del contenuto e ricarica tutto
  const rebased: [string, Uint8Array][] = entries
    .filter(([n]) => n.startsWith(root))
    .map(([n, b]) => [n.slice(root.length), b]);

  const prefix = `scorm/${lessonId}_${Date.now()}`;
  await uploadAll(prefix, rebased);

  return {
    ok: true,
    pkg: { path: prefix, entry, version, fileName, uploadedAt: new Date().toISOString() },
  };
}

/** Raccoglie ricorsivamente tutti i file (anche nelle sottocartelle) sotto un prefisso. */
async function listRecursive(prefix: string): Promise<string[]> {
  const { data } = await supabase().storage.from(STORAGE_BUCKET).list(prefix, { limit: 1000 });
  const out: string[] = [];
  for (const item of data ?? []) {
    const path = `${prefix}/${item.name}`;
    if (item.id) out.push(path); // file
    else out.push(...(await listRecursive(path))); // cartella
  }
  return out;
}

/** Rimuove dal bucket tutti i file di un pacchetto SCORM (alla sostituzione/eliminazione). */
export async function removeScormPackage(pkg: ScormPackage): Promise<void> {
  if (!pkg.path) return;
  const paths = await listRecursive(pkg.path);
  if (paths.length) await supabase().storage.from(STORAGE_BUCKET).remove(paths);
}
