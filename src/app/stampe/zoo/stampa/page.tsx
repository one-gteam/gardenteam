import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { Fragment } from "react";
import BulkCheckbox from "@/components/stampe/BulkCheckbox";
import { DettagliPadre, PannelloPadre } from "@/components/stampe/DettagliPadre";
import RigaCoda from "@/components/stampe/RigaCoda";
import RigaAzione from "@/components/stampe/RigaAzione";
import ColonnaOrdinabile from "@/components/stampe/ColonnaOrdinabile";
import FiltriMobile from "@/components/FiltriMobile";
import SchedeStampa from "@/components/stampe/SchedeStampa";
import FormAutoInvia from "@/components/stampe/FormAutoInvia";
import RigheAlterne from "@/components/stampe/RigheAlterne";
import ApriNuovoCartello from "@/components/stampe/ApriNuovoCartello";
import AutoSubmitSelect from "@/components/stampe/AutoSubmitSelect";
import StampeHeader from "@/components/stampe/StampeHeader";
import Cartello from "@/components/stampe/Cartello";
import StampaWorkspace from "@/components/stampe/StampaWorkspace";
import ImportExcel from "@/components/stampe/ImportExcel";
import { canAccessArea, gestisceArea, scopesForUser, resolveScope } from "@/lib/stampe";
import {
  getZooDb, nonConformiDi, layoutPerOfferta, layoutScegliibili, pvPriceFor, isZooHidden,
  campagneStampabili, campagnaInCorso, campagnaInLavorazione, campaignStato,
  effectiveParentText, effectiveParentTag, printedAt, NO_VOLANTINO,
  ZOO_FIELDS, ZOO_FORMATS, marcaEffettiva, condizioniPer, ownScopeVisible, pvPromoFor, noPrintSets, offertePerStampa, tagsPerLayout, valoriPerStampa, giacenzePer, tagsPerStampa,
} from "@/lib/zoo";
import {
  importPvPricesRighe, markZooPrinted, resetZooPrinted, toggleZooHidden, importZooNoPrintRighe, svuotaZooNoPrint,
  toggleZooNoPrint, rimettiInCodaMulti, svuotaStampatiCoda, rimettiInStampaMulti,
  rimettiInCodaInline, segnaArrivatoInline, togliNonConformeInline, rimettiInStampaInline,
  creaOffertaPropria, eliminaOffertaPropria, stampaCoda,
} from "@/lib/zoo-actions";

/** Stampa cartelli Offerte Zoo: stesso impianto dell'Arredo (selezione, formati per riga, stampa 1:1). */
/** Il fuso di casa: le pagine sono disegnate dal server, che non sta in Italia. */
const FUSO = "Europe/Rome";

