import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import StampeHeader from "@/components/stampe/StampeHeader";
import Cartello from "@/components/stampe/Cartello";
import StampaWorkspace from "@/components/stampe/StampaWorkspace";
import ImportExcel from "@/components/stampe/ImportExcel";
import { canAccessArea, gestisceArea, scopesForUser, resolveScope } from "@/lib/stampe";
import {
  getZooDb, effectiveZooLayout, pvPriceFor, isZooHidden,
  campagneStampabili, campagnaInCorso, campagnaInLavorazione, campaignStato,
  effectiveParentText, effectiveParentTag, printedAt, NO_VOLANTINO,
  ZOO_FIELDS, ZOO_FORMATS, marcaEffettiva, noPrintSets, offertePerStampa, tagsPerLayout, valoriPerStampa, giacenzePer,
} from "@/lib/zoo";
import {
  importPvPricesRighe, markZooPrinted, resetZooPrinted, toggleZooHidden, importZooNoPrintRighe, svuotaZooNoPrint,
  creaOffertaPropria, eliminaOffertaPropria, stampaCoda, segnaArrivato, togliDallaCoda,
} from "@/lib/zoo-actions";

/** Stampa cartelli Offerte Zoo: stesso impianto dell'Arredo (selezione, formati per riga, stampa 1:1). */
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

  const q = (sp.q ?? "").toLowerCase();
  /*
   * La ricerca guarda anche il nome del prodotto padre e la descrizione
   * dell'articolo: la descrizione dell'offerta da sola ("NUTRIMI 70GR TONNO")
   * non conteneva il nome con cui la gente lo cerca ("Life Pet Care").
   */
  const padreDi = (o: (typeof allOffers)[number]) => {
    const product = db.products.find((p) => p.id === o.productId);
    const parent = product?.parentId ? db.parents.find((x) => x.id === product.parentId) : undefined;
    return { product, parent };
  };
  const visible = allOffers.filter((o) => {
    const { product, parent } = padreDi(o);
    if (product && isZooHidden(db, scope, product, academyDb)) return false;
    if (sp.animale && !(parent ? effectiveParentTag(db, scope, parent, "animale", academyDb).value : "").includes(sp.animale)) return false;
    if (sp.caratt && !(parent ? effectiveParentTag(db, scope, parent, "prodotto", academyDb).value : "").includes(sp.caratt)) return false;
    if (marcheScelte.length > 0 && !marcheScelte.includes(marcaEffettiva(product ?? { marca: "", fornitore: "" }))) return false;
    if (sp.nonstampabili !== "si" && sp.nonstampabili !== "solo" && escluso(o)) return false;
    if (sp.nonstampabili === "solo" && !escluso(o)) return false;
    if (sp.volantino === "si" && !inVolantino(o)) return false;
    if (sp.volantino === "no" && inVolantino(o)) return false;
    if (sp.stampati === "si" && !printedAt(db, scope, o.id)) return false;
    if (sp.stampati === "no" && printedAt(db, scope, o.id)) return false;
    if (q) {
      const testo = [
        o.descrizione, o.ean, marcaEffettiva(product ?? { marca: "", fornitore: "" }), product?.descrizione ?? "", product?.codice ?? "",
        parent ? effectiveParentText(db, scope, parent, "nome", academyDb).value : "",
      ].join(" ").toLowerCase();
      if (!testo.includes(q)) return false;
    }
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
    const product = db.products.find((p) => p.id === o.productId);
    return product ? marcaEffettiva(product) : "";
  };
  const voceSingola = (o: (typeof allOffers)[number]) => ({
    id: o.id,
    titolo: o.descrizione,
    codice: o.ean,
    prezzo: pvPriceFor(db, scope, o.ean, academyDb) ?? o.prezzoPromo,
    listino: o.prezzoListino,
    tipologia: marcaDi(o),
    giacenza: giacenzaDi([o.ean]),
  });
  // giacenze dal gestionale collegato (se c'è): una chiamata per tutti i codici in elenco
  const giacenze = await giacenzePer(db, scope, academyDb, visible.map((o) => o.ean));
  const giacenzaDi = (eans: string[]) => {
    const trovate = eans.map((e) => giacenze[e]).filter(Boolean);
    return trovate.length > 0 ? String(trovate.reduce((t, g) => t + g.giacenza, 0)) : undefined;
  };
  const voci = vistaSingole
    ? visible.map(voceSingola)
    : (() => {
        const gruppi = new Map<string, typeof visible>();
        for (const o of visible) {
          const product = db.products.find((p) => p.id === o.productId);
          const key = product?.parentId ? `p:${product.parentId}` : `o:${o.id}`;
          gruppi.set(key, [...(gruppi.get(key) ?? []), o]);
        }
        return [...gruppi.entries()].map(([key, gruppo]) => {
          const primo = gruppo[0];
          if (!key.startsWith("p:") || gruppo.length === 0) return voceSingola(primo);
          const parent = db.parents.find((x) => x.id === key.slice(2));
          const prezzi = [...new Set(gruppo.map((g) => pvPriceFor(db, scope, g.ean, academyDb) ?? g.prezzoPromo).filter(Boolean))];
          return {
            id: primo.id,
            titolo: parent ? effectiveParentText(db, scope, parent, "nome", academyDb).value || primo.descrizione : primo.descrizione,
            codice: gruppo.length > 1 ? `${gruppo.length} articoli` : primo.ean,
            prezzo: prezzi.length > 1 ? `da ${[...prezzi].sort()[0]}` : (prezzi[0] ?? ""),
            listino: primo.prezzoListino,
            tipologia: marcaDi(primo),
            giacenza: giacenzaDi(gruppo.map((g) => g.ean)),
          };
        });
      })();

  // cartelli in coda per questo ambito, con il nome che si legge in elenco
  const nomeOfferta = (offerId: string) => {
    const o = allOffers.find((x) => x.id === offerId);
    if (!o) return offerId;
    const { parent } = padreDi(o);
    return parent ? effectiveParentText(db, scope, parent, "nome", academyDb).value || o.descrizione : o.descrizione;
  };
  const codaMia = db.coda
    .filter((c) => c.scopeType === scope.type && c.scopeId === scope.id && !c.stampato)
    .map((c) => ({ ...c, nome: nomeOfferta(c.offerId) }));
  const codaDopo = codaMia.filter((c) => c.stato === "dopo");
  const codaArrivo = codaMia.filter((c) => c.stato === "arrivo");

  const selectedIds = (sp.sel ?? "").split(",").filter(Boolean);
  const selected = selectedIds.map((id) => allOffers.find((o) => o.id === id)).filter(Boolean) as typeof allOffers;
  const globalFormatId = sp.formato ?? ZOO_FORMATS[0].id;
  const formatFor = (oid: string) => ZOO_FORMATS.find((f) => f.id === (sp[`formato_${oid}`] ?? globalFormatId)) ?? ZOO_FORMATS[0];

  const valuesFor = (o: (typeof allOffers)[number]) => valoriPerStampa(db, scope, academyDb, o, sp);

  const qsBack = () => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "print") params.set(k, v);
    return params.toString();
  };

  const scalePrint = 3.7795; // 1 mm = 3.7795 px a 96 dpi → stampa a dimensione reale
  const doppio = sp.doppio === "1";
  const tagsFor = (o: (typeof allOffers)[number]) => tagsPerLayout(db, scope, academyDb, o);

  if (sp.print === "1" && selected.length > 0) {
    const toPrint = selected.flatMap((o) => (doppio && formatFor(o.id).id === "za5" ? [o, o] : [o]));
    return (
      <div>
        {/*
          * Due A5 stanno su un foglio solo se il foglio è orizzontale: 148+148 mm
          * entrano nei 297 mm dell'A4 in orizzontale, non nei 210 dell'A4 in
          * verticale. Senza questa riga la spunta "foglio A4 pieno" mandava ogni
          * copia su una pagina sua, cioè il contrario di quello che prometteva.
          */}
        {doppio && <style>{`@page { size: 297mm 210mm; margin: 0; }`}</style>}
        <div className="no-print" style={{ padding: 14, display: "flex", gap: 10, alignItems: "center", background: "var(--green-50)", flexWrap: "wrap" }}>
          <strong>Anteprima di stampa — {toPrint.length} cartelli</strong>
          <a className="btn btn-outline btn-sm" href={`/stampe/zoo/stampa?${qsBack()}`}>← Torna alla selezione</a>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            Usa il pulsante Stampa del browser (Ctrl+P) e scegli &quot;Salva come PDF&quot;.
            {doppio && " Il foglio esce orizzontale: due A5 affiancati per pagina."}
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {toPrint.map((o, i) => (
            <div key={`${o.id}_${i}`} style={{ pageBreakInside: "avoid" }}>
              <Cartello
                format={formatFor(o.id)}
                layout={effectiveZooLayout(db, scope, formatFor(o.id).id, academyDb, tagsFor(o))}
                fields={ZOO_FIELDS}
                values={valuesFor(o)}
                scale={scalePrint}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <StampeHeader user={user} active="stampa" area="zoo" />
      <div className="container">
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Stampa cartelli</h1>
            <p className="subtitle" style={{ margin: "4px 0 0" }}>
              {campaign ? `${campaign.nome} · versione dati e layout di: ` : "Nessun volantino da stampare · ambito: "}
              <strong>{scope.label}</strong>
            </p>
          </div>
          {scope.type !== "system" && (
          <details className="strumento" open={sp.prezzi !== undefined}>
            <summary className="btn btn-outline btn-sm">Carica i tuoi prezzi</summary>
          <div className="card" style={{ marginTop: 10, padding: 14 }}>
            <strong>Carica i tuoi prezzi</strong>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 8px" }}>
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
          </details>
          )}

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

          {scope.type !== "system" && (
          <details className="strumento" open={sp.noprint !== undefined}>
            <summary className="btn btn-outline btn-sm">Cartelli da non stampare</summary>
          <div className="card" style={{ marginTop: 10, padding: 14 }}>
            <strong>Cartelli da non stampare</strong>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 8px" }}>
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
            {noPrint.eans.size > 0 && (
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  {noPrint.eans.size} {noPrint.eans.size === 1 ? "codice" : "codici"} in elenco,{" "}
                  {allOffers.filter((o) => noPrint.eans.has(o.ean)).length} sui cartelli di questo periodo.
                </span>
                <a className="btn btn-outline btn-sm" href={`/stampe/zoo/stampa?scope=${scopeParam}&nonstampabili=si`}>Vedi gli esclusi</a>
                <form action={svuotaZooNoPrint.bind(null, scopeParam)}>
                  <button className="btn btn-outline btn-sm" type="submit">Svuota l&apos;elenco</button>
                </form>
              </div>
            )}
          </div>
          </details>
          )}

          {/* periodo promozionale: quello in corso a scaffale o quello in preparazione */}
          {stampabili.length > 1 && (
            <form method="get" style={{ display: "flex", gap: 8, alignItems: "end" }}>
              <input type="hidden" name="scope" value={scopeParam} />
              <label className="field" style={{ marginBottom: 0 }}>
                Periodo promozionale
                <select name="campagna" defaultValue={campaign?.id ?? ""}>
                  {stampabili.map((c) => (
                    <option key={c.id} value={c.id}>{etichettaPeriodo(c)}</option>
                  ))}
                </select>
              </label>
              <button className="btn btn-sm" type="submit">Cambia</button>
            </form>
          )}
          <form method="get" style={{ display: "flex", gap: 8, alignItems: "end" }}>
            {Object.entries(sp).map(([k, v]) => (k !== "scope" && v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
            <label className="field" style={{ marginBottom: 0 }}>
              Insegna / PV
              <select name="scope" defaultValue={scopeParam}>
                {scopes.map((s) => <option key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>{s.label}</option>)}
              </select>
            </label>
            <button className="btn btn-sm" type="submit">OK</button>
          </form>
        </div>

        {sp.prezzi !== undefined && (
          <div className="alert alert-green">
            ✓ {sp.prezzi} prezzi caricati per {scope.label}: sostituiscono il prezzo promo del Consorzio sui cartelli di questo ambito.
          </div>
        )}

        {sp.azzerati !== undefined && (
          <div className="alert alert-green">✓ Azzerato il &quot;già stampato&quot; su {sp.azzerati} cartelli.</div>
        )}

        {/* cartelli messi da parte: si stampano in blocco con le impostazioni già decise */}
        {(codaDopo.length > 0 || codaArrivo.length > 0) && (
          <div className="card" style={{ marginBottom: 16, padding: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
              {([["dopo", "Da stampare più tardi", codaDopo], ["arrivo", "Merce in arrivo", codaArrivo]] as const).map(([stato, titolo, voci]) => (
                voci.length > 0 && (
                  <form key={stato} action={stampaCoda.bind(null, scopeParam, stato)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                      <strong>{titolo}</strong>
                      <span className="pill pill-orange">{voci.length}</span>
                      {stato === "dopo" && (
                        <button className="btn btn-sm" type="submit" style={{ marginLeft: "auto" }}
                          title="Apre l'anteprima di stampa di tutti (o dei soli spuntati) con le impostazioni salvate, e li toglie dalla coda">
                          Stampa {voci.length > 1 ? "tutti" : ""} →
                        </button>
                      )}
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", fontSize: 12.5 }}>
                      {voci.map((c) => (
                        <li key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "3px 0", borderBottom: "1px dashed var(--line)" }}>
                          {stato === "dopo" && <input type="checkbox" name="coda" value={c.id} title="Spunta per stampare solo alcuni" />}
                          <span style={{ flex: 1, minWidth: 0 }}>
                            {c.nome}
                            <span className="hint" style={{ marginLeft: 6 }}>
                              {ZOO_FORMATS.find((f) => f.id === c.impostazioni[`formato_${c.offerId}`])?.name ?? "A4"}
                              {" · "}{new Date(c.creato).toLocaleDateString("it-IT")}{" · "}{c.userName}
                            </span>
                          </span>
                          {stato === "arrivo" && (
                            <button className="btn btn-outline btn-sm" type="submit" formAction={segnaArrivato.bind(null, c.id, scopeParam)}
                              title="La merce è arrivata: passa fra quelli da stampare">
                              Arrivata
                            </button>
                          )}
                          <button className="btn btn-outline btn-sm" type="submit" formAction={togliDallaCoda.bind(null, c.id, scopeParam)} title="Togli dalla coda">✕</button>
                        </li>
                      ))}
                    </ul>
                  </form>
                )
              ))}
            </div>
          </div>
        )}

        <div className="card" style={{ marginBottom: 16, padding: 14 }}>
          <form method="get" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr)) auto", gap: 10, alignItems: "end" }}>
            <input type="hidden" name="scope" value={scopeParam} />
            <input type="hidden" name="sel" value={sp.sel ?? ""} />
            {campaign && <input type="hidden" name="campagna" value={campaign.id} />}
            <label className="field" style={{ marginBottom: 0 }}>Cerca<input type="text" name="q" defaultValue={sp.q ?? ""} placeholder="prodotto, articolo, EAN, marca" /></label>
            <label className="field" style={{ marginBottom: 0 }}>
              Tipologia animale
              <select name="animale" defaultValue={sp.animale ?? ""}>
                <option value="">Tutte</option>
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
              Sul volantino
              <select name="volantino" defaultValue={sp.volantino ?? ""}>
                <option value="">Tutte</option>
                <option value="si">Solo le offerte in volantino</option>
                <option value="no">Solo quelle NON in volantino</option>
              </select>
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              Già stampati
              <select name="stampati" defaultValue={sp.stampati ?? ""}>
                <option value="">Tutti</option>
                <option value="no">Solo da stampare</option>
                <option value="si">Solo già stampati</option>
              </select>
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              Elenco
              <select name="vista" defaultValue={sp.vista ?? ""}>
                <option value="">Per prodotto padre</option>
                <option value="singole">Offerte singole</option>
              </select>
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              Cartelli esclusi
              <select name="nonstampabili" defaultValue={sp.nonstampabili ?? ""} title="Gli esclusi sono i cartelli che avete segnato «Non stampare» o caricato nell'elenco dei codici da non stampare">
                <option value="">Nascondi gli esclusi</option>
                <option value="si">Mostra anche gli esclusi</option>
                <option value="solo">Solo gli esclusi</option>
              </select>
            </label>
            <button className="btn btn-sm" type="submit">Filtra</button>
            <details style={{ gridColumn: "1 / -1" }} open={marcheScelte.length > 0}>
              <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 12.5 }}>
                Marche da stampare{marcheScelte.length > 0 ? ` — ${marcheScelte.length} selezionate` : " — tutte"}
              </summary>
              <span className="hint">
                Spunta una o più marche; nessuna spunta = tutte. La marca è quella del listino o, se manca, il fornitore.
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 6 }}>
                {marche.length === 0 && <span className="hint">Nessuna marca in questo periodo.</span>}
                {marche.map((m) => (
                  <label key={m} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5 }}>
                    <input type="checkbox" name="marca" value={m} defaultChecked={marcheScelte.includes(m)} />
                    {m}
                  </label>
                ))}
              </div>
            </details>
          </form>
          {scope.type !== "system" && gestione && (
            <details style={{ marginTop: 12, borderTop: "1px dashed var(--line)", paddingTop: 10 }} open={sp.offerta === "ok" || offerteProprie.length > 0}>
              <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 12.5 }}>
                Le offerte di {scope.label}{offerteProprie.length > 0 ? ` — ${offerteProprie.length}` : ""}
              </summary>
              <p className="hint" style={{ margin: "2px 0 8px" }}>
                Promozioni vostre, fuori dal volantino del Consorzio: si stampano nei vostri cartelli insieme alle altre.
                L&apos;articolo dev&apos;essere nel catalogo — il vostro o quello comune.
              </p>
              {sp.offerta === "ok" && <div className="alert alert-green">✓ Offerta aggiunta: la trovi nell&apos;elenco qui a sinistra.</div>}
              {sp.offerta === "eliminata" && <div className="alert alert-green">✓ Offerta eliminata.</div>}
              {sp.offerta === "dati" && <div className="alert alert-amber">Servono almeno il codice a barre e il prezzo.</div>}
              {sp.offerta === "permessi" && <div className="alert alert-amber">Le offerte proprie le crea chi gestisce le Offerte Zoo per {scope.label}.</div>}
              {sp.offerta === "sconosciuto" && (
                <div className="alert alert-amber">
                  Quel codice a barre non è fra i vostri articoli né in quelli del Consorzio: caricalo prima da Database prodotti.
                </div>
              )}
              <form action={creaOffertaPropria.bind(null, scopeParam)}
                style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, alignItems: "end" }}>
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
            </details>
          )}
          {scope.type !== "system" && marche.length > 0 && (
            <details style={{ marginTop: 12, borderTop: "1px dashed var(--line)", paddingTop: 10 }} open={marcheEscluse.length > 0}>
              <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 12.5 }}>
                Marche trattate da {scope.label}
                {marcheEscluse.length > 0 ? ` — ${marcheEscluse.length} escluse` : " — le tratta tutte"}
              </summary>
              <p className="hint" style={{ margin: "2px 0 6px" }}>
                Clicca una marca per cambiare stato. <span className="pill pill-green">verde = la trattate</span>{" "}
                <span className="pill pill-gray">✕ grigio = non la trattate</span> — quelle escluse spariscono da stampa
                cartelli e dal database prodotti, per questo volantino e per i prossimi, finché non le rimetti.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {marche.map((m) => {
                  const esclusa = marcheEscluse.includes(m);
                  return (
                    <form key={`ex_${m}`} action={toggleZooHidden.bind(null, scopeParam, "marca", m, "/stampe/zoo/stampa")}>
                      <button type="submit" className={`pill ${esclusa ? "pill-gray" : "pill-green"}`}
                        style={{ cursor: "pointer", border: "none" }}
                        title={esclusa ? `Rimetti ${m} fra quelle trattate` : `Segna ${m} come non trattata`}>
                        {esclusa ? `✕ ${m} — non trattata` : `${m}`}
                      </button>
                    </form>
                  );
                })}
              </div>
            </details>
          )}
          {campaign && nStampati > 0 && (
            <form action={resetZooPrinted.bind(null, "/stampe/zoo/stampa", scopeParam, campaign.id)} style={{ marginTop: 10 }}>
              <span style={{ fontSize: 12.5, color: "var(--muted)", marginRight: 8 }}>
                {nStampati} cartelli risultano già stampati da {scope.label}.
              </span>
              <button className="btn btn-outline btn-sm" type="submit"
                title="Rimette tutti i cartelli di questo periodo come «da stampare»">
                Azzera &quot;già stampato&quot;
              </button>
            </form>
          )}
        </div>

        <StampaWorkspace
          dettagliUrl="/stampe/zoo/stampa/dettagli"
          fields={ZOO_FIELDS}
          scopeParam={scopeParam}
          picker={{
            totale: voci.length,
            mostraTuttiHref: `/stampe/zoo/stampa?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v) as [string, string][]), tutti: "1" })}`,
            products: sp.tutti === "1" ? voci : voci.slice(0, 150),
            formats: ZOO_FORMATS.map((f) => ({ id: f.id, name: f.name })),
            scopeParam,
            filters: {
              q: sp.q ?? "", animale: sp.animale ?? "", caratt: sp.caratt ?? "", marca: marcheScelte.join(","), vista: sp.vista ?? "",
              volantino: sp.volantino ?? "", stampati: sp.stampati ?? "", campagna: campaign?.id ?? "",
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
      </div>
    </div>
  );
}
