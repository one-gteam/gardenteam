import FotoMini from "@/components/stampe/FotoMini";
import type { User } from "@/lib/types";
import ColonnaOrdinabile from "@/components/stampe/ColonnaOrdinabile";
import FiltriMobile from "@/components/FiltriMobile";
import StampeHeader from "@/components/stampe/StampeHeader";
import { isZooEditor, scopesForUser, resolveScope } from "@/lib/stampe";
import { getDb } from "@/lib/db";
import { userSites } from "@/lib/types";
import { listStorageFiles, publicUrlFor } from "@/lib/supabase";
import PhotoUploader from "@/components/stampe/PhotoUploader";
import EsitoAzione from "@/components/articoli/EsitoAzione";
import BottoneConferma from "@/components/BottoneConferma";
import AggiornaOgni from "@/components/AggiornaOgni";
import { PulsanteAzione } from "@/components/AzioneSenzaRicarica";
import { lavoroAttivo } from "@/lib/zoo-ai-lavoro";
import BulkCheckbox from "@/components/stampe/BulkCheckbox";
import InlineEdit from "@/components/stampe/InlineEdit";
import InlineSelect from "@/components/stampe/InlineSelect";
import InlineMulti from "@/components/stampe/InlineMulti";
import ColumnTools from "@/components/stampe/ColumnTools";
import AvvisaColleghi from "@/components/stampe/AvvisaColleghi";
import AvanzamentoVolantino from "@/components/stampe/AvanzamentoVolantino";
import ParentQuickEdit from "@/components/stampe/ParentQuickEdit";
import { DettagliPadre, PannelloPadre } from "@/components/stampe/DettagliPadre";
import {
  getZooDb, zooImageUrl, effectiveParentText, campagnaInLavorazione, campagnaInCorso, campaignStato,
  fotoDaAbbinare, promoDaTesto, chiavePrezzo, animaliDi, caratteristicheProdottoDi, migraVolantinoPages, prezzoUnitaDi,
  NO_VOLANTINO, marcaEffettiva, prezziDelPadre, passiVolantino, nomeDestinazione, type ZooProduct, type ZooOffer, type ZooParent,
} from "@/lib/zoo";
import {
  interpretaPromoScritte, avviaAssociaConAI, chiudiAvvisoAssocia,
  importZooOffers, updateCampaignDates, associaNuoviConAI, finalizeZooPhotoUpload,
  createZooParent, associaConAI, rigeneraTestiAI, saveParentTexts, setParentImage,
  toggleParentCaratteristica, scioglieParent, chiudiVolantino, riapriVolantino, nuovoVolantino,
  svuotaOfferteVolantino, rimuoviOfferteMarginiamo, updateParentFieldInline, updateOfferFieldInline,
  updateOfferGroupFieldInline, setParentTagInline, moveProductToParent, setParentImageFromFile,
  mergeParentsForm, archiviaOfferteSelezionate, aggiungiOffertaAMano, dividiPadrePerPrezzo, dividiTuttiIPadriPerPrezzo, setTipologiaInline, setParentAnimaliInline } from "@/lib/zoo-actions";

// "Associa con AI" può richiedere più dei 10s di default per un lotto di articoli:
// alza il limite dove la piattaforma lo consente (vale anche per le server action
// invocate da questa pagina, non solo per il render).
export const maxDuration = 300; // "Associa tutti con l'AI" continua in background dopo la risposta

/** Le azioni su foto e padri tornano qui (le stesse servono a "Database prodotti"). */
const BACK = "/stampe/zoo/prodotti";
const VISTA: string = "offerte";

/** Ricostruisce la query string corrente, con delle sovrascritture (undefined = togli il parametro). */
function pageQs(sp: Record<string, string | undefined>, overrides: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  const merged = { ...sp, ...overrides };
  for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
  return params.toString();
}

/** Ricostruisce la query string corrente cambiando solo "vista" (mantiene ricerca/filtri). */
function vistaQs(sp: Record<string, string | undefined>, scopeParam: string, vista: string): string {
  return pageQs(sp, { scope: scopeParam, vista });
}

/**
 * Offerte in corso: la pagina di partenza del volantino IN LAVORAZIONE. Qui dentro
 * si fa tutto quello che serve a quel volantino — caricare l'Excel, caricare le
 * foto, raggruppare gli articoli in prodotti padre (a mano o con l'AI) e scrivere
 * i testi — senza dover passare dal database prodotti generale.
 */