export default async function ZooStampaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessArea(user, "zoo")) redirect("/studente");
  const sp = await searchParams;

  const db = await getZooDb();
  const academyDb = await getDb();
  const scopes = scopesForUser(user, academyDb);
  const scope = resolveScope(user, sp.scope, academyDb);
  const scopeParam = `${scope.type}:${scope.id}`;
  // gestione dell'area in questo ambito (offerte proprie): il capo reparto stampa, carica prezzi ed esclusioni, ma non crea offerte
  const gestione = gestisceArea(user, "zoo", scope, academyDb);

  /*
   * Si stampano i cartelli di due periodi promozionali: quello IN CORSO a scaffale
   * e quello IN PREPARAZIONE (i cartelli si stampano prima che le offerte partano).
   * Di default si apre quello in corso, che è il caso di tutti i giorni.
   */
  const stampabili = campagneStampabili(db);
  const campaign =
    stampabili.find((c) => c.id === sp.campagna) ?? campagnaInCorso(db) ?? campagnaInLavorazione(db);
  /*
   * Si stampano le offerte del volantino del Consorzio più quelle proprie di
   * questa insegna/PV, che vivono fuori dal volantino comune ma vanno a scaffale
   * insieme alle altre.
   */
  const allOffers = offertePerStampa(db, scope, academyDb, campaign);
  const offerteProprie = allOffers.filter((o) => o.scopeType);
  const etichettaPeriodo = (c: (typeof stampabili)[number]) => {
    const p = campaignStato(c) === "lavorazione" ? "in preparazione" : "in corso";
    const d = (x: string) => (x ? new Date(`${x}T00:00:00`).toLocaleDateString("it-IT") : "—");
    return `${c.nome} (${p}: ${d(c.dal)} → ${d(c.al)})`;
  };
  /** L'offerta finisce sul volantino? (pagina assegnata e non scartata) */
  const inVolantino = (o: (typeof allOffers)[number]) =>
    Boolean(o.selezionata) || (Boolean(o.paginaId) && o.paginaId !== NO_VOLANTINO);

  /*
   * "Marca" qui è quella effettiva (marca del listino o, se manca, il fornitore):
   * i listini dei fornitori quasi mai portano la marca, e senza questo ripiego la
   * tendina resterebbe vuota — è il motivo per cui le marche non si vedevano.
   */
  const marche = [...new Set(
    allOffers.map((o) => {
      const p = db.products.find((x) => x.id === o.productId);
      return p ? marcaEffettiva(p) : "";
    }).filter(Boolean)
  )].sort();
  /*
   * Più marche insieme: spuntandole arrivano come parametri ripetuti (array),
   * mentre i link interni le rimettono in una stringa separata da virgole.
   * Vanno accettate entrambe le forme, altrimenti il filtro salta a seconda di
   * come si è arrivati alla pagina.
   */
  const marcaRaw = sp.marca as unknown as string | string[] | undefined;
  const marcheScelte = (Array.isArray(marcaRaw) ? marcaRaw : (marcaRaw ?? "").split(","))
    .map((m) => m.trim()).filter(Boolean);
  /*
   * Cartelli esclusi: quelli spuntati uno a uno (per offerta) e quelli caricati
   * con l'Excel dei codici (per articolo, validi anche sui volantini futuri).
   */
  const noPrint = noPrintSets(db, scope);
  const escluso = (o: { id: string; ean: string }) => noPrint.offerIds.has(o.id) || noPrint.eans.has(o.ean);
  const marcheEscluse = db.hidden
    .filter((h) => h.scopeType === scope.type && h.scopeId === scope.id && h.kind === "marca")
    .map((h) => h.value);

  /*
   * Un solo filtro "Stato" al posto di due tendine (già stampati / esclusi):
   * i vecchi parametri restano validi per i link salvati.
   */
  const fStampati = sp.stato === "da" ? "no" : sp.stato === "si" ? "si" : sp.stato ? "" : (sp.stampati ?? "");
  const fEsclusi = sp.stato === "esclusi" ? "si" : sp.stato === "soloesclusi" ? "solo" : sp.stato ? "" : (sp.nonstampabili ?? "");
  const statoValore = fStampati === "no" ? "da" : fStampati === "si" ? "si" : fEsclusi === "si" ? "esclusi" : fEsclusi === "solo" ? "soloesclusi" : "";
  /*
   * La pagina è in tre schede: Stampa (il lavoro di tutti i giorni), Liste
   * (coda, stampati, in arrivo, non conformi, esclusi) e Regole dell'ambito
   * (prezzi propri, codici da non stampare, offerte proprie, marche). Le azioni
   * delle regole e delle liste tornano qui coi loro avvisi: si riapre la scheda giusta.
   */
  const tab = sp.tab === "liste" || sp.tab === "regole" ? sp.tab
    : sp.noprint !== undefined || sp.prezzi !== undefined || sp.azzerati !== undefined || sp.offerta ? "regole"
    : sp.rimessi !== undefined ? "liste"
    : "stampa";
  // giacenze e prezzi del gestionale collegato (se c'è), su tutte le offerte: servono anche al filtro
  const giacenze = await giacenzePer(db, scope, academyDb, allOffers.map((o) => o.ean));
  const giacenzaDi = (eans: string[]) => {
    const trovate = eans.map((e) => giacenze[e]).filter(Boolean);
    return trovate.length > 0 ? String(trovate.reduce((t, g) => t + g.giacenza, 0)) : undefined;
  };
  /*
   * La ricerca guarda anche il nome del prodotto padre e la descrizione
   * dell'articolo: la descrizione dell'offerta da sola ("NUTRIMI 70GR TONNO")
   * non conteneva il nome con cui la gente lo cerca ("Life Pet Care").
   */
  /*
   * Indici per id: con centinaia di offerte e migliaia di articoli, cercare con
   * find() dentro ogni ciclo rendeva la pagina lenta a ogni filtro.
   */
  const prodById = new Map(db.products.map((p) => [p.id, p]));
  const parentById = new Map(db.parents.map((p) => [p.id, p]));
  const padreDi = (o: (typeof allOffers)[number]) => {
    const product = o.productId ? prodById.get(o.productId) : undefined;
    const parent = product?.parentId ? parentById.get(product.parentId) : undefined;
    return { product, parent };
  };
  const nomePadre = new Map<string, string>();
  const nomeDelPadre = (parent: (typeof db.parents)[number]) => {
    if (!nomePadre.has(parent.id)) nomePadre.set(parent.id, effectiveParentText(db, scope, parent, "nome", academyDb).value);
    return nomePadre.get(parent.id) ?? "";
  };
  /** Il titolo che si legge in elenco: quello del cartello proprio, del padre, o la descrizione. */
  const titoloDi = (o: (typeof allOffers)[number]) => {
    if (o.titolo) return o.titolo;
    const { parent } = padreDi(o);
    return (parent ? nomeDelPadre(parent) : "") || o.descrizione;
  };
  /** Cartello proprio: "vostro", oppure "condiviso da ..." se viene da un'altra insegna. */
  const etichettaPropria = (o: (typeof allOffers)[number]) => {
    if (!o.scopeType) return undefined;
    const mio = o.scopeType === scope.type && (o.scopeId ?? "") === scope.id;
    if (mio) return o.condivisa ? "vostro · condiviso" : "vostro";
    if (o.scopeType === "system") return "Consorzio";
    const chi = o.scopeType === "store"
      ? academyDb.stores.find((x) => x.id === o.scopeId)?.name
      : academyDb.tenants.find((x) => x.id === o.scopeId)?.name;
    return o.condivisa && !ownScopeVisible(scope, academyDb, o) ? `condiviso da ${chi ?? "un'insegna"}` : (chi ?? "proprio");
  };
  const visible = allOffers.filter((o) => {
    const { product, parent } = padreDi(o);
    if (product && isZooHidden(db, scope, product, academyDb)) return false;
    if (sp.animale && !(parent ? effectiveParentTag(db, scope, parent, "animale", academyDb).value : "").includes(sp.animale)) return false;
    if (sp.caratt && !(parent ? effectiveParentTag(db, scope, parent, "prodotto", academyDb).value : "").includes(sp.caratt)) return false;
    if (marcheScelte.length > 0 && !marcheScelte.includes(marcaEffettiva(product ?? { marca: "", fornitore: "" }))) return false;
    if (sp.giacenza) {
      const g = giacenze[o.ean];
      if (sp.giacenza === "si" && !(g && g.giacenza > 0)) return false;
      if (sp.giacenza === "zero" && !(g && g.giacenza <= 0)) return false;
      if (sp.giacenza === "no" && g) return false;
    }
    if (fEsclusi !== "si" && fEsclusi !== "solo" && escluso(o)) return false;
    if (fEsclusi === "solo" && !escluso(o)) return false;
    if (sp.volantino === "si" && !inVolantino(o)) return false;
    if (sp.volantino === "no" && inVolantino(o)) return false;
    if (fStampati === "si" && !printedAt(db, scope, o.id)) return false;
    if (fStampati === "no" && printedAt(db, scope, o.id)) return false;
    return true;
  });
  const nStampati = allOffers.filter((o) => printedAt(db, scope, o.id)).length;

  /*
   * L'elenco a sinistra è per PRODOTTO PADRE: un cartello vale per tutti i gusti
   * e formati (elenca i loro codici a barre), quindi si sceglie una volta sola.
   * Chi vuole può passare alle offerte singole (vista=singole).
   */
  const vistaSingole = sp.vista === "singole";
  const marcaDi = (o: (typeof allOffers)[number]) => {
    const { product } = padreDi(o);
    return o.marca || (product ? marcaEffettiva(product) : "");
  };
  /** Il testo in cui la ricerca del browser guarda, oltre al titolo. */
  const testoRicerca = (gruppo: (typeof allOffers)[number][]) => [...new Set(gruppo.flatMap((o) => {
    const { product } = padreDi(o);
    return [o.descrizione, o.ean, product?.descrizione ?? "", product?.codice ?? "", product?.fornitore ?? "", marcaDi(o), o.meccanica ?? ""];
  }))].join(" ");
  const nonConformi = nonConformiDi(db, scope);
  /** undefined = conforme; stringa (anche vuota) = segnato non conforme, col motivo. */
  const ncDi = (ids: string[]) => {
    const trovato = ids.map((id) => nonConformi.get(id)).find(Boolean);
    return trovato ? (trovato.motivo ?? "") : undefined;
  };
  const voceSingola = (o: (typeof allOffers)[number]) => ({
    id: o.id,
    titolo: o.titolo || o.descrizione,
    codice: o.ean,
    prezzo: pvPriceFor(db, scope, o.ean, academyDb) ?? o.prezzoPromo,
    listino: o.prezzoListino,
    tipologia: marcaDi(o),
    giacenza: giacenzaDi([o.ean]),
    nonConforme: ncDi([o.id]),
    codiceGestionale: giacenze[o.ean]?.codice,
    cerca: testoRicerca([o]),
    propria: etichettaPropria(o),
  });
  /** La voce di un prodotto padre con tutti i suoi articoli in offerta. */
  const voceGruppo = (parentId: string, gruppo: typeof visible) => {
          const primo = gruppo[0];
          const parent = parentById.get(parentId);
          const prezzi = [...new Set(gruppo.map((g) => pvPriceFor(db, scope, g.ean, academyDb) ?? g.prezzoPromo).filter(Boolean))];
          return {
            id: primo.id,
            titolo: (parent ? nomeDelPadre(parent) : "") || primo.descrizione,
            codice: gruppo.length > 1 ? `${gruppo.length} articoli` : primo.ean,
            prezzo: prezzi.length > 1 ? `da ${[...prezzi].sort()[0]}` : (prezzi[0] ?? ""),
            listino: primo.prezzoListino,
            tipologia: marcaDi(primo),
            giacenza: giacenzaDi(gruppo.map((g) => g.ean)),
            nonConforme: ncDi(gruppo.map((g) => g.id)),
            codiceGestionale: gruppo.length === 1 ? giacenze[primo.ean]?.codice : undefined,
            cerca: testoRicerca(gruppo),
            propria: undefined as string | undefined,
          };
  };
  const voci = vistaSingole
    ? visible.map(voceSingola)
    : (() => {
        const gruppi = new Map<string, typeof visible>();
        for (const o of visible) {
          // i cartelli propri stanno da soli: un duplicato non si fonde col padre da cui è nato
          const { product } = padreDi(o);
          const key = product?.parentId && !o.scopeType ? `p:${product.parentId}` : `o:${o.id}`;
          gruppi.set(key, [...(gruppi.get(key) ?? []), o]);
        }
        return [...gruppi.entries()].map(([key, gruppo]) =>
          key.startsWith("p:") && gruppo.length > 0 ? voceGruppo(key.slice(2), gruppo) : voceSingola(gruppo[0])
        );
      })();

  /*
   * Un prodotto scelto e poi nascosto da un filtro (o dal limite dei 150)
   * restava selezionato e finiva in anteprima, ma spariva dalla tabella dei
   * selezionati: sembrava comparire un cartello di troppo. Le sue voci si
   * costruiscono a parte e si passano al riquadro dei selezionati.
   */
  const selezionatiFuoriElenco = (sp.sel ?? "").split(",").filter(Boolean)
    .filter((id) => !voci.some((v) => v.id === id))
    .map((id) => {
      const o = allOffers.find((x) => x.id === id);
      if (!o) return undefined;
      const { parent } = padreDi(o);
      if (vistaSingole || !parent || o.scopeType) return voceSingola(o);
      const gruppo = allOffers.filter((g) => !g.scopeType && padreDi(g).product?.parentId === parent.id);
      return voceGruppo(parent.id, gruppo.length > 0 ? gruppo : [o]);
    })
    .filter(Boolean) as typeof voci;

  // cartelli in coda per questo ambito, con il nome che si legge in elenco
  const nomeOfferta = (offerId: string) => {
    const o = allOffers.find((x) => x.id === offerId);
    return o ? titoloDi(o) : offerId;
  };
  /*
   * Ogni riga porta anche marca, fornitore, animale e tipo di promozione: gli
   * elenchi sono tabelle, si legge a colpo d'occhio di che cartelli si tratta e
   * si ordinano per la colonna che serve (il fornitore, quando si prepara il
   * giro di uno scaffale).
   */
  const datiCartello = (offerId: string) => {
    const o = db.offers.find((x) => x.id === offerId);
    const product = o ? db.products.find((p) => p.id === o.productId) : undefined;
    const parent = product?.parentId ? db.parents.find((x) => x.id === product.parentId) : undefined;
    return {
      nome: nomeOfferta(offerId),
      ean: o?.ean ?? "",
      marca: product ? marcaEffettiva(product) : "",
      fornitore: product?.fornitore ?? "",
      animale: parent ? effectiveParentTag(db, scope, parent, "animale", academyDb).value : "",
      promo: pvPromoFor(db, scope, o?.ean ?? "", academyDb)?.etichetta || o?.meccanica || "",
      parentId: parent?.id,
    };
  };
  const ordCoda = sp.ordcoda ?? "";
  const ordinaCoda = <T extends { nome: string; marca: string; fornitore: string; animale: string; promo: string }>(righe: T[]): T[] => {
    if (!ordCoda) return righe;
    const chiave = (r: T) =>
      ordCoda === "marca" ? r.marca
        : ordCoda === "fornitore" ? r.fornitore
        : ordCoda === "animale" ? r.animale
        : ordCoda === "promo" ? r.promo
        : r.nome;
    return [...righe].sort((a, b) => chiave(a).localeCompare(chiave(b)) || a.nome.localeCompare(b.nome));
  };
  const codaMia = db.coda
    .filter((c) => c.scopeType === scope.type && c.scopeId === scope.id)
    .map((c) => ({ ...c, ...datiCartello(c.offerId) }));
  const codaDopo = codaMia.filter((c) => c.stato === "dopo" && !c.stampato);
  const codaArrivo = codaMia.filter((c) => c.stato === "arrivo" && !c.stampato);
  /* I cartelli gia' mandati in stampa restano in elenco, segnati: serve a
     sapere cosa e' stato fatto e a ristampare se la stampa e' andata male. */
  const codaStampati = codaMia.filter((c) => c.stampato)
    .sort((a, b) => (b.stampato ?? "").localeCompare(a.stampato ?? ""));
  /* L'elenco da stampare e' diviso per formato: A4 e A5 vanno in stampante in
     due giri diversi, quindi ognuno ha il suo gruppo e il suo pulsante. */
  const formatoDiCoda = (c: (typeof codaMia)[number]) =>
    ZOO_FORMATS.find((f) => f.id === (c.impostazioni[`formato_${c.offerId}`] || ZOO_FORMATS[0].id)) ?? ZOO_FORMATS[0];
  const gruppiFormato = ZOO_FORMATS
    .map((f) => ({ formato: f, voci: ordinaCoda(codaDopo.filter((c) => formatoDiCoda(c).id === f.id)) }))
    .filter((g) => g.voci.length > 0);
  /*
   * Gli stampati stanno per lotto di stampa: un lotto è un giro in stampante,
   * cioè tutti i cartelli mandati insieme in quell'ora precisa. Dentro al lotto
   * il formato resta una colonna, ordinabile come le altre.
   */
  const lottiStampati = [...new Set(codaStampati.map((c) => c.stampato ?? ""))]
    .sort((a, b) => b.localeCompare(a))
    .map((iso) => {
      const voci = ordinaCoda(codaStampati.filter((c) => (c.stampato ?? "") === iso));
      const formati = [...new Set(voci.map((c) => formatoDiCoda(c).name))];
      return { iso, voci, formati };
    });
  const quando = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? "data sconosciuta"
      /*
       * Ora italiana anche quando la pagina è disegnata dal server, che gira a
       * Londra: senza il fuso i lotti comparivano con due ore in meno.
       */
      : `${d.toLocaleDateString("it-IT", { timeZone: FUSO })} alle ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: FUSO })}`;
  };
  /* Segnalati dal reparto: non conformi (il cartello non torna con lo scaffale)
     ed esclusi (segnati "Non stampare"). Stanno nelle stesse sezioni della coda
     perché sono tutte cose da guardare prima di mandare in stampa. */
  const nonConformiVoci = [...nonConformi.values()]
    .map((n) => {
      const o = db.offers.find((x) => x.id === n.offerId);
      return { ...n, ...datiCartello(n.offerId), articolo: o?.descrizione };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
  const nonConformiOrdinati = ordinaCoda(nonConformiVoci);
  const esclusiVoci = ordinaCoda(allOffers.filter(escluso).map((o) => ({ id: o.id, ...datiCartello(o.id) })));

  const selectedIds = (sp.sel ?? "").split(",").filter(Boolean);
  const selected = selectedIds.map((id) => allOffers.find((o) => o.id === id)).filter(Boolean) as typeof allOffers;
  const globalFormatId = sp.formato ?? ZOO_FORMATS[0].id;
  const formatFor = (oid: string) => ZOO_FORMATS.find((f) => f.id === (sp[`formato_${oid}`] ?? globalFormatId)) ?? ZOO_FORMATS[0];

  const valuesFor = (o: (typeof allOffers)[number]) => valoriPerStampa(db, scope, academyDb, o, sp, giacenze);

  /*
   * Si torna all'elenco con la selezione svuotata: i cartelli mandati in stampa
   * hanno finito il loro giro e restare selezionati confondeva (si finiva per
   * ristamparli). Per rivederli c'è il tasto Indietro del browser.
   */
  const qsBack = () => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "print" && k !== "sel") params.set(k, v);
    return params.toString();
  };

  const scalePrint = 3.7795; // 1 mm = 3.7795 px a 96 dpi → stampa a dimensione reale
  /* A5: di serie ogni cartello due volte sullo stesso foglio; "doppio=0" = due cartelli diversi per foglio */
  const doppio = sp.doppio !== "0";
  const tagsFor = (o: (typeof allOffers)[number]) => tagsPerStampa(db, scope, academyDb, o, sp);

  if (sp.print === "1" && selected.length > 0) {
    const cartello = (o: (typeof allOffers)[number]) => (
      <Cartello
        format={formatFor(o.id)}
        layout={layoutPerOfferta(db, scope, formatFor(o.id).id, academyDb, o, tagsFor(o))}
        fields={ZOO_FIELDS}
        values={valuesFor(o)}
        scale={scalePrint}
      />
    );
    /*
     * Gli A5 vanno sempre due per foglio A4 orizzontale (148+148 mm stanno nei
     * 297 dell'A4 girato): hanno una pagina con un nome suo, così nella stessa
     * stampa gli A4 restano in verticale. Prima uscivano uno per foglio, e il
     * foglio si girava per tutti solo con la spunta.
     */
    const a5 = selected.filter((o) => formatFor(o.id).id === "za5").flatMap((o) => (doppio ? [o, o] : [o]));
    const altri = selected.filter((o) => formatFor(o.id).id !== "za5");
    const fogliA5 = Array.from({ length: Math.ceil(a5.length / 2) }, (_, i) => a5.slice(i * 2, i * 2 + 2));
    const totale = altri.length + a5.length;
    return (
      <div>
        <style>{`@page foglioA5 { size: 297mm 210mm; margin: 0; }${altri.length === 0 ? " @page { size: 297mm 210mm; margin: 0; }" : ""}`}</style>
        <div className="no-print" style={{ padding: 14, display: "flex", gap: 10, alignItems: "center", background: "var(--green-50)", flexWrap: "wrap" }}>
          <strong>Anteprima di stampa — {totale} cartelli</strong>
          <a className="btn btn-outline btn-sm" href={`/stampe/zoo/stampa?${qsBack()}`}>← Torna all&apos;elenco</a>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            Usa il pulsante Stampa del browser (Ctrl+P) e scegli &quot;Salva come PDF&quot;.
            {fogliA5.length > 0 && ` Gli A5 escono due per foglio A4 orizzontale (${fogliA5.length} ${fogliA5.length === 1 ? "foglio" : "fogli"}${doppio ? ", ogni cartello due volte" : ""}).`}
          </span>
        </div>
        {altri.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap" }}>
            {altri.map((o, i) => (
              <div key={`${o.id}_${i}`} style={{ pageBreakInside: "avoid" }}>{cartello(o)}</div>
            ))}
          </div>
        )}
        {fogliA5.map((coppia, i) => (
          <div key={`a5_${i}`} className="foglio-a5">
            {coppia.map((o, j) => <div key={`${o.id}_${j}`}>{cartello(o)}</div>)}
          </div>
        ))}
      </div>
    );
  }

  const filtriAttivi = [
    sp.animale, sp.caratt,
    fStampati === "no" && "da stampare", fStampati === "si" && "già stampati",
    fEsclusi === "si" && "anche gli esclusi", fEsclusi === "solo" && "solo gli esclusi",
    sp.volantino === "si" && "in volantino", sp.volantino === "no" && "non in volantino",
    vistaSingole && "offerte singole",
    sp.giacenza === "si" && "con giacenza", sp.giacenza === "zero" && "giacenza zero", sp.giacenza === "no" && "non nel gestionale",
    marcheScelte.length > 0 && `${marcheScelte.length} ${marcheScelte.length === 1 ? "marca" : "marche"}`,
  ];
  const altroAttivi = [
    marcheScelte.length > 0 && (marcheScelte.length <= 2 ? marcheScelte.join(", ") : `${marcheScelte.length} marche`),
    sp.volantino === "si" && "in volantino", sp.volantino === "no" && "non in volantino",
    vistaSingole && "offerte singole",
    sp.giacenza === "si" && "con giacenza", sp.giacenza === "zero" && "giacenza zero", sp.giacenza === "no" && "non nel gestionale",
  ].filter(Boolean) as string[];
  const nCodiciNoPrint = noPrint.eans.size;
  const nPrezziMiei = db.pvPrices.filter((p) => p.scopeType === scope.type && p.scopeId === scope.id).length;

  return (
    <div>
      <StampeHeader user={user} active="stampa" area="zoo" />
      <div className="container">
        <div className="stampa-testata">
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Stampa cartelli</h1>
            <p className="subtitle">
              {campaign ? `${campaign.nome} · versione dati e layout di: ` : "Nessun volantino da stampare · ambito: "}
              <strong>{scope.label}</strong>
            </p>
          </div>
          {tab === "stampa" && <ApriNuovoCartello />}
          {/* periodo e ambito cambiano al volo: niente pulsanti da premere dopo */}
          <form method="get">
            {Object.entries(sp).map(([k, v]) => (k !== "scope" && k !== "campagna" && v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
            {stampabili.length > 1 && (
              <label className="field">
                Periodo promozionale
                <AutoSubmitSelect name="campagna" defaultValue={campaign?.id ?? ""}
                  options={stampabili.map((c) => ({ value: c.id, label: etichettaPeriodo(c) }))} />
              </label>
            )}
            <label className="field">
              Insegna / PV
              <AutoSubmitSelect name="scope" defaultValue={scopeParam}
                options={scopes.map((s) => ({ value: `${s.type}:${s.id}`, label: s.label }))} />
            </label>
          </form>
        </div>

        <SchedeStampa attiva={tab} schede={[
          { id: "stampa", label: "🖨 Stampa" },
          { id: "liste", label: "📋 Liste", pillole: [
            { n: codaDopo.length, label: "da stampare dopo", classe: "pill-orange" },
            { n: codaStampati.length, label: "stampati", classe: "pill-gray" },
            { n: codaArrivo.length, label: "in arrivo", classe: "pill-amber" },
            { n: nonConformiVoci.length, label: "non conformi", classe: "pill-orange" },
            { n: esclusiVoci.length, label: "esclusi", classe: "pill-red" },
          ] },
          { id: "regole", label: `⚙ Regole di ${scope.label}` },
        ]} />

        {sp.noprint !== undefined && (
          sp.noprint === "consorzio" ? (
            <div className="alert alert-amber">L&apos;elenco dei cartelli da non stampare è di ogni insegna o punto vendita: scegli il tuo ambito qui sopra.</div>
          ) : sp.noprint === "file" ? (
            <div className="alert alert-amber">Non ho ricevuto nessun file: riprova a sceglierlo.</div>
          ) : sp.noprint === "svuotato" ? (
            <div className="alert alert-green">✓ Elenco svuotato: tornano stampabili tutti i cartelli, tranne quelli esclusi a mano.</div>
          ) : (
            <div className="alert alert-green">
              ✓ {sp.noprint} {Number(sp.noprint) === 1 ? "codice escluso" : "codici esclusi"} dalla stampa per {scope.label}
              {Number(sp.rimessi ?? 0) > 0 && (
                <>, {sp.rimessi} {Number(sp.rimessi) === 1 ? "rimesso" : "rimessi"} fra quelli da stampare</>
              )}.
              {Number(sp.sconosciuti ?? 0) > 0 && (
                <>{" "}
                  {sp.sconosciuti} {Number(sp.sconosciuti) === 1 ? "codice fornitore non è" : "codici fornitore non sono"} nel
                  catalogo: caricali da Database prodotti se ti servono.
                </>
              )}
            </div>
          )
        )}
        {sp.prezzi !== undefined && (
          <div className="alert alert-green">
            ✓ {sp.prezzi} prezzi caricati per {scope.label}: sostituiscono il prezzo promo del Consorzio sui cartelli di questo ambito.
          </div>
        )}
        {sp.rimessi !== undefined && sp.noprint === undefined && (
          <div className="alert alert-green">✓ {sp.rimessi} cartelli rimessi fra quelli da stampare.</div>
        )}
        {sp.azzerati !== undefined && (
          <div className="alert alert-green">✓ Azzerato il &quot;già stampato&quot; su {sp.azzerati} cartelli.</div>
        )}

        <div className={`scheda-pannello scheda-${tab}`}>
        {/* ================= Stampa: filtra, scegli, prepara, stampa ================= */}
        {tab === "stampa" && (
          <>
            <div className="filtri-riquadro">
              <FiltriMobile id="filtri-stampa" scelte={filtriAttivi}>
                <FormAutoInvia className="filtri-stampa">
                  <input type="hidden" name="scope" value={scopeParam} />
                  {campaign && <input type="hidden" name="campagna" value={campaign.id} />}
                  <label className="field">
                    Tipologia animale
                    <select name="animale" defaultValue={sp.animale ?? ""}>
                      <option value="">Tutte</option>
                      {db.settings.categorieAnimali.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    Caratteristica
                    <select name="caratt" defaultValue={sp.caratt ?? ""}>
                      <option value="">Tutte</option>
                      {db.settings.caratteristicheProdotto.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    Stato
                    <select name="stato" defaultValue={statoValore}
                      title="Gli esclusi sono i cartelli segnati «Non stampare» o caricati nell'elenco dei codici da non stampare">
                      <option value="">Tutti i cartelli</option>
                      <option value="da">Solo da stampare</option>
                      <option value="si">Solo già stampati</option>
                      <option value="esclusi">Anche gli esclusi</option>
                      <option value="soloesclusi">Solo gli esclusi</option>
                    </select>
                  </label>
                  <details className="filtri-altro" open={altroAttivi.length > 0}>
                    <summary>
                      Altro
                      <span className="hint">{altroAttivi.length > 0 ? altroAttivi.join(" · ") : "marche, volantino, elenco, giacenza"}</span>
                    </summary>
                    <div>
                      <label className="field">
                        Sul volantino
                        <select name="volantino" defaultValue={sp.volantino ?? ""}>
                          <option value="">Tutte</option>
                          <option value="si">Solo le offerte in volantino</option>
                          <option value="no">Solo quelle NON in volantino</option>
                        </select>
                      </label>
                      <label className="field">
                        Elenco
                        <select name="vista" defaultValue={sp.vista ?? ""}>
                          <option value="">Per prodotto padre</option>
                          <option value="singole">Offerte singole</option>
                        </select>
                      </label>
                      {Object.keys(giacenze).length > 0 && (
                        <label className="field">
                          Giacenza
                          <select name="giacenza" defaultValue={sp.giacenza ?? ""}>
                            <option value="">Qualsiasi</option>
                            <option value="si">Solo con giacenza (&gt; 0)</option>
                            <option value="zero">Solo giacenza zero</option>
                            <option value="no">Non nel gestionale</option>
                          </select>
                        </label>
                      )}
                      <div className="chips filtri-marche"
                        title="Spunta una o più marche; nessuna spunta = tutte. La marca è quella del listino o, se manca, il fornitore.">
                        <span className="hint" style={{ marginRight: 4 }}>
                          Marche{marcheScelte.length > 0 ? ` (${marcheScelte.length} scelte)` : " (tutte)"}:
                        </span>
                        {marche.length === 0 && <span className="hint">nessuna marca in questo periodo</span>}
                        {marche.map((m) => (
                          <label key={m} className="chip">
                            <input type="checkbox" name="marca" value={m} defaultChecked={marcheScelte.includes(m)} />
                            {m}
                          </label>
                        ))}
                        {marcheScelte.length > 0 && (
                          <button type="button" className="chip" data-svuota="marca" title="Torna a tutte le marche">
                            ✕ tutte le marche
                          </button>
                        )}
                      </div>
                    </div>
                  </details>
                  <noscript><button className="btn btn-sm" type="submit">Filtra</button></noscript>
                </FormAutoInvia>
              </FiltriMobile>
            </div>

            <StampaWorkspace
              dettagliUrl="/stampe/zoo/stampa/dettagli"
              fields={ZOO_FIELDS}
              scopeParam={scopeParam}
              scopeLabel={scope.label}
              condizioniStandard={condizioniPer(db, scope, academyDb).condizioniStandard}
              layouts={layoutScegliibili(db, scope, academyDb)}
              picker={{
                totale: voci.length,
                mostraTuttiHref: `/stampe/zoo/stampa?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v) as [string, string][]), tutti: "1" })}`,
                products: voci,
                cercaNelBrowser: true,
                cercaIniziale: sp.q ?? "",
                prodottiSelezionati: selezionatiFuoriElenco,
                formats: ZOO_FORMATS.map((f) => ({ id: f.id, name: f.name })),
                scopeParam,
                filters: {
                  animale: sp.animale ?? "", caratt: sp.caratt ?? "", marca: marcheScelte.join(","), vista: sp.vista ?? "", giacenza: sp.giacenza ?? "",
                  volantino: sp.volantino ?? "", stato: statoValore, campagna: campaign?.id ?? "",
                },
                printed: Object.fromEntries(
                  visible.map((o) => [o.id, printedAt(db, scope, o.id) ?? ""]).filter(([, v]) => v)
                ),
                onPrint: markZooPrinted.bind(null, scopeParam),
                initialSelected: selectedIds,
                initialFormats: Object.fromEntries(
                  selectedIds.map((id) => [id, sp[`formato_${id}`] ?? globalFormatId]).filter(([, v]) => v)
                ),
                initialPrices: Object.fromEntries(selectedIds.map((id) => [id, sp[`prezzo_${id}`] ?? ""]).filter(([, v]) => v)),
                initialListini: Object.fromEntries(selectedIds.map((id) => [id, sp[`listino_${id}`] ?? ""]).filter(([, v]) => v)),
                initialNoPrice: Object.fromEntries(selectedIds.map((id) => [id, sp[`noprezzo_${id}`] === "1"])),
                initialNoPhoto: Object.fromEntries(selectedIds.map((id) => [id, sp[`senzafoto_${id}`] === "1"])),
                initialNoListino: Object.fromEntries(selectedIds.map((id) => [id, sp[`nolistino_${id}`] === "1"])),
                initialHidden: Object.fromEntries(
                  selectedIds.map((id) => [id, (sp[`nascondi_${id}`] ?? "").split(",").filter(Boolean)])
                ),
                fields: ZOO_FIELDS.map((f) => ({ id: f.id, label: f.label })),
                globalFormat: globalFormatId,
                baseUrl: "/stampe/zoo/stampa",
              }}
            />
          </>
        )}

        {/*
          * ================= Liste: cosa c'è da guardare prima di stampare =================
          * La coda di stampa, la merce in arrivo, i cartelli segnati non conformi
          * in reparto e quelli esclusi dalla stampa, in sezioni che si aprono e
          * si chiudono. Ogni elenco è una tabella con marca, fornitore, animale e
          * tipo di promozione, e le intestazioni ordinano: si prepara il giro di
          * uno scaffale per volta.
          */}
        {tab === "liste" && (
          <RigheAlterne className="sezioni">
            {codaDopo.length === 0 && codaArrivo.length === 0 && codaStampati.length === 0 && nonConformiVoci.length === 0 && esclusiVoci.length === 0 && (
              <p className="empty" style={{ margin: 0 }}>
                Niente in lista per {scope.label}: qui compaiono i cartelli messi da parte («Metti in coda» dai selezionati o
                dal reparto), quelli già stampati, la merce in arrivo, i non conformi e gli esclusi.
              </p>
            )}
            {(codaDopo.length > 0 || codaStampati.length > 0) && (
              <details className="sezione" open>
                <summary>
                  <strong>Da stampare più tardi</strong> <span className="pill pill-orange" id="conta-dopo">{codaDopo.length}</span>
                  {codaStampati.length > 0 && <span className="pill pill-gray"><span id="conta-stampati">{codaStampati.length}</span> stampati</span>}
                </summary>

                {gruppiFormato.map((g) => (
                  <form key={g.formato.id} action={stampaCoda.bind(null, scopeParam, "dopo", g.formato.id)}>
                    <div className="sezione-azioni">
                      <strong style={{ fontSize: 13 }}>{g.formato.name}</strong>
                      <span className="pill pill-orange" id={`conta-${g.formato.id}`}>{g.voci.length}</span>
                      <span className="hint">Clic per spuntare, Maiusc+clic per un intervallo.</span>
                      {g.formato.id === "za5" && (
                        <label className="interruttore-grande acceso"
                          title="Gli A5 escono sempre due per foglio A4 orizzontale. Acceso: ogni cartello due volte sullo stesso foglio. Spento: due cartelli diversi per foglio.">
                          <input type="checkbox" name="doppio" value="1" defaultChecked />
                          <span>Ogni cartello 2 volte per foglio A4</span>
                        </label>
                      )}
                      {/* viene letto solo se la spunta sopra è tolta: FormData prende il primo valore */}
                      {g.formato.id === "za5" && <input type="hidden" name="doppio" value="0" />}
                      <button className="btn btn-sm" type="submit" style={{ marginLeft: "auto" }}
                        title={`Apre l'anteprima di stampa dei cartelli ${g.formato.name} (o dei soli spuntati) con le impostazioni salvate`}>
                        Stampa {g.formato.name} →
                      </button>
                    </div>
                    <div className="table-wrap">
                      <table className="data">
                        <thead>
                          <tr>
                            <th style={{ width: 28 }}><BulkCheckbox name="coda" /></th>
                            <ColonnaOrdinabile campo="nome">Prodotto</ColonnaOrdinabile>
                            <ColonnaOrdinabile campo="marca">Marca</ColonnaOrdinabile>
                            <ColonnaOrdinabile campo="fornitore">Fornitore</ColonnaOrdinabile>
                            <ColonnaOrdinabile campo="animale">Animale</ColonnaOrdinabile>
                            <ColonnaOrdinabile campo="promo">Promo</ColonnaOrdinabile>
                            <th>Messo da</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.voci.map((c) => (
                            <Fragment key={c.id}>
                              <RigaCoda id={c.id} scopeParam={scopeParam} contatoreId={`conta-dopo,conta-${g.formato.id}`} tabella
                                dati={{ nome: c.nome, marca: c.marca, fornitore: c.fornitore, animale: c.animale, promo: c.promo }}>
                                <td><input type="checkbox" name="coda" value={c.id} title="Spunta per stampare solo alcuni" /></td>
                                <td>
                                  {c.nome}
                                  {c.impostazioni[`senzafoto_${c.offerId}`] === "1" && <span className="pill pill-gray" style={{ marginLeft: 6 }}>senza foto</span>}
                                  {c.parentId && <> <DettagliPadre parentId={c.parentId} /></>}
                                </td>
                                <td>{c.marca}</td>
                                <td>{c.fornitore}</td>
                                <td>{c.animale}</td>
                                <td>{c.promo}</td>
                                <td className="hint">{new Date(c.creato).toLocaleDateString("it-IT", { timeZone: FUSO })} · {c.userName}</td>
                              </RigaCoda>
                              {c.parentId && (
                                <tr><td colSpan={8} style={{ padding: 0 }}>
                                  <PannelloPadre parentId={c.parentId} scopeParam={scopeParam} back="/stampe/zoo/stampa?tab=liste" />
                                </td></tr>
                              )}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </form>
                ))}

                {codaStampati.length > 0 && (
                  <details className="sezione">
                    <summary>
                      <strong>Già stampati</strong> <span className="pill pill-gray">{codaStampati.length}</span>
                    </summary>
                    <form>
                      <div className="sezione-azioni">
                        <span className="hint">Restano qui divisi per lotto di stampa, cioè per giro mandato in stampante: si rimettono in coda tutti, per lotto o solo gli spuntati.</span>
                        <button className="btn btn-outline btn-sm" type="submit" style={{ marginLeft: "auto" }}
                          formAction={svuotaStampatiCoda.bind(null, scopeParam)}
                          title="Svuota l'elenco degli stampati (i cartelli restano, sparisce solo questo elenco)">
                          Svuota elenco
                        </button>
                      </div>
                    </form>
                    {lottiStampati.map((l, idx) => (
                      <details key={l.iso || idx} className="sezione" open={idx === 0}>
                        <summary>
                          <strong>Stampati il {quando(l.iso)}</strong>
                          <span className="pill pill-gray">{l.voci.length}</span>
                          <span className="hint">{l.formati.join(" · ")}</span>
                        </summary>
                        <form>
                          <div className="sezione-azioni">
                            <label className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                              <BulkCheckbox name="coda" /> tutti
                            </label>
                            <span className="hint">Maiusc+clic per un intervallo; senza spunte rimette in coda tutto il lotto.</span>
                            <button className="btn btn-sm" type="submit" style={{ marginLeft: "auto" }}
                              formAction={rimettiInCodaMulti.bind(null, scopeParam, "", l.iso)}
                              title="Riporta fra quelli da stampare i cartelli spuntati, o tutto questo lotto">
                              Rimetti in coda il lotto
                            </button>
                          </div>
                          <div className="table-wrap">
                            <table className="data">
                              <thead>
                                <tr>
                                  <th style={{ width: 28 }}><BulkCheckbox name="coda" /></th>
                                  <ColonnaOrdinabile campo="nome">Prodotto</ColonnaOrdinabile>
                                  <ColonnaOrdinabile campo="marca">Marca</ColonnaOrdinabile>
                                  <ColonnaOrdinabile campo="fornitore">Fornitore</ColonnaOrdinabile>
                                  <ColonnaOrdinabile campo="animale">Animale</ColonnaOrdinabile>
                                  <ColonnaOrdinabile campo="promo">Promo</ColonnaOrdinabile>
                                  <ColonnaOrdinabile campo="formato">Formato</ColonnaOrdinabile>
                                  <th>Stampato da</th>
                                  <th></th>
                                </tr>
                              </thead>
                              <tbody>
                                {l.voci.map((c) => (
                                  <tr key={c.id}
                                    data-nome={c.nome} data-marca={c.marca} data-fornitore={c.fornitore}
                                    data-animale={c.animale} data-promo={c.promo} data-formato={formatoDiCoda(c).name}>
                                    <td><input type="checkbox" name="coda" value={c.id} title="Spunta per rimetterlo in coda" /></td>
                                    <td style={{ opacity: 0.8 }}>{c.nome}</td>
                                    <td>{c.marca}</td>
                                    <td>{c.fornitore}</td>
                                    <td>{c.animale}</td>
                                    <td>{c.promo}</td>
                                    <td>{formatoDiCoda(c).name}</td>
                                    <td className="hint">
                                      {c.userName}{c.stato === "arrivo" ? " · era in arrivo" : ""}
                                    </td>
                                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                                      <RigaAzione azione={rimettiInCodaInline.bind(null, c.id, scopeParam)}
                                        etichetta="Rimetti" contatoreId="conta-stampati"
                                        titolo="La stampa è andata male: rimettilo fra quelli da stampare" />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </form>
                      </details>
                    ))}
                  </details>
                )}
              </details>
            )}

            {codaArrivo.length > 0 && (
              <details className="sezione">
                <summary><strong>Merce in arrivo</strong> <span className="pill pill-amber" id="conta-arrivo">{codaArrivo.length}</span></summary>
                <form>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <ColonnaOrdinabile campo="nome">Prodotto</ColonnaOrdinabile>
                          <ColonnaOrdinabile campo="marca">Marca</ColonnaOrdinabile>
                          <ColonnaOrdinabile campo="fornitore">Fornitore</ColonnaOrdinabile>
                          <ColonnaOrdinabile campo="animale">Animale</ColonnaOrdinabile>
                          <ColonnaOrdinabile campo="promo">Promo</ColonnaOrdinabile>
                          <th>Formato</th>
                          <th>Segnato da</th>
                          <th></th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {ordinaCoda(codaArrivo).map((c) => (
                          <RigaCoda key={c.id} id={c.id} scopeParam={scopeParam} contatoreId="conta-arrivo" tabella
                            dati={{ nome: c.nome, marca: c.marca, fornitore: c.fornitore, animale: c.animale, promo: c.promo }}>
                            <td>{c.nome}</td>
                            <td>{c.marca}</td>
                            <td>{c.fornitore}</td>
                            <td>{c.animale}</td>
                            <td>{c.promo}</td>
                            <td>{formatoDiCoda(c).name}</td>
                            <td className="hint">{new Date(c.creato).toLocaleDateString("it-IT", { timeZone: FUSO })} · {c.userName}</td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              <RigaAzione azione={segnaArrivatoInline.bind(null, c.id, scopeParam)}
                                etichetta="Arrivata" contatoreId="conta-arrivo"
                                titolo="La merce è arrivata: passa fra quelli da stampare" />
                            </td>
                          </RigaCoda>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </form>
              </details>
            )}

            {nonConformiVoci.length > 0 && (
              <details className="sezione">
                <summary><strong>Segnati non conformi</strong> <span className="pill pill-orange">{nonConformiVoci.length}</span></summary>
                <form>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <ColonnaOrdinabile campo="nome">Prodotto</ColonnaOrdinabile>
                          <th>Articolo</th>
                          <ColonnaOrdinabile campo="marca">Marca</ColonnaOrdinabile>
                          <ColonnaOrdinabile campo="animale">Animale</ColonnaOrdinabile>
                          <th>Motivo</th>
                          <th>Segnalato da</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {nonConformiOrdinati.map((n) => (
                          <Fragment key={n.id}>
                            <tr data-nome={n.nome} data-marca={n.marca} data-fornitore={n.fornitore}
                              data-animale={n.animale} data-promo={n.promo}>
                              <td>
                                {n.nome}
                                {n.parentId && <> <DettagliPadre parentId={n.parentId} /></>}
                              </td>
                              <td className="hint">{n.articolo && n.articolo !== n.nome ? `${n.articolo} · ${n.ean}` : n.ean}</td>
                              <td>{n.marca}</td>
                              <td>{n.animale}</td>
                              <td>{n.motivo ? <em>«{n.motivo}»</em> : ""}</td>
                              <td className="hint">{new Date(n.at).toLocaleDateString("it-IT", { timeZone: FUSO })} · {n.userName}</td>
                              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                                <RigaAzione azione={togliNonConformeInline.bind(null, n.offerId, scopeParam)}
                                  etichetta="Sistemato" titolo="Il cartello è stato sistemato: togli la segnalazione" />
                              </td>
                            </tr>
                            {n.parentId && (
                              <tr><td colSpan={7} style={{ padding: 0 }}>
                                <PannelloPadre parentId={n.parentId} scopeParam={scopeParam} back="/stampe/zoo/stampa?tab=liste" />
                              </td></tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </form>
              </details>
            )}

            {esclusiVoci.length > 0 && (
              <details className="sezione">
                <summary><strong>Da non stampare</strong> <span className="pill pill-red">{esclusiVoci.length}</span></summary>
                <form>
                  <div className="sezione-azioni">
                    <span className="hint">Spunta quelli da rimettere in stampa (Maiusc+clic per un intervallo).</span>
                    <button className="btn btn-sm" type="submit" style={{ marginLeft: "auto" }}
                      formAction={rimettiInStampaMulti.bind(null, scopeParam)}
                      title="Rimette fra quelli da stampare tutti i cartelli spuntati">
                      Rimetti in stampa i selezionati
                    </button>
                  </div>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th style={{ width: 28 }}><BulkCheckbox name="escluso" /></th>
                          <ColonnaOrdinabile campo="nome">Prodotto</ColonnaOrdinabile>
                          <th>Codice</th>
                          <ColonnaOrdinabile campo="marca">Marca</ColonnaOrdinabile>
                          <ColonnaOrdinabile campo="fornitore">Fornitore</ColonnaOrdinabile>
                          <ColonnaOrdinabile campo="animale">Animale</ColonnaOrdinabile>
                          <ColonnaOrdinabile campo="promo">Promo</ColonnaOrdinabile>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {esclusiVoci.slice(0, 100).map((o) => (
                          <Fragment key={o.id}>
                            <tr data-nome={o.nome} data-marca={o.marca} data-fornitore={o.fornitore}
                              data-animale={o.animale} data-promo={o.promo}>
                              <td><input type="checkbox" name="escluso" value={o.id} title="Spunta per rimetterlo in stampa" /></td>
                              <td>
                                {o.nome}
                                {o.parentId && <> <DettagliPadre parentId={o.parentId} /></>}
                              </td>
                              <td className="hint">{o.ean}</td>
                              <td>{o.marca}</td>
                              <td>{o.fornitore}</td>
                              <td>{o.animale}</td>
                              <td>{o.promo}</td>
                              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                                <RigaAzione azione={rimettiInStampaInline.bind(null, o.id, scopeParam)}
                                  etichetta="Rimetti in stampa" titolo="Rimetti questo cartello fra quelli da stampare" />
                              </td>
                            </tr>
                            {o.parentId && (
                              <tr><td colSpan={8} style={{ padding: 0 }}>
                                <PannelloPadre parentId={o.parentId} scopeParam={scopeParam} back="/stampe/zoo/stampa?tab=liste" />
                              </td></tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {esclusiVoci.length > 100 && (
                    <p className="hint">Mostrati i primi 100 di {esclusiVoci.length}: gli altri si vedono con il filtro «Mostra anche gli esclusi».</p>
                  )}
                </form>
              </details>
            )}
          </RigheAlterne>
        )}

        {/* ================= Regole dell'insegna / PV: si toccano una volta a volantino ================= */}
        {tab === "regole" && (
          <div className="regole">
            {scope.type === "system" ? (
              <div className="card">
                <h3>Regole del Consorzio</h3>
                <p className="stato" style={{ margin: 0 }}>
                  Prezzi propri, cartelli da non stampare, offerte proprie e marche trattate sono regole di ogni insegna o punto
                  vendita: scegli l&apos;ambito in alto a destra. Le condizioni pronte e la testata dei cartelli sono in Impostazioni e Layout.
                </p>
              </div>
            ) : (
              <>
                <div className="card">
                  <h3>I prezzi di {scope.label}</h3>
                  <p className="stato">
                    {nPrezziMiei > 0 ? `${nPrezziMiei} articoli con il vostro prezzo al posto di quello del Consorzio.` : "Nessun prezzo vostro: si stampano quelli del Consorzio."}
                  </p>
                  <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 8px" }}>
                    Se i prezzi di {scope.label} differiscono da quelli del Consorzio, carica un Excel con EAN (o CODICE
                    FORNITORE) e PREZZO: sostituirà il prezzo promo sui cartelli di questo ambito, articolo per articolo.{" "}
                    <a href={`/stampe/zoo/excel?prezzi=1&scope=${scopeParam}`}>Scarica il modello precompilato</a>
                  </p>
                  <ImportExcel
                    action={importPvPricesRighe.bind(null, scopeParam)}
                    colonne={["ean", "codice ean", "barcode", "codice fornitore", "cod. fornitore", "codice", "prezzo", "prezzo vendita", "prezzo pv"]}
                    etichetta="Importa prezzi"
                  />
                </div>

                <div className="card">
                  <h3>Cartelli da non stampare</h3>
                  <p className="stato">
                    {nCodiciNoPrint > 0
                      ? `${nCodiciNoPrint} ${nCodiciNoPrint === 1 ? "codice" : "codici"} in elenco, ${allOffers.filter((o) => noPrint.eans.has(o.ean)).length} sui cartelli di questo periodo.`
                      : "Nessun codice in elenco."}
                  </p>
                  <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 8px" }}>
                    Carica un Excel con i codici a barre (o i CODICE FORNITORE) degli articoli che {scope.label} non espone:
                    spariscono dai cartelli senza toccare l&apos;offerta degli altri. L&apos;esclusione segue l&apos;articolo, quindi vale
                    anche per i volantini successivi. Se aggiungi la colonna NON STAMPARE, un &laquo;no&raquo; rimette il cartello in
                    stampa.{" "}
                    <a href={`/stampe/zoo/excel?nonstampare=1&scope=${scopeParam}`}>Scarica il modello precompilato</a>
                  </p>
                  <ImportExcel
                    action={importZooNoPrintRighe.bind(null, scopeParam)}
                    colonne={[
                      "ean", "codice ean", "barcode", "codice a barre", "cod. barre",
                      "codice fornitore", "cod. fornitore", "codice articolo", "codice",
                      "non stampare", "non stamparlo", "escludi", "stampa", "stampare",
                    ]}
                    etichetta="Importa i codici"
                  />
                  {nCodiciNoPrint > 0 && (
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
                      <a className="btn btn-outline btn-sm" href={`/stampe/zoo/stampa?scope=${scopeParam}&stato=soloesclusi`}>Vedi gli esclusi</a>
                      <form action={svuotaZooNoPrint.bind(null, scopeParam)}>
                        <button className="btn btn-outline btn-sm" type="submit">Svuota l&apos;elenco</button>
                      </form>
                    </div>
                  )}
                </div>

                {gestione && (
                  <div className="card">
                    <h3>Le offerte di {scope.label}</h3>
                    <p className="stato">
                      {offerteProprie.length > 0 ? `${offerteProprie.length} ${offerteProprie.length === 1 ? "offerta vostra" : "offerte vostre"} in questo periodo.` : "Nessuna offerta vostra in questo periodo."}
                    </p>
                    <p className="hint" style={{ margin: "0 0 8px" }}>
                      Promozioni vostre, fuori dal volantino del Consorzio: si stampano nei vostri cartelli insieme alle altre.
                      L&apos;articolo dev&apos;essere nel catalogo — il vostro o quello comune.
                    </p>
                    {sp.offerta === "ok" && <div className="alert alert-green">✓ Offerta aggiunta: la trovi nell&apos;elenco della scheda Stampa.</div>}
                    {sp.offerta === "eliminata" && <div className="alert alert-green">✓ Offerta eliminata.</div>}
                    {sp.offerta === "dati" && <div className="alert alert-amber">Servono almeno il codice a barre e il prezzo.</div>}
                    {sp.offerta === "permessi" && <div className="alert alert-amber">Le offerte proprie le crea chi gestisce le Offerte Zoo per {scope.label}.</div>}
                    {sp.offerta === "sconosciuto" && (
                      <div className="alert alert-amber">
                        Quel codice a barre non è fra i vostri articoli né in quelli del Consorzio: caricalo prima da Database prodotti.
                      </div>
                    )}
                    <form action={creaOffertaPropria.bind(null, scopeParam)}
                      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, alignItems: "end" }}>
                      <label className="field" style={{ marginBottom: 0 }}>Codice a barre<input type="text" name="ean" required placeholder="8001234567890" /></label>
                      <label className="field" style={{ marginBottom: 0 }}>Descrizione<input type="text" name="descrizione" placeholder="(quella dell'articolo)" /></label>
                      <label className="field" style={{ marginBottom: 0 }}>Prezzo promo<input type="text" name="prezzoPromo" required placeholder="4,99" /></label>
                      <label className="field" style={{ marginBottom: 0 }}>Prezzo barrato<input type="text" name="prezzoListino" placeholder="6,99" /></label>
                      <label className="field" style={{ marginBottom: 0 }}>Meccanica<input type="text" name="meccanica" placeholder="es. 3x2" /></label>
                      <label className="field" style={{ marginBottom: 0 }}>Condizioni<input type="text" name="condizioni" placeholder="fino a esaurimento" /></label>
                      <button className="btn btn-sm" type="submit">Aggiungi offerta</button>
                    </form>
                    {offerteProprie.length > 0 && (
                      <div className="table-wrap" style={{ marginTop: 10 }}>
                        <table className="data">
                          <thead><tr><th>Articolo</th><th>EAN</th><th>Prezzo</th><th>Barrato</th><th>Meccanica</th><th></th></tr></thead>
                          <tbody>
                            {offerteProprie.map((o) => (
                              <tr key={o.id}>
                                <td style={{ fontSize: 12.5 }}>{o.descrizione}</td>
                                <td style={{ fontSize: 12 }}>{o.ean}</td>
                                <td><strong>€ {o.prezzoPromo}</strong></td>
                                <td style={{ fontSize: 12 }}>{o.prezzoListino ? `€ ${o.prezzoListino}` : "—"}</td>
                                <td style={{ fontSize: 12 }}>{o.meccanica || "—"}</td>
                                <td>
                                  <form action={eliminaOffertaPropria.bind(null, o.id, scopeParam)}>
                                    <button className="btn btn-outline btn-sm" type="submit" style={{ color: "var(--red)", borderColor: "var(--red)" }}>Elimina</button>
                                  </form>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {marche.length > 0 && (
                  <div className="card">
                    <h3>Marche trattate da {scope.label}</h3>
                    <p className="stato">
                      {marcheEscluse.length > 0 ? `${marcheEscluse.length} ${marcheEscluse.length === 1 ? "marca esclusa" : "marche escluse"} su ${marche.length}.` : `Le trattate tutte (${marche.length}).`}
                    </p>
                    <p className="hint" style={{ margin: "0 0 8px" }}>
                      Clicca una marca per cambiare stato. <span className="pill pill-green">verde = la trattate</span>{" "}
                      <span className="pill pill-gray">✕ grigio = non la trattate</span> — quelle escluse spariscono da stampa
                      cartelli e dal database prodotti, per questo volantino e per i prossimi, finché non le rimetti.
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {marche.map((m) => {
                        const esclusa = marcheEscluse.includes(m);
                        return (
                          <form key={`ex_${m}`} action={toggleZooHidden.bind(null, scopeParam, "marca", m, "/stampe/zoo/stampa?tab=regole")}>
                            <button type="submit" className={`pill ${esclusa ? "pill-gray" : "pill-green"}`}
                              style={{ cursor: "pointer", border: "none" }}
                              title={esclusa ? `Rimetti ${m} fra quelle trattate` : `Segna ${m} come non trattata`}>
                              {esclusa ? `✕ ${m} — non trattata` : `${m}`}
                            </button>
                          </form>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}

            {campaign && nStampati > 0 && (
              <div className="card">
                <h3>Segno &quot;già stampato&quot;</h3>
                <p className="stato">{nStampati} cartelli risultano già stampati da {scope.label} in questo periodo.</p>
                <form action={resetZooPrinted.bind(null, "/stampe/zoo/stampa?tab=regole", scopeParam, campaign.id)}>
                  <button className="btn btn-outline btn-sm" type="submit"
                    title="Rimette tutti i cartelli di questo periodo come «da stampare»">
                    Azzera &quot;già stampato&quot;
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
