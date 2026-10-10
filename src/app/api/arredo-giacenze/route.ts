import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getStampeDb, saveStampeDb } from "@/lib/stampe";

/**
 * Le quantità di un punto vendita mandate dal suo gestionale (Linfa o altro).
 *
 *   POST /api/arredo-giacenze
 *   Authorization: Bearer <chiave del PV, da Stampe → Catalogo online>
 *   Content-Type: application/json   { "righe": [ { "codice": "AB123", "quantita": 4 }, … ], "modo": "sostituisci" | "aggiorna" }
 *   oppure Content-Type: text/csv    codice;quantita  (una riga per prodotto, con o senza intestazione)
 *
 * «sostituisci» (predefinito) è la foto del magazzino: quello che non c'è nel
 * file va a zero. «aggiorna» tocca solo i codici mandati.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "Manca la chiave (Authorization: Bearer …)" }, { status: 401 });
  const db = await getStampeDb();
  const uguale = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const g = db.giacenze.find((x) => !!x.token && uguale(x.token, token));
  if (!g) return NextResponse.json({ error: "Chiave non valida" }, { status: 403 });

  const tipo = req.headers.get("content-type") ?? "";
  let righe: { codice: string; quantita: number }[] = [];
  let modo: "sostituisci" | "aggiorna" = "sostituisci";
  if (tipo.includes("json")) {
    const body = (await req.json().catch(() => null)) as { righe?: unknown; modo?: unknown } | null;
    if (!body || !Array.isArray(body.righe)) return NextResponse.json({ error: "Serve { righe: [ { codice, quantita } ] }" }, { status: 400 });
    if (body.modo === "aggiorna") modo = "aggiorna";
    righe = body.righe.map((r) => ({ codice: String((r as { codice?: unknown })?.codice ?? "").trim(), quantita: Number((r as { quantita?: unknown })?.quantita) }));
  } else {
    const testo = await req.text();
    if (req.nextUrl.searchParams.get("modo") === "aggiorna") modo = "aggiorna";
    righe = testo.split(/\r?\n/).map((l) => l.split(/[;,\t]/)).filter((c) => c.length >= 2)
      .map((c) => ({ codice: c[0].trim().replace(/^"|"$/g, ""), quantita: Number(c[1].trim().replace(",", ".")) }));
  }
  const codici = new Set(db.products.map((p) => p.codice));
  const buone = righe.filter((r) => r.codice && codici.has(r.codice) && Number.isFinite(r.quantita));
  if (buone.length === 0) return NextResponse.json({ error: "Nessuna riga valida: codici fornitore del catalogo e quantità numeriche", ricevute: righe.length }, { status: 400 });
  const nuove: Record<string, number> = modo === "aggiorna" ? { ...g.quantita } : {};
  for (const r of buone) nuove[r.codice] = Math.max(0, Math.floor(r.quantita));
  g.quantita = nuove;
  g.aggiornatoIl = new Date().toISOString();
  g.fonte = "api";
  await saveStampeDb(db);
  return NextResponse.json({ ok: true, modo, aggiornate: buone.length, ignorate: righe.length - buone.length, aggiornatoIl: g.aggiornatoIl });
}
