import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canAccessArea, resolveScope } from "@/lib/stampe";
import {
  getZooDb, campagnaPerStampa, offertePerStampa, tagsPerLayout, valoriPerStampa, effectiveZooLayout,
  effectiveParentText, effectiveParentTag, effectiveOfferText, pvPriceFor, pvListinoFor, noPrintSets, ZOO_FORMATS, giacenzePer, prezzoDaNumero,
} from "@/lib/zoo";

/**
 * Dati per l'anteprima dal vivo di Stampa cartelli: i cartelli selezionati
 * (formato, layout e valori, pronti per il componente Cartello nel browser) e
 * le righe della tabella "Personalizza". Prima si ricaricava tutta la pagina a
 * ogni "Aggiorna anteprima"; ora la pagina chiede solo questo, appena si
 * seleziona un'offerta.
 *
 * Parametri: scope, campagna, sel (id separati da virgola), formato,
 * formato_<id>, prezzo_<id>, listino_<id>, noprezzo_<id>, nascondi_<id>.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !canAccessArea(user, "zoo")) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const db = await getZooDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, sp.scope, academyDb);
  const campaign = campagnaPerStampa(db, sp.campagna);
  const allOffers = offertePerStampa(db, scope, academyDb, campaign);
  const ids = (sp.sel ?? "").split(",").filter(Boolean);
  const selected = ids.map((id) => allOffers.find((o) => o.id === id)).filter(Boolean) as typeof allOffers;
  const globalFormatId = sp.formato ?? ZOO_FORMATS[0].id;
  const formatFor = (oid: string) => ZOO_FORMATS.find((f) => f.id === (sp[`formato_${oid}`] ?? globalFormatId)) ?? ZOO_FORMATS[0];
  const noPrint = noPrintSets(db, scope);
  // giacenze e prezzi di vendita del gestionale collegato, per i soli cartelli scelti
  const gestionale = await giacenzePer(db, scope, academyDb, selected.map((o) => o.ean));

  const cartelli = selected.map((o) => {
    const format = formatFor(o.id);
    return {
      id: o.id,
      format,
      layout: effectiveZooLayout(db, scope, format.id, academyDb, tagsPerLayout(db, scope, academyDb, o)),
      values: valoriPerStampa(db, scope, academyDb, o, sp, gestionale),
    };
  });

  const righe = selected.map((o) => {
    const product = db.products.find((p) => p.id === o.productId);
    const parent = product?.parentId ? db.parents.find((x) => x.id === product.parentId) : undefined;
    return {
      id: o.id,
      ean: o.ean,
      descrizione: o.descrizione,
      parentId: parent?.id,
      nome: parent ? effectiveParentText(db, scope, parent, "nome", academyDb) : undefined,
      desc: parent ? effectiveParentText(db, scope, parent, "descCartello", academyDb) : undefined,
      animale: parent ? effectiveParentTag(db, scope, parent, "animale", academyDb) : undefined,
      caratt: parent ? effectiveParentTag(db, scope, parent, "prodotto", academyDb) : undefined,
      descOfferta: effectiveOfferText(db, scope, o, "descrizione", academyDb),
      cond: effectiveOfferText(db, scope, o, "condizioni", academyDb),
      prezzoPromo: o.prezzoPromo,
      prezzoListino: o.prezzoListino,
      meccanica: o.meccanica,
      pv: pvPriceFor(db, scope, o.ean, academyDb),
      pvListino: pvListinoFor(db, scope, o.ean, academyDb),
      listinoGestionale: prezzoDaNumero(gestionale[o.ean]?.prezzo),
      giacenza: gestionale[o.ean]?.giacenza,
      codiceGestionale: gestionale[o.ean]?.codice,
      escluso: noPrint.offerIds.has(o.id) || noPrint.eans.has(o.ean),
    };
  });

  return NextResponse.json({
    scopeType: scope.type,
    scopeLabel: scope.label,
    cartelli,
    righe,
    categorieAnimali: db.settings.categorieAnimali,
    caratteristicheProdotto: db.settings.caratteristicheProdotto,
    condizioniStandard: db.settings.condizioniStandard,
  });
}
