import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canAccessArea, gestisceArea, isZooEditor, resolveScope } from "@/lib/stampe";
import {
  getZooDb, effectiveParentText, effectiveParentTag, zooImageUrl, storicoOfferteByEan, animaliDi, caratteristicheProdottoDi,
  contenutoDa, testoContenuto, prezzoUnitaDi,
} from "@/lib/zoo";
import { listStorageFiles, publicUrlFor } from "@/lib/supabase";

/**
 * Dettaglio di un prodotto padre per il pannello che si apre in tabella
 * (Database prodotti e Offerte in corso). Prima il dettaglio era un parametro
 * dell'indirizzo e ogni "dettagli" ricaricava tutta la pagina, con le sue
 * migliaia di righe; ora la pagina chiede solo questo.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !canAccessArea(user, "zoo")) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const db = await getZooDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, req.nextUrl.searchParams.get("scope") ?? undefined, academyDb);
  const parent = db.parents.find((p) => p.id === id);
  if (!parent) return NextResponse.json({ error: "Padre non trovato" }, { status: 404 });

  const consortium = isZooEditor(user);
  const figli = db.products.filter((p) => p.parentId === parent.id);
  const storico = storicoOfferteByEan(db);
  const articoli = figli.map((p) => {
    const st = storico.get(p.ean);
    return {
      id: p.id, ean: p.ean, codice: p.codice, descrizione: p.descrizione,
      marca: p.marca || p.fornitore, fornitore: p.fornitore, prezzo: p.prezzo ?? "",
      image: p.image ?? "",
      contenuto: testoContenuto(p.contenuto ?? contenutoDa(p.descrizione)),
      contenutoManuale: !!p.contenuto,
      // l'ultima promozione nota: prezzo promo e di partenza, per capire al volo cosa si stampa
      promo: st?.promo[0]?.campaign.nome ?? "",
      offerta: (() => {
        const o = [...db.offers].reverse().find((x) => x.ean === p.ean && !x.scopeType);
        return o ? { prezzoPromo: o.prezzoPromo, prezzoListino: o.prezzoListino ?? "", meccanica: o.meccanica ?? "", prezzoUnita: prezzoUnitaDi(o, p, o.prezzoPromo) } : null;
      })(),
    };
  });

  // foto caricate e non ancora abbinate: servono a "scegli una foto dalla raccolta" (solo Consorzio)
  let fotoDisponibili: string[] = [];
  if (consortium) {
    const usate = new Set(db.products.map((p) => p.image?.split("/").pop()).filter(Boolean));
    const tutte = await listStorageFiles("zoo-foto");
    fotoDisponibili = tutte.filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f) && !usate.has(f)).slice(0, 400);
  }

  return NextResponse.json({
    consortium,
    gestione: gestisceArea(user, "zoo", scope, academyDb),
    scopeType: scope.type,
    scopeLabel: scope.label,
    parent: {
      id: parent.id,
      aiGenerated: !!parent.aiGenerated,
      nome: effectiveParentText(db, scope, parent, "nome", academyDb),
      descVolantino: effectiveParentText(db, scope, parent, "descVolantino", academyDb),
      descCartello: effectiveParentText(db, scope, parent, "descCartello", academyDb),
      animale: effectiveParentTag(db, scope, parent, "animale", academyDb),
      caratt: effectiveParentTag(db, scope, parent, "prodotto", academyDb),
      caratteristiche: parent.caratteristiche,
      animaliConsorzio: animaliDi(db, parent.caratteristiche),
      carattConsorzio: caratteristicheProdottoDi(db, parent.caratteristiche),
      image: zooImageUrl(undefined, parent) === "/immagini/mancante.jpg" && figli[0] ? zooImageUrl(figli[0]) : zooImageUrl(undefined, parent),
    },
    articoli,
    padri: db.parents
      .map((p) => ({ id: p.id, nome: effectiveParentText(db, scope, p, "nome", academyDb).value }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "it")),
    settings: {
      caratteristiche: db.settings.caratteristiche,
      categorieAnimali: db.settings.categorieAnimali,
      caratteristicheProdotto: db.settings.caratteristicheProdotto,
    },
    fotoDisponibili,
    fotoBaseUrl: publicUrlFor("zoo-foto/__ph__").slice(0, -6),
  });
}
