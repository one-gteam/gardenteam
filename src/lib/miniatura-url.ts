/*
 * Dove sta la miniatura di una foto dello Zoo: stessa cartella pubblica del
 * bucket, sotto "zoo-foto-mini", in webp. Modulo senza dipendenze server: lo usa
 * anche il componente che mostra le foto nel browser.
 */
export function percorsoMiniatura(nomeFile: string): string {
  return `zoo-foto-mini/${nomeFile.replace(/\.[a-z0-9]+$/i, "")}.webp`;
}

/** L'indirizzo della miniatura di una foto dello Zoo; per le altre immagini, l'indirizzo stesso. */
export function urlMiniatura(url: string): string {
  const m = /^(.*\/)zoo-foto\/([^/?#]+)$/.exec(url ?? "");
  if (!m) return url;
  return `${m[1]}${percorsoMiniatura(decodeURIComponent(m[2]))}`;
}