export default async function OfferteInCorso({ user, sp }: { user: User; sp: Record<string, string | undefined> }) {

  /*
   * Le tre letture (blob zoo, database Academy, elenco foto nel bucket) sono
   * indipendenti: in sequenza sommavano i rispettivi tempi di rete (~0,7 s prima
   * ancora di iniziare a comporre la pagina), in parallelo pesa solo la più lenta.
   */
  const [db, academyDb, tutteLeFoto] = await Promise.all([
    getZooDb(),
    getDb(),
    listStorageFiles("zoo-foto"),
  ]);
  const scopes = scopesForUser(user, academyDb);
  const scope = resolveScope(user, sp.scope, academyDb);
  const scopeParam = `${scope.type}:${scope.id}`;
  const consortium = isZooEditor(user);

  /* chi ha accesso alle Offerte Zoo: sono i destinatari proposti per l'avviso */
  const colleghiZoo = academyDb.users
    .filter((u) => u.active !== false && u.email && userSites(u).includes("zoo"))
    .map((u) => ({
      email: u.email,
      nome: `${u.firstName} ${u.lastName}`,
      ambito: academyDb.stores.find((s) => s.id === u.storeId)?.name
        ?? academyDb.tenants.find((t) => t.id === u.tenantId)?.name
        ?? "Consorzio",
    }));

  const campaign = campagnaInLavorazione(db);
  const inCorso = campagnaInCorso(db);
  const offers = campaign ? db.offers.filter((o) => o.campaignId === campaign.id) : [];
  const focusEsistenti = [...new Set(offers.map((o) => (o.focus ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  /*
   * Indici per id: con oltre mille articoli e centinaia di offerte, cercare con
   * `.find()` dentro il ciclo delle righe costa quadratico e si sentiva.
   */
  const prodById = new Map(db.products.map((p) => [p.id, p]));
  const parentById = new Map(db.parents.map((p) => [p.id, p]));

  // articoli di QUESTO volantino: è su questi che si lavora, non su tutto il database
  // (senza ripetizioni: più offerte possono puntare allo stesso articolo)
  const offerProducts = [
    ...new Map(
      offers
        .map((o) => prodById.get(o.productId ?? ""))
        .filter((p): p is ZooProduct => Boolean(p))
        .map((p) => [p.id, p])
    ).values(),
  ];
  const senzaPadre = offerProducts.filter((p) => !p.parentId);


  /*
   * Le foto da abbinare non si propongono più qui: all'apertura di un volantino
   * distraevano da quello che c'è da fare. Restano nel Database prodotti, dove
   * si possono abbinare o ignorare; qui si dice solo quante sono.
   */
  // promo scritte a parole ancora da tradurre (volantini caricati prima del traduttore)
  const promoDaTradurre = consortium && campaign
    ? offers.filter((o) => !o.prezzoPromo && !o.promoTesto && promoDaTesto(o.condizioni ?? "").tipo !== "sconosciuta")
    : [];
  const nDaAbbinare = consortium && campaign ? fotoDaAbbinare(db, tutteLeFoto).daAbbinare.length : 0;

  // offerte "marginiamo": nessuna promo dal fornitore, il PV decide il margine da sé — non sono offerte vere
  const marginiamo = offers.filter((o) => (o.condizioni ?? "").trim().toLowerCase() === "marginiamo");

  const fmt = (d?: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("it-IT") : "—");

  /*
   * Pagine del volantino: la tendina "Pagina" prende le pagine vere del builder
   * (Crea Volantino), così assegnare qui una pagina la fa già trovare pronta là.
   */
  const layout = campaign ? db.volantinoLayouts.find((l) => l.campaignId === campaign.id) : undefined;
  const pagineVolantino = layout
    ? migraVolantinoPages(layout.pages).map((p, i) => ({ id: p.id, nome: `${i + 1}. ${p.titolo || `Pagina ${i + 1}`}` }))
    : [];
  const nomePagina = new Map(pagineVolantino.map((p) => [p.id, p.nome]));

  // valori disponibili per i filtri, calcolati sulle offerte di questo volantino
  const parentOf = (o: ZooOffer) => {
    const pid = prodById.get(o.productId ?? "")?.parentId;
    return pid ? parentById.get(pid) : undefined;
  };
  const marcheList = [...new Set(offerProducts.map(marcaEffettiva).filter(Boolean))].sort();
  const fornitoriList = [...new Set(offerProducts.map((p) => p.fornitore).filter(Boolean))].sort();
  const tipiPromo = [...new Set(offers.map((o) => (o.condizioni ?? "").trim()).filter(Boolean))].sort();

  const q = (sp.q ?? "").toLowerCase();
  const visibili = offers.filter((o) => {
    const prod = prodById.get(o.productId ?? "");
    if (sp.senzapadre === "1" && prod?.parentId) return false;
    if (sp.marca && (!prod || marcaEffettiva(prod) !== sp.marca)) return false;
    if (sp.fornitore && prod?.fornitore !== sp.fornitore) return false;
    if (sp.tipopromo && (o.condizioni ?? "").trim() !== sp.tipopromo) return false;
    // a volantino = scelta in Scelta offerte Volantino (ha una pagina, non «no volantino»)
    const aVolantino = Boolean(o.selezionata) && o.paginaId !== NO_VOLANTINO;
    if (sp.volantino === "si" && !aVolantino) return false;
    if (sp.volantino === "no" && aVolantino) return false;
    if (sp.animale || sp.caratt) {
      const caratts = parentOf(o)?.caratteristiche ?? [];
      if (sp.animale && !caratts.includes(sp.animale)) return false;
      if (sp.caratt && !caratts.includes(sp.caratt)) return false;
    }
    if (q) {
      // "royal" deve trovare anche chi ha Royal solo nel nome del padre o nella marca
      const parent = parentOf(o);
      const testo = `${o.descrizione} ${o.ean} ${prod?.descrizione ?? ""} ${prod?.codice ?? ""} ${parent?.nome ?? ""} ${parent?.descVolantino ?? ""} ${prod ? marcaEffettiva(prod) : ""} ${prod?.fornitore ?? ""}`.toLowerCase();
      if (!q.split(/\s+/).filter(Boolean).every((parola) => testo.includes(parola))) return false;
    }
    return true;
  });

  /*
   * Vista raggruppata (default): una riga per padre invece che una per articolo.
   * Con centinaia di offerte è molto più leggera da caricare e da scorrere, ed è
   * anche il modo naturale di navigare i padri (sostituisce il vecchio elenco a
   * pillole, scomodo oltre la decina di prodotti padre).
   */
  const vistaArticoli = sp.vista === "articoli";
  const gruppi = (() => {
    const map = new Map<string, { parent?: (typeof db.parents)[number]; offs: ZooOffer[] }>();
    for (const o of visibili) {
      const product = prodById.get(o.productId ?? "");
      const parent = product?.parentId ? parentById.get(product.parentId) : undefined;
      // padre + prezzo: gli articoli di un padre a prezzi diversi sono righe separate (come i loro cartelli)
      const key = parent ? `${parent.id}~${chiavePrezzo(o)}` : `_o_${o.id}`;
      const g = map.get(key) ?? { parent, offs: [] };
      g.offs.push(o);
      map.set(key, g);
    }
    return [...map.values()];
  })();
  const RIGHE_MAX = 300;
  const gruppiVisibili = gruppi.slice(0, RIGHE_MAX);
  /*
   * Padri "sbagliati" da sistemare: quelli con più prezzi (vanno divisi, un
   * padre per formato) e quelli senza animale (l'AI non l'ha riconosciuto: si
   * assegna a mano, altrimenti il filtro per animale non li trova).
   */
  const padriInOfferta = [...new Set(offers.map((o) => parentOf(o)).filter(Boolean) as ZooParent[])];
  const padriConPiuPrezzi = campaign ? padriInOfferta.filter((p) => prezziDelPadre(db, p.id, campaign.id).length > 1) : [];
  const padriSenzaAnimale = padriInOfferta.filter((p) => animaliDi(db, p.caratteristiche).length === 0);
  const offerteSenzaPadre = offers.filter((o) => !parentOf(o)).length;
  const visibiliCap = visibili.slice(0, RIGHE_MAX);
  const nCols = ((consortium ? 1 : 0) + (vistaArticoli ? 17 : 16)) + 1;


  return (
    <div>
      <StampeHeader user={user} active="prodotti" area="zoo" />
      <div className="container">
        <div className="testata-compatta">
          <h1 style={{ margin: 0, fontSize: 24, whiteSpace: "nowrap" }}>Prodotti</h1>
          <div className="sottoschede-prodotti">
            <a className={`pill ${VISTA === "offerte" ? "pill-blue" : "pill-gray"}`} href={`/stampe/zoo/prodotti?scope=${scopeParam}`}>Offerte in corso</a>
            <a className={`pill ${VISTA === "catalogo" ? "pill-blue" : "pill-gray"}`} href={`/stampe/zoo/prodotti?vista=catalogo&scope=${scopeParam}`}>Tutto il catalogo</a>
          </div>
          <span style={{ flex: 1 }} />
          {campaign && (
            <a className="btn btn-outline btn-sm" href={`/stampe/zoo/excel?singole=1&scope=${scopeParam}${sp.volantino === "si" ? "&volantino=1" : ""}`}
              title="Tutte le offerte del volantino in lavorazione, una riga per articolo (con filtro «a volantino»: solo quelle scelte)">
              ⬇ Excel offerte{sp.volantino === "si" ? " a volantino" : ""}
            </a>
          )}
          {consortium && (
            <a className="btn btn-outline btn-sm" href={`/stampe/zoo/prodotti?vista=catalogo&scope=${scopeParam}&abbina=1`}
              title="Importare l'Excel dei prodotti e abbinare le foto si fa dal catalogo">
              Excel prodotti / Abbina foto{nDaAbbinare > 0 ? ` (${nDaAbbinare})` : ""}
            </a>
          )}
          {consortium && campaign && (
            <details className="strumento" open={sp.importate !== undefined}>
              <summary className="btn btn-outline btn-sm">Carica l&apos;Excel delle offerte</summary>
              <div className="card" style={{ marginTop: 10, padding: 14 }}>
                <strong>Carica l&apos;Excel delle offerte</strong>
                <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 8px" }}>
                  L&apos;Excel si confronta con il database per EAN: dati e foto già presenti si riusano, i prodotti
                  nuovi entrano nel database. Colonne: EAN, DESCRIZIONE PROMO, PREZZO PROMO, PREZZO LISTINO, CONDIZIONI (+ MARCA/FORNITORE per i
                  prodotti nuovi). Riconosce anche i listini multi-fornitore con l&apos;intestazione (FORNITORE, EAN,
                  NR. ARTICOLO FORNITORE, TESTO BREVE, PREZZO DI VENDITA…) ripetuta prima di ogni fornitore. Puoi
                  caricare più file sullo stesso volantino.{" "}
                  <a href={`/stampe/zoo/excel?offerte=1&scope=${scopeParam}`}>Scarica il modello</a>
                </p>
                <form action={importZooOffers.bind(null, scopeParam)} style={{ display: "grid", gap: 8 }}>
                  <input type="file" name="file" accept=".xlsx,.xls,.csv" required />
                  <label style={{ fontSize: 12.5 }}>
                    <input type="checkbox" name="sostituisci" value="1" /> sostituisci le offerte già caricate
                  </label>
                  <label style={{ fontSize: 12.5 }}>
                    <input type="checkbox" name="escludimarginiamo" value="1" defaultChecked />{" "}
                    escludi le righe &quot;marginiamo&quot; (nessuna promo dal fornitore, decide il PV): non entrano
                    come offerta, l&apos;articolo resta comunque nel database
                  </label>
                  <button className="btn btn-sm" type="submit">Importa offerte</button>
                </form>
              </div>
            </details>
          )}
          {consortium && campaign && (
            <details className="strumento" open={sp.foto !== undefined}>
              <summary className="btn btn-outline btn-sm">Caricamento foto</summary>
              <div className="card" style={{ marginTop: 10, padding: 14 }}>
                <strong>Caricamento foto</strong>
                <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 8px" }}>
                  Puoi selezionare anche centinaia di foto insieme (caricate direttamente, niente limiti di
                  dimensione): se il nome del file contiene l&apos;EAN o il codice fornitore, l&apos;abbinamento è
                  automatico. Ogni articolo ha la sua foto; nel padre si sceglie quella di riferimento.
                </p>
                <PhotoUploader back={BACK} scopeParam={scopeParam} finalize={finalizeZooPhotoUpload} />
                {nDaAbbinare > 0 && (
                  <p className="hint" style={{ marginTop: 6 }}>
                    Le foto senza EAN o codice nel nome ({nDaAbbinare}) si abbinano, o si ignorano, dal{" "}
                    <a href={`/stampe/zoo/prodotti?vista=catalogo&scope=${scopeParam}&abbina=1`}>catalogo</a>.
                  </p>
                )}
              </div>
            </details>
          )}
          {consortium && campaign && (
            <details className="strumento" open={sp.aggiunta !== undefined && sp.aggiunta !== "ok"}>
              <summary className="btn btn-outline btn-sm">+ Offerta a mano</summary>
              <div className="card" style={{ marginTop: 10, padding: 14, minWidth: 320 }}>
                <strong>Aggiungi un&apos;offerta a mano</strong>
                <p className="hint" style={{ margin: "4px 0 8px" }}>
                  Entra nel volantino in lavorazione come quelle dell&apos;Excel. Se l&apos;EAN è già nel database bastano EAN e
                  prezzo; se è nuovo servono anche descrizione, marca e fornitore (l&apos;articolo si crea senza padre).
                </p>
                <form action={aggiungiOffertaAMano.bind(null, scopeParam)} style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                  <label className="field" style={{ marginBottom: 0 }}>EAN<input type="text" name="ean" required inputMode="numeric" /></label>
                  <label className="field" style={{ marginBottom: 0 }}>Prezzo promo €<input type="text" name="prezzoPromo" placeholder="es. 3,99" /></label>
                  <label className="field" style={{ marginBottom: 0 }}>Prezzo di partenza €<input type="text" name="prezzoListino" placeholder="es. 4,69" /></label>
                  <label className="field" style={{ marginBottom: 0 }}>Meccanica<input type="text" name="meccanica" placeholder="es. 3x2 (anche senza prezzo)" /></label>
                  <label className="field" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>Descrizione<input type="text" name="descrizione" placeholder="obbligatoria se l'articolo è nuovo" /></label>
                  <label className="field" style={{ marginBottom: 0 }}>Marca<input type="text" name="marca" /></label>
                  <label className="field" style={{ marginBottom: 0 }}>Fornitore<input type="text" name="fornitore" /></label>
                  <label className="field" style={{ marginBottom: 0 }}>Codice fornitore<input type="text" name="codice" /></label>
                  <label className="field" style={{ marginBottom: 0 }}>Condizioni<input type="text" name="condizioni" placeholder="es. fino a esaurimento" /></label>
                  <button className="btn btn-sm" type="submit" style={{ gridColumn: "1 / -1", justifySelf: "start" }}>Aggiungi al volantino</button>
                </form>
              </div>
            </details>
          )}
          {consortium && campaign && <AvvisaColleghi tipo="offerte" scopeParam={scopeParam} colleghi={colleghiZoo} />}
          <form method="get" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ fontSize: 12.5, fontWeight: 700 }}>
              Insegna / PV{" "}
              <select name="scope" defaultValue={scopeParam} style={{ marginTop: 2 }}>
                {scopes.map((s) => (
                  <option key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>{s.label}</option>
                ))}
              </select>
            </label>
            <button className="btn btn-sm" type="submit">OK</button>
          </form>
        </div>

        {sp.aggiunta === "ok" && <div className="alert alert-green">✓ Offerta aggiunta al volantino.</div>}
        {sp.aggiunta && sp.aggiunta !== "ok" && (
          <div className="alert alert-amber">
            {sp.aggiunta === "dati" ? "Servono l'EAN e un prezzo promo (o una meccanica)."
              : sp.aggiunta === "descrizione" ? "EAN nuovo: serve anche la descrizione dell'articolo."
              : sp.aggiunta === "doppia" ? "Questo articolo è già in offerta in questo volantino."
              : sp.aggiunta === "ambito" ? "Le offerte a mano del volantino comune si aggiungono dall'ambito Consorzio; per un cartello proprio usa Stampa cartelli."
              : sp.aggiunta === "volantino" ? "Nessun volantino in lavorazione." : "Non consentito."}
          </div>
        )}
        {consortium && campaign && (padriSenzaAnimale.length > 0 || offerteSenzaPadre > 0) && (
          <div className="alert alert-amber" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span>
              ⚠ Da sistemare a mano:
              {padriSenzaAnimale.length > 0 && <> <strong>{padriSenzaAnimale.length}</strong> padri senza animale (segnati «senza animale» in tabella)</>}
              {padriSenzaAnimale.length > 0 && offerteSenzaPadre > 0 && " ·"}
              {offerteSenzaPadre > 0 && <> <strong>{offerteSenzaPadre}</strong> offerte senza padre</>}
            </span>
            <a className="btn btn-outline btn-sm" href={`/stampe/zoo/prodotti?vista=catalogo&scope=${scopeParam}&senzaanimale=1`}>Vedi nel catalogo</a>
          </div>
        )}
        {sp.divisi !== undefined && <div className="alert alert-green">✓ {sp.divisi} padri divisi per prezzo: controlla nomi e descrizioni delle nuove righe.</div>}
        {sp.importate !== undefined && (
          <div className="alert alert-green">
            ✓ Importate {sp.importate} offerte ({sp.nuovi ?? 0} prodotti nuovi aggiunti al database base).
            {sp.senzaprezzo && ` ${sp.senzaprezzo} senza prezzo promo (vedi condizioni): da completare a mano.`}
            {sp.esclusemarginiamo && ` ${sp.esclusemarginiamo} righe "marginiamo" escluse dalle offerte.`}
            {sp.aggiornate && ` ${sp.aggiornate} erano già in offerta (anche a mano): aggiornate, non duplicate.`}
          </div>
        )}
        {sp.padri !== undefined && (
          <div className="alert alert-green">
            ✓ Creati {sp.padri} prodotti padre {sp.ai === "1" ? "con l'AI" : "con raggruppamento automatico (testi bozza)"}.
            {sp.restanti && ` Ne restano ${sp.restanti} da raggruppare: si lavora a lotti, ripeti l'operazione per continuare.`}
            {sp.aierr && <span style={{ color: "#a33" }}> Nota AI: {sp.aierr}</span>}
          </div>
        )}
        {sp.foto !== undefined && (
          <div className="alert alert-green">✓ {sp.foto} foto caricate, {sp.abbinate} abbinate in automatico per EAN/codice.</div>
        )}
        {sp.abbinatenome !== undefined && (
          <div className="alert alert-green">✓ {sp.abbinatenome} foto abbinate per nome.</div>
        )}
        {sp.unificati !== undefined && (
          sp.unificati === "0"
            ? <div className="alert alert-amber">Per unire servono almeno due prodotti padre spuntati.</div>
            : <div className="alert alert-green">✓ {sp.unificati} prodotti padre uniti in uno: controlla i testi del padre risultante qui sotto.</div>
        )}
        {sp.chiuso && (
          <div className="alert alert-green">
            ✓ Volantino chiuso. Le offerte restano stampabili in Stampa cartelli finché sono in corso; quando sarai
            pronto apri il volantino successivo qui sotto.
          </div>
        )}

        {sp.archiviate !== undefined && (
          <div className="alert alert-green">✓ {sp.archiviate} offerte archiviate: escono dal volantino, articoli e padri restano.</div>
        )}
        {sp.svuotato !== undefined && (
          <div className="alert alert-green">✓ Eliminate {sp.svuotato} offerte: carica di nuovo l&apos;Excel qui sotto.</div>
        )}
        {sp.rimossemarginiamo !== undefined && (
          <div className="alert alert-green">✓ Rimosse {sp.rimossemarginiamo} offerte &quot;marginiamo&quot;.</div>
        )}
        {sp.nuovo && <div className="alert alert-green">✓ Nuovo volantino aperto: le pagine ripartono pulite.</div>}
        {campaign && <AvanzamentoVolantino passi={passiVolantino(db, campaign)} campaignId={campaign.id} puoSegnare={consortium} />}
        {sp.riaperto && <div className="alert alert-green">✓ Volantino riaperto: puoi modificarlo di nuovo.</div>}
        {sp.errore === "giaaperto" && (
          <div className="alert alert-amber">
            C&apos;è già un volantino in lavorazione: chiudilo prima di aprirne un altro.
          </div>
        )}

        {/* ---------- stato del volantino: chiudi / apri il successivo ---------- */}
        {consortium && (
          <div className="card" style={{ marginBottom: 10, padding: "8px 12px" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              {campaign ? (
                <>
                  <span className="pill pill-blue">in lavorazione</span>
                  <strong>{campaign.nome}</strong>
                  <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                    {fmt(campaign.dal)} → {fmt(campaign.al)} · {offers.length} offerte
                  </span>
                  <details className="strumento">
                    <summary className="mini-btn" title="Cambia nome e date del volantino">✎ nome e date</summary>
                    <div className="card" style={{ marginTop: 8, padding: 12 }}>
                      <form action={updateCampaignDates.bind(null, campaign.id, scopeParam)} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
                        <label className="field" style={{ marginBottom: 0 }}>Nome<input type="text" name="nome" defaultValue={campaign.nome} /></label>
                        <label className="field" style={{ marginBottom: 0 }}>Dal<input type="date" name="dal" defaultValue={campaign.dal} /></label>
                        <label className="field" style={{ marginBottom: 0 }}>Al<input type="date" name="al" defaultValue={campaign.al} /></label>
                        <button className="btn btn-sm" type="submit">Salva</button>
                      </form>
                    </div>
                  </details>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    {offers.length > 0 && (
                      <form action={svuotaOfferteVolantino.bind(null, campaign.id, scopeParam)}>
                        <BottoneConferma title="Elimina tutte le offerte di questo volantino per ricaricare l'Excel da zero"
                          messaggio={`Eliminare tutte le ${offers.length} offerte del volantino «${campaign.nome}», con i voti dei punti vendita? Non si può annullare.`}>
                          Elimina tutte le offerte
                        </BottoneConferma>
                      </form>
                    )}
                    <form action={chiudiVolantino.bind(null, campaign.id, scopeParam)}>
                      <button className="btn btn-sm" type="submit" title="Il lavoro è finito: le offerte partono e si stampano i cartelli">
                        Chiudi volantino
                      </button>
                    </form>
                  </div>
                </>
              ) : (
                <>
                  <span className="pill pill-gray">nessun volantino in lavorazione</span>
                  {inCorso && (
                    <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                      In corso: <strong>{inCorso.nome}</strong> ({fmt(inCorso.dal)} → {fmt(inCorso.al)})
                    </span>
                  )}
                </>
              )}
            </div>

            {/* apertura del volantino successivo: archivia quello chiuso e riparte pulito */}
            {!campaign && (
              <details style={{ marginTop: 12 }} open>
                <summary style={{ cursor: "pointer", fontWeight: 700 }}>Nuovo volantino</summary>
                <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 8px" }}>
                  {inCorso
                    ? <>Il volantino <strong>{inCorso.nome}</strong> verrà archiviato: le sue offerte escono da queste pagine (restano recuperabili da Archivio volantini) e si riparte da pagine pulite.</>
                    : "Apre il primo volantino: poi carica l'Excel delle offerte qui sotto."}
                </p>
                <form action={nuovoVolantino.bind(null, scopeParam)} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 10, alignItems: "end" }}>
                  <label className="field" style={{ marginBottom: 0 }}>
                    Nome<input type="text" name="nome" placeholder="es. Offerte Ottobre" />
                  </label>
                  <label className="field" style={{ marginBottom: 0 }}>Valido dal<input type="date" name="dal" /></label>
                  <label className="field" style={{ marginBottom: 0 }}>al<input type="date" name="al" /></label>
                  <button className="btn" type="submit">Apri nuovo volantino</button>
                  {inCorso && (
                    <label style={{ fontSize: 12.5, gridColumn: "1 / -1" }}>
                      <input type="checkbox" name="ereditaSchema" value="1" defaultChecked />{" "}
                      Riparti dall&apos;impaginazione del volantino precedente (senza le sue offerte)
                    </label>
                  )}
                </form>
              </details>
            )}

            {/* rimettere in lavorazione l'ultimo chiuso, per correzioni */}
            {!campaign && inCorso && campaignStato(inCorso) === "chiusa" && (
              <form action={riapriVolantino.bind(null, inCorso.id, scopeParam)} style={{ marginTop: 8 }}>
                <button className="btn btn-outline btn-sm" type="submit">
                  Riapri &quot;{inCorso.nome}&quot; per correggerlo
                </button>
              </form>
            )}
          </div>
        )}


        {/* ---------- offerte "marginiamo" già importate: rimozione in blocco ---------- */}
        {consortium && campaign && marginiamo.length > 0 && (
          <div className="alert alert-amber" style={{ marginBottom: 14 }}>
            <strong>{marginiamo.length} offerte &quot;marginiamo&quot;</strong> (nessuna promo dal fornitore, decide il
            PV): non sono offerte vere, non dovrebbero comparire nei cartelli.{" "}
            <form action={rimuoviOfferteMarginiamo.bind(null, campaign.id, scopeParam)} style={{ display: "inline" }}>
              <BottoneConferma className="btn btn-sm" messaggio={`Rimuovere le ${marginiamo.length} offerte «marginiamo» da questo volantino?`}>Rimuovile</BottoneConferma>
            </form>
          </div>
        )}

        {promoDaTradurre.length > 0 && campaign && (
          <div className="alert alert-amber" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 260 }}>
              <strong>{promoDaTradurre.length} promo scritte a parole</strong> (es. «{promoDaTradurre[0].condizioni}»): traducile in
              sconto con il prezzo scontato calcolato dal prezzo di vendita, in meccanica (3x2) o in «marginiamo».
            </span>
            <EsitoAzione azione={interpretaPromoScritte.bind(null, campaign.id)} etichetta="Traduci le promo scritte" />
          </div>
        )}



        {!campaign ? (
          <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
            Nessun volantino in lavorazione: aprine uno qui sopra per ricominciare da pagine pulite.
          </div>
        ) : (
          <>
            {/* ---------- avanzamento di "Associa tutti con l'AI" (lavora in background) ---------- */}
            {consortium && db.settings.aiLavoro && (() => {
              const l = db.settings.aiLavoro;
              const attivo = lavoroAttivo(l);
              const morto = l.stato === "in corso" && !attivo;
              const perc = l.totale ? Math.round((l.fatti / l.totale) * 100) : 0;
              return (
                <div className={`alert ${l.stato === "errore" || morto ? "alert-amber" : attivo ? "" : "alert-green"}`}
                  style={{ marginBottom: 14, ...(attivo ? { background: "#f3ecfb", border: "1px solid #d9c6f2" } : {}) }}>
                  {attivo && <AggiornaOgni secondi={15} />}
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <strong style={{ flex: 1 }}>
                      {attivo && `⏳ Associazione con l'AI in corso: ${l.fatti} di ${l.totale} articoli, ${l.padri} padri creati.`}
                      {l.stato === "finito" && `✓ Associazione finita: ${l.padri} padri creati su ${l.fatti} articoli.`}
                      {l.stato === "errore" && `Associazione interrotta dopo ${l.fatti} di ${l.totale} articoli (${l.padri} padri creati).`}
                      {morto && `L'associazione si è fermata a ${l.fatti} di ${l.totale} articoli senza finire.`}
                    </strong>
                    {!attivo && <PulsanteAzione azione={chiudiAvvisoAssocia}>Chiudi</PulsanteAzione>}
                  </div>
                  {attivo && <div className="barra-lettura" style={{ marginTop: 8 }}><span style={{ width: `${perc}%` }} /></div>}
                  {l.stato === "errore" && l.errore && <div style={{ marginTop: 6, fontSize: 13 }}>Motivo: {l.errore}</div>}
                  {(l.restanti ?? 0) > 0 && l.stato === "finito" && (
                    <div style={{ marginTop: 6, fontSize: 13 }}>Ne restano {l.restanti}: il lavoro non è riuscito a ripartire da solo, premi di nuovo «Associa tutti con l&apos;AI» per continuare.</div>
                  )}
                  {(morto || l.stato === "errore") && <div style={{ marginTop: 6, fontSize: 13 }}>Quello che è già stato fatto resta salvato: puoi ripremere il pulsante per continuare.</div>}
                  {attivo && <div className="hint" style={{ marginTop: 6 }}>4 lotti alla volta; se serve più tempo riparte da solo{(l.giro ?? 1) > 1 ? ` (giro ${l.giro})` : ""}. Puoi continuare a lavorare o chiudere la pagina.</div>}
                </div>
              );
            })()}

            {/* ---------- raggruppamento: a mano o con l'AI ---------- */}
            {consortium && senzaPadre.length > 0 && (
              <div className="alert" style={{ background: "#f3ecfb", border: "1px solid #d9c6f2", marginBottom: 14 }}>
                <strong>{senzaPadre.length} articoli di questo volantino non hanno un prodotto padre.</strong>{" "}
                Raggruppali per avere una sola voce a volantino con un solo testo (es. le scatolette nei vari gusti).{" "}
                {!lavoroAttivo(db.settings.aiLavoro) && (
                  <EsitoAzione azione={avviaAssociaConAI} etichetta="Associa tutti con l'AI e genera i testi" />
                )}{" "}
                <span className="hint">
                  oppure spunta gli articoli nella tabella e usa i pulsanti qui sotto. Non tutti gli articoli hanno
                  bisogno di un padre: quelli unici si lasciano così come sono.
                </span>
              </div>
            )}

            {/* filtri + vista: una riga; il modulo dei filtri si apre solo quando serve */}
            <details className="card filtri-compatti" style={{ marginBottom: 10, padding: "8px 12px" }} open={Boolean((sp.q || sp.animale || sp.caratt || sp.marca || sp.fornitore || sp.tipopromo || sp.volantino || sp.senzapadre === "1"))}>
              <summary style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", cursor: "pointer", listStyle: "none" }}>
                <a className={`pill ${!vistaArticoli ? "pill-blue" : "pill-gray"}`} style={{ textDecoration: "none" }}
                  href={`${BACK}?${vistaQs(sp, scopeParam, "raggruppata")}`}>
                  Vista raggruppata ({gruppi.length})
                </a>
                <a className={`pill ${vistaArticoli ? "pill-blue" : "pill-gray"}`} style={{ textDecoration: "none" }}
                  href={`${BACK}?${vistaQs(sp, scopeParam, "articoli")}`}>
                  Vista articoli singoli ({visibili.length})
                </a>
                <span className="hint" style={{ fontSize: 12 }}>
                  {visibili.length === offers.length ? `${offers.length} offerte` : `${visibili.length} offerte su ${offers.length} (filtrate)`}
                </span>
                <span className="btn btn-outline btn-sm" style={{ marginLeft: "auto" }}>
                  ⚲ Filtri{(sp.q || sp.animale || sp.caratt || sp.marca || sp.fornitore || sp.tipopromo || sp.volantino || sp.senzapadre === "1") ? " (attivi)" : ""}
                </span>
              </summary>
              <div style={{ marginTop: 10 }}>
              <FiltriMobile id="filtri-offerte" scelte={[
                vistaArticoli ? "articoli singoli" : "raggruppata",
                sp.q && `«${sp.q}»`, sp.animale, sp.caratt, sp.marca, sp.fornitore, sp.tipopromo,
                sp.volantino === "si" ? "a volantino" : sp.volantino === "no" ? "non a volantino" : undefined,
                sp.senzapadre === "1" && "solo senza padre",
              ]}>
              <form method="get" style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr)) auto", gap: 10, alignItems: "end" }}>
                <input type="hidden" name="scope" value={scopeParam} />
                <input type="hidden" name="vista" value={vistaArticoli ? "articoli" : "raggruppata"} />
                <label className="field" style={{ marginBottom: 0 }}>
                  Cerca<input type="text" name="q" defaultValue={sp.q ?? ""} placeholder="descrizione o EAN" />
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  Animale
                  <select name="animale" defaultValue={sp.animale ?? ""}>
                    <option value="">Tutti</option>
                    {db.settings.categorieAnimali.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  Caratteristica
                  <select name="caratt" defaultValue={sp.caratt ?? ""}>
                    <option value="">Tutte</option>
                    {db.settings.caratteristicheProdotto.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  Marca
                  <select name="marca" defaultValue={sp.marca ?? ""}>
                    <option value="">Tutte</option>
                    {marcheList.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  Fornitore
                  <select name="fornitore" defaultValue={sp.fornitore ?? ""}>
                    <option value="">Tutti</option>
                    {fornitoriList.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  Tipo promo
                  <select name="tipopromo" defaultValue={sp.tipopromo ?? ""}>
                    <option value="">Tutti</option>
                    {tipiPromo.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  Volantino
                  <select name="volantino" defaultValue={sp.volantino ?? ""}>
                    <option value="">Tutte</option>
                    <option value="si">a volantino (scelte)</option>
                    <option value="no">non a volantino</option>
                  </select>
                </label>
                <button className="btn btn-sm" type="submit">Filtra</button>
                <label style={{ fontSize: 12.5, gridColumn: "1 / -1" }}>
                  <input type="checkbox" name="senzapadre" value="1" defaultChecked={sp.senzapadre === "1"} /> solo senza padre
                  {(sp.animale || sp.caratt || sp.marca || sp.fornitore || sp.tipopromo || sp.q) && (
                    <>
                      {" · "}
                      <a href={`${BACK}?${pageQs({}, { scope: scopeParam, vista: vistaArticoli ? "articoli" : undefined })}`}>
                        azzera filtri
                      </a>
                    </>
                  )}
                </label>
              </form>
              </FiltriMobile>
              </div>
            </details>

            {/* ---------- tabella offerte del volantino ---------- */}
            <form>
              <input type="hidden" name="scope" value={scopeParam} />
              {consortium && (
                <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button className="btn btn-sm" formAction={createZooParent.bind(null, BACK, scopeParam)} type="submit">
                    Crea padre dagli articoli selezionati
                  </button>
                  <button className="btn btn-sm" formAction={associaConAI.bind(null, BACK, scopeParam)} type="submit" style={{ background: "#6d3fa7" }}>
                    Associa i selezionati con AI (raggruppa + genera testi)
                  </button>
                  {!vistaArticoli && (
                    <button className="btn btn-outline btn-sm" formAction={mergeParentsForm.bind(null, BACK, scopeParam)} type="submit"
                      title="Spunta due o più prodotti padre: gli articoli passeranno tutti sotto il primo spuntato">
                      Unisci i padri selezionati
                    </button>
                  )}
                  {padriConPiuPrezzi.length > 0 && (
                    <PulsanteAzione azione={dividiTuttiIPadriPerPrezzo} className="btn btn-outline btn-sm"
                      conferma={`Dividere ${padriConPiuPrezzi.length} padri che hanno articoli a prezzi diversi? Nascono padri separati, uno per prezzo, con il formato nel nome e nella descrizione. Le scelte del volantino restano.`}
                      title="Un padre per prezzo: la descrizione «160 g o 400 g» non finisce più sul padre delle sole lattine da 400 g">
                      ⑂ Dividi per prezzo i padri con più prezzi ({padriConPiuPrezzi.length})
                    </PulsanteAzione>
                  )}
                  <button className="btn btn-outline btn-sm" formAction={archiviaOfferteSelezionate.bind(null, scopeParam)} type="submit"
                    style={{ color: "var(--red)", borderColor: "var(--red)" }}
                    title="Toglie dal volantino in lavorazione le offerte spuntate: gli articoli e i padri restano">
                    Archivia le offerte selezionate
                  </button>
                  <span className="hint">
                    {db.settings.apiKey
                      ? "chiave API Claude configurata"
                      : "nessuna chiave API: verrà usato il raggruppamento automatico con testi bozza"}
                  </span>
                </div>
              )}
              <div className="card table-wrap">
                <ColumnTools tableId="tab-offerte" />
                <table className="data" id="tab-offerte">
                  <thead>
                    <tr>
                      {consortium && <th style={{ width: 30 }}><BulkCheckbox name="sel" also="selpadre" /></th>}
                      <th style={{ width: 56 }}>Foto</th>
                      <ColonnaOrdinabile campo="nome">{vistaArticoli ? "Offerta" : "Prodotto"}</ColonnaOrdinabile>
                      <th className="col-wide">Descrizione</th>
                      <th>Marca</th>
                      <th>Fornitore</th>
                      <ColonnaOrdinabile campo="animale">Animale</ColonnaOrdinabile>
                      <ColonnaOrdinabile campo="caratt">Caratteristica</ColonnaOrdinabile>
                      <th title="Tipo di prodotto (elenco in Impostazioni)">Tipologia</th>
                      <th>Pagina</th>
                      <th>Etichetta</th>
                      <ColonnaOrdinabile campo="meccanica">Meccanica</ColonnaOrdinabile>
                      <th title="Condizioni stampate sul cartello">Condizioni</th>
                      <th>Focus</th>
                      <th>{vistaArticoli ? "EAN" : "Articoli"}</th>
                      <th>Prezzo promo</th>
                      <th title="Prezzo al chilo o al litro: calcolato dal contenuto dell'articolo, oppure scritto a mano">€/kg · l</th>
                      <th>Listino</th>
                      {vistaArticoli && <th>Padre</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(vistaArticoli ? visibiliCap.length : gruppiVisibili.length) === 0 && (
                      <tr><td colSpan={nCols} className="empty">Nessuna offerta: carica l&apos;Excel delle promo qui sopra.</td></tr>
                    )}

                    {/* ---- vista raggruppata: una riga per padre (le orfane restano singole) ---- */}
                    {!vistaArticoli && gruppiVisibili.map((g) => {
                      const { parent, offs } = g;
                      const first = offs[0];
                      const product = prodById.get(first.productId ?? "");
                      const num = (s: string) => Number.parseFloat(s.replace(",", "."));
                      const prezzi = [...new Set(offs.map((o) => o.prezzoPromo).filter(Boolean))];
                      const prezzoLabel = prezzi.length === 0 ? "—"
                        : prezzi.length === 1 ? `€ ${prezzi[0]}`
                        : `€ ${Math.min(...prezzi.map(num)).toFixed(2).replace(".", ",")} – € ${Math.max(...prezzi.map(num)).toFixed(2).replace(".", ",")}`;
                      const animali = animaliDi(db, parent?.caratteristiche ?? []);
                      const prodottoCarat = caratteristicheProdottoDi(db, parent?.caratteristiche ?? []);
                      // lo stesso padre può avere più righe (una per prezzo): la chiave lo distingue
                      const key = parent ? `${parent.id}~${chiavePrezzo(first)}` : `_o_${first.id}`;
                      const offIds = offs.map((o) => o.id);
                      const nome = parent ? effectiveParentText(db, scope, parent, "nome", academyDb).value : first.descrizione;
                      const descr = parent ? effectiveParentText(db, scope, parent, "descVolantino", academyDb).value : (first.condizioni ?? "");
                      return [
                        <tr key={key}
                          data-nome={nome} data-animale={animali.join(", ")} data-caratt={prodottoCarat.join(", ")}
                          data-meccanica={first.meccanica ?? ""} data-marca={marcaEffettiva(db.products.find((p) => p.id === first.productId) ?? { marca: "", fornitore: "" })}>
                          {consortium && (
                            <td>
                              {parent
                                ? <input type="checkbox" name="selpadre" value={parent.id} title="Spunta due o più padri e usa «Unisci i padri selezionati»: il primo dà i testi" />
                                : product && <input type="checkbox" name="sel" value={product.id} />}
                            </td>
                          )}
                          <td>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <FotoMini src={zooImageUrl(product, parent)} style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 6, border: "1px solid #eee" }} />
                          </td>
                          <td>
                            {consortium ? (
                              <InlineEdit value={nome} onSave={parent
                                ? updateParentFieldInline.bind(null, parent.id, "nome", scopeParam)
                                : updateOfferFieldInline.bind(null, first.id, "descrizione")} />
                            ) : (
                              <strong style={{ fontSize: 13 }}>{nome}</strong>
                            )}
                            {!parent && <span className="pill pill-gray">senza padre</span>}
                            {parent && <DettagliPadre parentId={parent.id} />}
                            {parent && consortium && padriConPiuPrezzi.includes(parent) && (
                              <div style={{ marginTop: 3 }}>
                                <PulsanteAzione azione={dividiPadrePerPrezzo.bind(null, parent.id)} className="pill pill-amber"
                                  conferma={`Dividere «${parent.nome}» in un padre per prezzo? Il formato finisce nel nome e nella descrizione dei nuovi padri.`}
                                  title="Questo padre ha articoli in offerta a prezzi diversi: stesse descrizioni su righe che dicono cose diverse">
                                  ⚠ più prezzi · dividi
                                </PulsanteAzione>
                              </div>
                            )}
                            {parent && animali.length === 0 && (
                              <span className="pill pill-amber" title="L'animale non è stato riconosciuto: scegli nella colonna Animale">senza animale</span>
                            )}
                          </td>
                          <td className="col-wide">
                            {consortium && parent ? (
                              <InlineEdit value={descr} multiline placeholder="descrizione volantino…"
                                onSave={updateParentFieldInline.bind(null, parent.id, "descVolantino", scopeParam)} />
                            ) : (
                              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{descr || "—"}</span>
                            )}
                          </td>
                          <td style={{ fontSize: 12.5 }}>{product ? marcaEffettiva(product) || "—" : "—"}</td>
                          <td style={{ fontSize: 12.5 }}>{product?.fornitore || "—"}</td>
                          <td>
                            {consortium && parent ? (
                              <InlineMulti values={animali} options={db.settings.categorieAnimali}
                                onSave={setParentAnimaliInline.bind(null, parent.id)} />
                            ) : (
                              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{animali.join(", ") || "—"}</span>
                            )}
                          </td>
                          <td>
                            {consortium && parent ? (
                              <InlineSelect value={prodottoCarat[0] ?? ""} options={db.settings.caratteristicheProdotto}
                                onSave={setParentTagInline.bind(null, parent.id, "prodotto")} />
                            ) : (
                              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{prodottoCarat.join(", ") || "—"}</span>
                            )}
                          </td>
                          <td>
                            {consortium && (parent || product) ? (
                              <InlineSelect value={(parent ? parent.tipologia : product?.tipologia) ?? ""} options={db.settings.tipologieProdotto}
                                onSave={setTipologiaInline.bind(null, parent ? parent.id : product!.id, Boolean(parent))} />
                            ) : (
                              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{(parent ? parent.tipologia : product?.tipologia) || "—"}</span>
                            )}
                          </td>
                          <td>
                            {consortium ? (
                              <InlineSelect value={first.paginaId ?? ""}
                                options={[...db.settings.categorieAnimali.map((a) => `animale:${a}`), ...pagineVolantino.map((p) => p.id), NO_VOLANTINO]}
                                etichette={{ ...Object.fromEntries(db.settings.categorieAnimali.map((a) => [`animale:${a}`, `${a} (da collocare)`])), ...Object.fromEntries(pagineVolantino.map((p) => [p.id, p.nome])), [NO_VOLANTINO]: "✕ no volantino" }}
                                vuoto="— da assegnare —"
                                onSave={updateOfferGroupFieldInline.bind(null, offIds, "paginaId")} />
                            ) : (
                              <span style={{ fontSize: 11.5 }}>
                                {nomeDestinazione(first.paginaId, nomePagina) || "—"}
                              </span>
                            )}
                          </td>
                          <td>
                            {consortium ? (
                              <InlineSelect value={first.label ?? ""} options={db.settings.labels}
                                onSave={updateOfferGroupFieldInline.bind(null, offIds, "label")} />
                            ) : (
                              <span style={{ fontSize: 11.5 }}>{first.label || "—"}</span>
                            )}
                          </td>
                          <td>
                            {consortium ? (
                              <InlineEdit value={first.meccanica ?? ""} placeholder="es. 3x2"
                                onSave={updateOfferGroupFieldInline.bind(null, offIds, "meccanica")} />
                            ) : (
                              <span style={{ fontSize: 11.5 }}>{first.meccanica || "—"}</span>
                            )}
                            {first.promoTesto && <div className="hint" style={{ fontSize: 10.5 }}>da «{first.promoTesto}»</div>}
                          </td>
                          <td>
                            {consortium ? (
                              <InlineEdit value={first.condizioni ?? ""} placeholder="condizioni…"
                                onSave={updateOfferGroupFieldInline.bind(null, offIds, "condizioni")} />
                            ) : (
                              <span style={{ fontSize: 11.5 }}>{first.condizioni || "—"}</span>
                            )}
                          </td>
                          <td>
                            {consortium ? (
                              <InlineEdit value={first.focus ?? ""} placeholder="focus…" suggerimenti={focusEsistenti}
                                onSave={updateOfferGroupFieldInline.bind(null, offIds, "focus")} />
                            ) : (
                              <span style={{ fontSize: 11.5 }}>{first.focus || "—"}</span>
                            )}
                          </td>
                          <td style={{ fontSize: 12 }}>
                            {offs.length > 1 ? (
                              <details>
                                <summary style={{ cursor: "pointer", color: "#274b7a" }}>{offs.length} articoli</summary>
                                <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 11 }}>
                                  {offs.map((o) => <li key={o.id}>{o.descrizione} · EAN {o.ean}</li>)}
                                </ul>
                              </details>
                            ) : (
                              first.ean
                            )}
                          </td>
                          <td>
                            {consortium && offs.length === 1 ? (
                              <InlineEdit value={first.prezzoPromo} onSave={updateOfferFieldInline.bind(null, first.id, "prezzoPromo")} />
                            ) : (
                              <strong>{prezzoLabel}</strong>
                            )}
                          </td>
                          <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                            {consortium && offs.length === 1 ? (
                              <InlineEdit value={first.prezzoUnita ?? ""} placeholder={prezzoUnitaDi(first, product, first.prezzoPromo) || "—"}
                                onSave={updateOfferFieldInline.bind(null, first.id, "prezzoUnita")} />
                            ) : (
                              prezzoUnitaDi(first, product, first.prezzoPromo) || "—"
                            )}
                          </td>
                          <td style={{ fontSize: 12.5 }}>
                            {first.prezzoListino ? `€ ${first.prezzoListino}` : "—"}
                          </td>
                        </tr>,
                        parent ? (
                          <tr key={`pan_${key}`} className="riga-pannello">
                            <td colSpan={nCols} style={{ padding: 0 }}>
                              <PannelloPadre parentId={parent.id} scopeParam={scopeParam} back={BACK} />
                            </td>
                          </tr>
                        ) : null,
                      ];
                    })}

                    {/* ---- vista articoli singoli: una riga per offerta ---- */}
                    {vistaArticoli && visibiliCap.map((o) => {
                      const product = prodById.get(o.productId ?? "");
                      const parent = product?.parentId ? parentById.get(product.parentId) : undefined;
                      const animali = animaliDi(db, parent?.caratteristiche ?? []);
                      const prodottoCarat = caratteristicheProdottoDi(db, parent?.caratteristiche ?? []);
                      const parentDescr = parent ? effectiveParentText(db, scope, parent, "descVolantino", academyDb).value : "";
                      return [
                        <tr key={o.id}>
                          {consortium && (
                            <td>{product && <input type="checkbox" name="sel" value={product.id} />}</td>
                          )}
                          <td>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <FotoMini src={zooImageUrl(product, parent)} style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 6, border: "1px solid #eee" }} />
                          </td>
                          <td>
                            {consortium ? (
                              <InlineEdit value={o.descrizione} onSave={updateOfferFieldInline.bind(null, o.id, "descrizione")} />
                            ) : (
                              <strong style={{ fontSize: 13 }}>{o.descrizione}</strong>
                            )}
                            {o.condizioni && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{o.condizioni}</div>}
                            {o.nuovo && <span className="pill pill-orange" style={{ marginTop: 2 }}>nuovo nel database</span>}
                          </td>
                          <td className="col-wide" style={{ fontSize: 11.5, color: "var(--muted)" }}>{parentDescr || "—"}</td>
                          <td style={{ fontSize: 12.5 }}>{product ? marcaEffettiva(product) || "—" : "—"}</td>
                          <td style={{ fontSize: 12.5 }}>{product?.fornitore || "—"}</td>
                          <td>
                            {consortium && parent ? (
                              <InlineMulti values={animali} options={db.settings.categorieAnimali}
                                onSave={setParentAnimaliInline.bind(null, parent.id)} />
                            ) : (
                              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{animali.join(", ") || "—"}</span>
                            )}
                          </td>
                          <td>
                            {consortium && parent ? (
                              <InlineSelect value={prodottoCarat[0] ?? ""} options={db.settings.caratteristicheProdotto}
                                onSave={setParentTagInline.bind(null, parent.id, "prodotto")} />
                            ) : (
                              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{prodottoCarat.join(", ") || "—"}</span>
                            )}
                          </td>
                          <td>
                            {consortium && (parent || product) ? (
                              <InlineSelect value={(parent ? parent.tipologia : product?.tipologia) ?? ""} options={db.settings.tipologieProdotto}
                                onSave={setTipologiaInline.bind(null, parent ? parent.id : product!.id, Boolean(parent))} />
                            ) : (
                              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{(parent ? parent.tipologia : product?.tipologia) || "—"}</span>
                            )}
                          </td>
                          <td>
                            {consortium ? (
                              <InlineSelect value={o.paginaId ?? ""}
                                options={[...db.settings.categorieAnimali.map((a) => `animale:${a}`), ...pagineVolantino.map((p) => p.id), NO_VOLANTINO]}
                                etichette={{ ...Object.fromEntries(db.settings.categorieAnimali.map((a) => [`animale:${a}`, `${a} (da collocare)`])), ...Object.fromEntries(pagineVolantino.map((p) => [p.id, p.nome])), [NO_VOLANTINO]: "✕ no volantino" }}
                                vuoto="— da assegnare —"
                                onSave={updateOfferFieldInline.bind(null, o.id, "paginaId")} />
                            ) : (
                              <span style={{ fontSize: 11.5 }}>
                                {nomeDestinazione(o.paginaId, nomePagina) || "—"}
                              </span>
                            )}
                          </td>
                          <td>
                            {consortium ? (
                              <InlineSelect value={o.label ?? ""} options={db.settings.labels}
                                onSave={updateOfferFieldInline.bind(null, o.id, "label")} />
                            ) : (
                              <span style={{ fontSize: 11.5 }}>{o.label || "—"}</span>
                            )}
                          </td>
                          <td>
                            {consortium ? (
                              <InlineEdit value={o.meccanica ?? ""} placeholder="es. 3x2"
                                onSave={updateOfferFieldInline.bind(null, o.id, "meccanica")} />
                            ) : (
                              <span style={{ fontSize: 11.5 }}>{o.meccanica || "—"}</span>
                            )}
                            {o.promoTesto && <div className="hint" style={{ fontSize: 10.5 }}>da «{o.promoTesto}»</div>}
                          </td>
                          <td>
                            {consortium ? (
                              <InlineEdit value={o.condizioni ?? ""} placeholder="condizioni…"
                                onSave={updateOfferFieldInline.bind(null, o.id, "condizioni")} />
                            ) : (
                              <span style={{ fontSize: 11.5 }}>{o.condizioni || "—"}</span>
                            )}
                          </td>
                          <td>
                            {consortium ? (
                              <InlineEdit value={o.focus ?? ""} placeholder="focus…" suggerimenti={focusEsistenti}
                                onSave={updateOfferFieldInline.bind(null, o.id, "focus")} />
                            ) : (
                              <span style={{ fontSize: 11.5 }}>{o.focus || "—"}</span>
                            )}
                          </td>
                          <td style={{ fontSize: 12 }}>{o.ean}</td>
                          <td>
                            {consortium ? (
                              <InlineEdit value={o.prezzoPromo} onSave={updateOfferFieldInline.bind(null, o.id, "prezzoPromo")} />
                            ) : (
                              <strong>€ {o.prezzoPromo}</strong>
                            )}
                          </td>
                          <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                            {consortium ? (
                              <InlineEdit value={o.prezzoUnita ?? ""} placeholder={prezzoUnitaDi(o, product, o.prezzoPromo) || "—"}
                                onSave={updateOfferFieldInline.bind(null, o.id, "prezzoUnita")} />
                            ) : (
                              prezzoUnitaDi(o, product, o.prezzoPromo) || "—"
                            )}
                          </td>
                          <td style={{ fontSize: 12.5 }}>{o.prezzoListino ? `€ ${o.prezzoListino}` : "—"}</td>
                          <td>
                            {parent ? (
                              <>
                                <span className="pill pill-blue">{effectiveParentText(db, scope, parent, "nome", academyDb).value.slice(0, 24)}</span>
                                {" "}<DettagliPadre parentId={parent.id} />
                              </>
                            ) : (
                              <span className="pill pill-gray">senza padre</span>
                            )}
                          </td>
                        </tr>,
                        parent && (
                          <tr key={`pan_${parent.id}`} className="riga-pannello">
                            <td colSpan={nCols} style={{ padding: 0 }}>
                              <PannelloPadre parentId={parent.id} scopeParam={scopeParam} back={BACK} />
                            </td>
                          </tr>
                        ),
                      ];
                    })}
                  </tbody>
                </table>
              </div>
              {((vistaArticoli && visibili.length > RIGHE_MAX) || (!vistaArticoli && gruppi.length > RIGHE_MAX)) && (
                <p className="hint" style={{ marginTop: 6 }}>
                  Mostrate le prime {RIGHE_MAX} righe: usa la ricerca per restringere l&apos;elenco.
                </p>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  );
}
