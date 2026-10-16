import { NextRequest, NextResponse } from "next/server";
import { segretoUguale } from "@/lib/auth";
import { getZooDb } from "@/lib/zoo";
import { rispostaZipVolantino } from "@/lib/zip-volantino";

export const maxDuration = 300;

/**
 * Il link per il grafico: chi ha l'indirizzo scarica lo ZIP del volantino
 * (Excel e foto sempre aggiornati, PDF dell'ultima generazione) senza entrare
 * in GT One. La chiave è nell'indirizzo; si rigenera o si spegne dalla Bozza.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ chiave: string }> }) {
  const { chiave } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(chiave ?? "")) return new NextResponse("Link non valido", { status: 404 });
  const db = await getZooDb();
  const campagna = db.campaigns.find((c) => c.linkGrafico?.chiave && segretoUguale(chiave, c.linkGrafico.chiave));
  if (!campagna) return new NextResponse("Link non valido o non più attivo: chiedine uno nuovo a chi prepara il volantino.", { status: 404 });
  if (!db.volantinoLayouts.some((l) => l.campaignId === campagna.id)) return new NextResponse("Volantino non ancora pronto", { status: 404 });
  const nome = `volantino_${campagna.nome.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "grafico"}.zip`;
  return rispostaZipVolantino(db, campagna.id, nome);
}
