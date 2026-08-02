import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { publicUrlFor } from "@/lib/supabase";

/* Supabase Storage serve gli .html/.js come text/plain per sicurezza: qui
   ricalcoliamo il content-type dall'estensione, altrimenti il browser non
   eseguirebbe HTML e JavaScript del pacchetto SCORM. */
const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json; charset=utf-8",
  xml: "application/xml; charset=utf-8", svg: "image/svg+xml", vtt: "text/vtt",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", ico: "image/x-icon", mp3: "audio/mpeg", ogg: "audio/ogg",
  wav: "audio/wav", m4a: "audio/mp4", mp4: "video/mp4", webm: "video/webm",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  pdf: "application/pdf", txt: "text/plain; charset=utf-8",
};

/**
 * Serve i file di un pacchetto SCORM dallo STESSO origine dell'app.
 *
 * È indispensabile: un contenuto SCORM in un iframe cross-origin non può
 * raggiungere l'API dell'LMS (window.parent.API) per via della same-origin
 * policy. Qui facciamo da proxy verso Supabase Storage, così l'iframe è
 * same-origin e i percorsi relativi interni al pacchetto continuano a funzionare.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Non autorizzato", { status: 403 });

  const { path } = await ctx.params;
  // deve iniziare con "scorm/…": non si serve altro dal bucket
  if (path[0] !== "scorm" || path.some((p) => p === "..")) {
    return new NextResponse("Percorso non valido", { status: 400 });
  }
  const storagePath = path.map((p) => decodeURIComponent(p)).join("/");

  const upstream = await fetch(publicUrlFor(storagePath));
  if (!upstream.ok || !upstream.body) return new NextResponse("File non trovato", { status: 404 });

  const headers = new Headers();
  const ext = (storagePath.split(".").pop() ?? "").toLowerCase().split("?")[0];
  headers.set("content-type", TYPES[ext] ?? upstream.headers.get("content-type") ?? "application/octet-stream");
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  // i pacchetti SCORM sono immutabili una volta caricati: cache lunga
  headers.set("cache-control", "private, max-age=3600");

  return new NextResponse(upstream.body, { status: 200, headers });
}
