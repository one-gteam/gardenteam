import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { segretoUguale } from "@/lib/auth";
import type { Scope } from "@/lib/stampe";
import {
  getZooDb, campagneStampabili, campaignStato, offertePerStampa, tagsPerStampa, valoriPerStampa, layoutPerOfferta,
  condizioniPer, giacenzePer, ZOO_FORMATS, NO_VOLANTINO, type ZooLayout,
} from "@/lib/zoo";

/**
 * Le offerte Zoo lette dal GESTIONALE di un'insegna o di un punto vendita
 * (per Rosàflor: Linfa), per stampare i cartelli dal proprio programma e per
 * controllare a scaffale la promo del giorno dopo, che nel gestionale arriva
 * solo quando la si carica. Chiave dall'area Connettori, colonna «Il
 * gestionale legge».
 *
 *   GET /api/zoo/offerte
 *   Authorization: Bearer gtz_…
 *   ?campagna=<id>|corso|lavorazione   (assente = in corso + in preparazione)
 *   &volantino=si|no                    (solo quelle a volantino / fuori volantino)
 *   &ean=800…,800…                       (solo questi codici a barre)
 *   &formato=za4|za5|za6                 (per i valori e il layout del cartello; assente = za5)
 *   &layout=1                            (aggiunge i layout usati, per disegnare i cartelli)
 *   &giacenze=0                          (non chiedere al gestionale giacenze e prezzi)
 *
 * Risposta: { ambito, campagne, offerte: [ { id, campagna, ean, descrizione, prezzoPromo,
 *   prezzoListino, meccanica, sconto, condizioni, volantino, propria, valori, layoutId } ],
 *   layout?, formato, condizioniStandard }.
 * I prezzi sono testi come sul cartello («19,79»); `valori` sono i campi del
 * cartello già calcolati come in Stampa cartelli (prezzo dell'insegna, prezzo
 * di partenza dal gestionale, «A SOLI», validità, EAN…).
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim() || (req.nextUrl.searchParams.get("chiave") ?? "");
  if (!token) return NextResponse.json({ error: "Manca la chiave (Authorization: Bearer …)" }, { status: 401 });
  const db = await getZooDb();
  const k = db.letture.find((x) => !!x.token && segretoUguale(token, x.token));
  if (!k) return NextResponse.json({ error: "Chiave non valida" }, { status: 403 });
  if (k.attivo === false) return NextResponse.json({ error: "Collegamento spento in GT One (area Connettori)" }, { status: 403 });

  const academyDb = await getDb();
  const nome = k.scopeType === "tenant"
    ? academyDb.tenants.find((t) => t.id === k.scopeId)?.name
    : academyDb.stores.find((s) => s.id === k.scopeId)?.name;
  if (!nome) return NextResponse.json({ error: "Insegna o punto vendita non più esistente" }, { status: 403 });
  const scope: Scope = { type: k.scopeType, id: k.scopeId, label: nome };

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const tutte = campagneStampabili(db);
  const campagne = sp.campagna === "corso" ? tutte.filter((c) => campaignStato(c) === "chiusa")
    : sp.campagna === "lavorazione" ? tutte.filter((c) => campaignStato(c) === "lavorazione")
      : sp.campagna ? db.campaigns.filter((c) => c.id === sp.campagna)
        : tutte;
  const formato = ZOO_FORMATS.find((f) => f.id === sp.formato) ?? ZOO_FORMATS.find((f) => f.id === "za5") ?? ZOO_FORMATS[0];
  const eanFiltro = new Set((sp.ean ?? "").split(",").map((x) => x.trim()).filter(Boolean));

  // le offerte di ogni campagna più le proprie dell'ambito (una volta sola)
  const viste = new Set<string>();
  const offerte = campagne.flatMap((c) => offertePerStampa(db, scope, academyDb, c))
    .filter((o) => (viste.has(o.id) ? false : (viste.add(o.id), true)))
    .filter((o) => !eanFiltro.size || eanFiltro.has(o.ean));
  const aVolantino = (o: (typeof offerte)[number]) => o.selezionata === true || (!!o.paginaId && o.paginaId !== NO_VOLANTINO);
  const scelte = sp.volantino === "si" ? offerte.filter(aVolantino) : sp.volantino === "no" ? offerte.filter((o) => !aVolantino(o)) : offerte;

  const gestionale = sp.giacenze === "0" ? {} : await giacenzePer(db, scope, academyDb, scelte.map((o) => o.ean));
  const layoutUsati: Record<string, ZooLayout> = {};
  const righe = scelte.map((o) => {
    const tags = tagsPerStampa(db, scope, academyDb, o, {});
    const layout = layoutPerOfferta(db, scope, formato.id, academyDb, o, tags);
    if (sp.layout === "1" && layout?.id) layoutUsati[layout.id] = layout;
    return {
      id: o.id,
      campagna: o.campaignId ?? null,
      ean: o.ean,
      descrizione: o.descrizione,
      prezzoPromo: o.prezzoPromo ?? "",
      prezzoListino: o.prezzoListino ?? "",
      meccanica: o.meccanica ?? "",
      sconto: o.scontoPerc ?? null,
      condizioni: o.condizioni ?? "",
      volantino: aVolantino(o),
      propria: Boolean(o.scopeType),
      valori: valoriPerStampa(db, scope, academyDb, o, {}, gestionale),
      layoutId: layout?.id ?? null,
    };
  });

  return NextResponse.json({
    ambito: { tipo: scope.type, id: scope.id, nome },
    campagne: campagne.map((c) => ({ id: c.id, nome: c.nome, dal: c.dal, al: c.al, stato: campaignStato(c) })),
    formato,
    offerte: righe,
    ...(sp.layout === "1" ? { layout: layoutUsati } : {}),
    condizioniStandard: condizioniPer(db, scope, academyDb).condizioniStandard,
  }, { headers: { "cache-control": "no-store" } });
}
