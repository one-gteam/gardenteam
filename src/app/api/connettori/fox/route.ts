import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getZooDb } from "@/lib/zoo";
import { writeDomain } from "@/lib/supabase";
import {
  connettoreDaChiave, dominioFotografia, leggiConnettoriFox, scriviConnettoriFox,
  type FotografiaFox, type GiacenzaFox,
} from "@/lib/fox-connettore";

/*
 * L'indirizzo del programma Fox (GTOne-Fox.exe). Con la chiave nell'intestazione
 * Authorization: Bearer gtf_…
 *
 *   GET  → { ambito, eans: [...] }  gli EAN che a GT One servono (il catalogo Zoo)
 *   POST { righe: [{ ean, codice, giacenza, prezzo }], fileAl, versione }
 *        → salva la fotografia per l'insegna/PV della chiave
 *
 * Il programma manda solo gli EAN chiesti: niente anagrafica intera, niente
 * costi. Si accettano solo numeri: un campo in più viene ignorato.
 */

const chiaveDa = (req: NextRequest) => (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim() || null;

async function nomeAmbito(tipo: string, id: string): Promise<string> {
  const db = await getDb();
  return tipo === "tenant" ? db.tenants.find((t) => t.id === id)?.name ?? id : db.stores.find((s) => s.id === id)?.name ?? id;
}

export async function GET(req: NextRequest) {
  const c = await connettoreDaChiave(chiaveDa(req));
  if (!c) return NextResponse.json({ error: "Chiave non valida o connettore spento (GT One → Connettori)." }, { status: 403 });
  const zoo = await getZooDb();
  const eans = [...new Set(zoo.products.map((p) => (p.ean ?? "").trim()).filter((e) => /^\d{6,14}$/.test(e)))];
  return NextResponse.json({ ambito: await nomeAmbito(c.scopeType, c.scopeId), eans });
}

export async function POST(req: NextRequest) {
  const c = await connettoreDaChiave(chiaveDa(req));
  if (!c) return NextResponse.json({ error: "Chiave non valida o connettore spento (GT One → Connettori)." }, { status: 403 });
  const corpo = (await req.json().catch(() => null)) as { righe?: unknown; fileAl?: unknown; versione?: unknown; parte?: unknown } | null;
  if (!corpo || !Array.isArray(corpo.righe)) return NextResponse.json({ error: "Serve { righe: [ { ean, codice, giacenza, prezzo } ] }" }, { status: 400 });
  if (corpo.righe.length > 60000) return NextResponse.json({ error: "Troppe righe in un invio." }, { status: 413 });

  const righe: Record<string, GiacenzaFox> = {};
  for (const r of corpo.righe as Record<string, unknown>[]) {
    const ean = String(r?.ean ?? "").trim();
    if (!/^\d{6,14}$/.test(ean)) continue;
    const g = Number(r.giacenza), p = Number(r.prezzo);
    righe[ean] = {
      g: Number.isFinite(g) ? Math.round(g) : 0,
      p: Number.isFinite(p) && p >= 0 && p < 100000 ? Math.round(p * 100) / 100 : 0,
      c: String(r.codice ?? "").replace(/[^\w.-]/g, "").slice(0, 20),
    };
  }
  const fileAl = typeof corpo.fileAl === "string" ? corpo.fileAl.slice(0, 40) : undefined;
  const ora = new Date().toISOString();
  const foto: FotografiaFox = { aggiornatoIl: ora, fileAl, righe };
  await writeDomain(dominioFotografia(c.scopeType, c.scopeId), foto);

  // l'ultimo invio si vede nell'area Connettori
  const voci = await leggiConnettoriFox();
  const mio = voci.find((x) => x.scopeType === c.scopeType && x.scopeId === c.scopeId);
  if (mio) {
    mio.ultimoInvio = ora;
    mio.righe = Object.keys(righe).length;
    mio.fileAl = fileAl;
    mio.versione = typeof corpo.versione === "string" ? corpo.versione.slice(0, 20) : undefined;
    await scriviConnettoriFox(voci);
  }
  return NextResponse.json({ ok: true, ambito: await nomeAmbito(c.scopeType, c.scopeId), righe: Object.keys(righe).length, ricevutoIl: ora });
}
