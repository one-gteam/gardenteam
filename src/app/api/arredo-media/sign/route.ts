import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canAccessArea, gestisceArea, getStampeDb, isStoreBlocked, resolveScope } from "@/lib/stampe";
import { createSignedUploadUrl, publicUrlFor } from "@/lib/supabase";

/**
 * URL firmati per caricare dal browser foto e video della scheda online
 * (galleria, apertura emozionale) e del totem: i video superano il limite del
 * body delle funzioni, quindi il file va dritto su Supabase Storage. Chi chiede
 * deve gestire l'Arredo per l'ambito indicato; il percorso è deciso qui, non
 * dal browser.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !canAccessArea(user, "arredo")) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { scope?: unknown; cartella?: unknown; fileNames?: unknown } | null;
  const academyDb = await getDb();
  const db = await getStampeDb();
  const scope = resolveScope(user, typeof body?.scope === "string" ? body.scope : undefined, academyDb);
  if (!gestisceArea(user, "arredo", scope, academyDb) || isStoreBlocked(db, scope)) return NextResponse.json({ error: "Non autorizzato per questo ambito" }, { status: 403 });

  const cartella = String(body?.cartella ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60) || "scheda";
  const fileNames = Array.isArray(body?.fileNames) ? body!.fileNames.filter((f): f is string => typeof f === "string" && f.length > 0).slice(0, 30) : [];
  const ESTENSIONI: Record<string, "foto" | "video"> = { jpg: "foto", jpeg: "foto", png: "foto", webp: "foto", avif: "foto", mp4: "video", webm: "video", mov: "video", m4v: "video" };
  const ambito = scope.type === "system" ? "gt" : `${scope.type}-${scope.id}`.replace(/[^A-Za-z0-9_-]/g, "");

  const urls = await Promise.all(fileNames.map(async (fileName) => {
    const solo = fileName.split(/[\\/]/).pop() ?? "";
    const pulito = solo.toLowerCase().replace(/[^a-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 100);
    const ext = pulito.split(".").pop() ?? "";
    const tipo = ESTENSIONI[ext];
    if (!pulito.includes(".") || !tipo) return { fileName, signedUrl: null, url: null, tipo: null };
    const percorso = `arredo-media/${ambito}/${cartella}/${Date.now().toString(36)}_${pulito}`;
    try {
      return { fileName, signedUrl: await createSignedUploadUrl(percorso), url: publicUrlFor(percorso), tipo };
    } catch {
      return { fileName, signedUrl: null, url: null, tipo: null };
    }
  }));
  return NextResponse.json({ urls });
}
