import sharp from "sharp";
import { publicUrlFor, supabase, STORAGE_BUCKET } from "./supabase";
import { percorsoMiniatura } from "./miniatura-url";

/*
 * Miniature delle foto dello Zoo: 160 px di lato, webp. Le tabelle ne mostrano
 * centinaia a 44 px: scaricare gli originali (spesso diversi MB l'uno) rendeva
 * le pagine pesantissime da cellulare e dal wifi dei negozi.
 */
export async function creaMiniatura(nomeFile: string): Promise<boolean> {
  try {
    const r = await fetch(publicUrlFor(`zoo-foto/${nomeFile}`), { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return false;
    const originale = Buffer.from(await r.arrayBuffer());
    const mini = await sharp(originale).rotate().resize(160, 160, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 72 }).toBuffer();
    const { error } = await supabase().storage.from(STORAGE_BUCKET)
      .upload(percorsoMiniatura(nomeFile), mini, { contentType: "image/webp", upsert: true, cacheControl: "31536000" });
    return !error;
  } catch {
    return false;
  }
}

/** Più miniature, cinque alla volta. */
export async function creaMiniature(nomiFile: string[]): Promise<number> {
  let fatte = 0;
  for (let i = 0; i < nomiFile.length; i += 5) {
    const esiti = await Promise.all(nomiFile.slice(i, i + 5).map(creaMiniatura));
    fatte += esiti.filter(Boolean).length;
  }
  return fatte;
}
