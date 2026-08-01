/**
 * Riconoscimento dei link video usati nei corsi.
 *
 * Sono supportati i servizi che il Consorzio può usare oggi o domani:
 * - YouTube, compresi i video "non in elenco" (stesso embed dei pubblici)
 * - Bunny Stream (iframe.mediadelivery.net)
 * - Vimeo
 * - SharePoint / Microsoft Stream (link "Incorpora")
 * - URL diretto a un file video (mp4/webm/mov)
 */

export type VideoSource =
  | { kind: "iframe"; src: string; provider: "youtube" | "bunny" | "vimeo" | "sharepoint" | "generico" }
  | { kind: "file"; src: string }
  | { kind: "none" };

/** Estrae l'ID di un video YouTube da qualsiasi forma di link (watch, youtu.be, embed, shorts, live). */
function youtubeId(u: URL): string | null {
  const host = u.hostname.replace(/^www\./, "");
  if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
  if (!host.endsWith("youtube.com") && !host.endsWith("youtube-nocookie.com")) return null;
  const v = u.searchParams.get("v");
  if (v) return v;
  const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?]+)/);
  return m ? m[1] : null;
}

export function parseVideoUrl(raw: string | undefined): VideoSource {
  const value = (raw ?? "").trim();
  if (!value) return { kind: "none" };

  // Se l'utente incolla direttamente il codice <iframe src="…">, ne estraiamo l'URL.
  const iframeSrc = value.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  const candidate = iframeSrc ? iframeSrc[1] : value;

  let u: URL;
  try {
    u = new URL(candidate.startsWith("//") ? `https:${candidate}` : candidate);
  } catch {
    return { kind: "none" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { kind: "none" };

  const host = u.hostname.replace(/^www\./, "");

  const ytId = youtubeId(u);
  if (ytId) {
    // youtube-nocookie: nessun cookie di tracciamento finché il video non parte.
    const start = u.searchParams.get("t") ?? u.searchParams.get("start");
    const qs = new URLSearchParams({ rel: "0", modestbranding: "1" });
    if (start) qs.set("start", start.replace(/[^0-9]/g, "") || "0");
    return { kind: "iframe", provider: "youtube", src: `https://www.youtube-nocookie.com/embed/${ytId}?${qs}` };
  }

  if (host === "iframe.mediadelivery.net") {
    return { kind: "iframe", provider: "bunny", src: u.toString() };
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = u.pathname.split("/").filter(Boolean)[0];
    if (host === "player.vimeo.com") return { kind: "iframe", provider: "vimeo", src: u.toString() };
    if (/^\d+$/.test(id ?? "")) return { kind: "iframe", provider: "vimeo", src: `https://player.vimeo.com/video/${id}` };
  }

  if (host.endsWith("sharepoint.com") || host.endsWith("microsoftstream.com") || host.endsWith("office.com")) {
    // I link "Incorpora" di SharePoint/Stream funzionano già come src di un iframe.
    return { kind: "iframe", provider: "sharepoint", src: u.toString() };
  }

  if (/\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(u.pathname)) {
    return { kind: "file", src: u.toString() };
  }

  // Fallback: proviamo comunque a incorporarlo (utile per player aziendali interni).
  return { kind: "iframe", provider: "generico", src: u.toString() };
}

export const VIDEO_PROVIDER_LABEL: Record<string, string> = {
  youtube: "YouTube",
  bunny: "Bunny Stream",
  vimeo: "Vimeo",
  sharepoint: "SharePoint / Stream",
  generico: "Player esterno",
};
