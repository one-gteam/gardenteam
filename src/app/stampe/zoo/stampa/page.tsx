import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import StampeHeader from "@/components/stampe/StampeHeader";
import Cartello from "@/components/stampe/Cartello";
import StampaPicker from "@/components/stampe/StampaPicker";
import { canAccessArea, scopesForUser, resolveScope } from "@/lib/stampe";
import InlineEdit from "@/components/stampe/InlineEdit";
import InlineSelect from "@/components/stampe/InlineSelect";
import {
  getZooDb, effectiveZooLayout, zooCartelloValues, pvPriceFor, isZooHidden,
  campagneStampabili, campagnaInCorso, campagnaInLavorazione, campaignStato,
  effectiveParentText, effectiveParentTag, effectiveOfferText, printedAt, NO_VOLANTINO,
  ZOO_FIELDS, ZOO_FORMATS,
} from "@/lib/zoo";
import {
  importPvPrices, markZooPrinted, resetZooPrinted,
  updateParentFieldInline, setParentTagScoped, setOfferTextScoped, setPvPriceInline,
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

  /*
   * Si stampano i cartelli di due periodi promozionali: quello IN CORSO a scaffale
   * e quello IN PREPARAZIONE (i cartelli si stampano prima che le offerte partano).
   * Di default si apre quello in corso, che è il caso di tutti i giorni.
   */
  const stampabili = campagneStampabili(db);
  const campaign =
    stampabili.find((c) => c.id === sp.campagna) ?? campagnaInCorso(db) ?? campagnaInLavorazione(db);
  const allOffers = campaign ? db.offers.filter((o) => o.campaignId === campaign.id) : [];
  const etichettaPeriodo = (c: (typeof stampabili)[number]) => {
    const p = campaignStato(c) === "lavorazione" ? "in preparazione" : "in corso";
    const d = (x: string) => (x ? new Date(`${x}T00:00:00`).toLocaleDateString("it-IT") : "—");
    return `${c.nome} (${p}: ${d(c.dal)} → ${d(c.al)})`;
  };
  /** L'offerta finisce sul volantino? (pagina assegnata e non scartata) */
  const inVolantino = (o: (typeof allOffers)[number]) =>
    Boolean(o.selezionata) || (Boolean(o.paginaId) && o.paginaId !== NO_VOLANTINO);

  const q = (sp.q ?? "").toLowerCase();
  const visible = allOffers.filter((o) => {
    const product = db.products.find((p) => p.id === o.productId);
    if (product && isZooHidden(db, scope, product, academyDb)) return false;
    if (sp.scheda && o.schedaId !== sp.scheda) return false;
    if (sp.marca && product?.marca !== sp.marca) return false;
    if (sp.volantino === "si" && !inVolantino(o)) return false;
    if (sp.volantino === "no" && inVolantino(o)) return false;
    if (sp.stampati === "si" && !printedAt(db, scope, o.id)) return false;
    if (sp.stampati === "no" && printedAt(db, scope, o.id)) return false;
    if (q && !`${o.descrizione} ${o.ean} ${product?.marca ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const marche = [...new Set(allOffers.map((o) => db.products.find((p) => p.id === o.productId)?.marca).filter(Boolean) as string[])].sort();
  const nStampati = allOffers.filter((o) => printedAt(db, scope, o.id)).length;

  const selectedIds = (sp.sel ?? "").split(",").filter(Boolean);
  const selected = selectedIds.map((id) => allOffers.find((o) => o.id === id)).filter(Boolean) as typeof allOffers;
  const globalFormatId = sp.formato ?? ZOO_FORMATS[0].id;
  const formatFor = (oid: string) => ZOO_FORMATS.find((f) => f.id === (sp[`formato_${oid}`] ?? globalFormatId)) ?? ZOO_FORMATS[0];

  const valuesFor = (o: (typeof allOffers)[number]) => {
    const vals = zooCartelloValues(db, o, scope, academyDb);
    const pv = pvPriceFor(db, scope, o.ean, academyDb);
    if (pv) vals.prezzoPromo = `€ ${pv}`;
    const customPrice = sp[`prezzo_${o.id}`];
    if (customPrice !== undefined && customPrice !== "") vals.prezzoPromo = `€ ${customPrice}`;
    if (sp[`noprezzo_${o.id}`] === "1") {
      delete vals.prezzoPromo;
      delete vals.prezzoListino;
    }
    for (const fid of (sp[`nascondi_${o.id}`] ?? "").split(",").filter(Boolean)) delete vals[fid];
    return vals;
  };

  const qsBack = () => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "print") params.set(k, v);
    return params.toString();
  };

  const scalePrint = 3.7795; // 1 mm = 3.7795 px a 96 dpi → stampa a dimensione reale
  const doppio = sp.doppio === "1";
  // tag del padre (animale + caratteristica insieme): decidono quale layout collegato usare in stampa
  const tagsFor = (o: (typeof allOffers)[number]) => {
    const product = db.products.find((p) => p.id === o.productId);
    const parent = product?.parentId ? db.parents.find((x) => x.id === product.parentId) : undefined;
    return parent?.caratteristiche ?? [];
  };

  if (sp.print === "1" && selected.length > 0) {
    const toPrint = selected.flatMap((o) => (doppio && formatFor(o.id).id === "za5" ? [o, o] : [o]));
    return (
      <div>
        <div className="no-print" style={{ padding: 14, display: "flex", gap: 10, alignItems: "center", background: "var(--green-50)", flexWrap: "wrap" }}>
          <strong>Anteprima di stampa — {toPrint.length} cartelli</strong>
          <a className="btn btn-outline btn-sm" href={`/stampe/zoo/stampa?${qsBack()}`}>← Torna alla selezione</a>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            Usa il pulsante Stampa del browser (Ctrl+P) e scegli &quot;Salva come PDF&quot;.
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

        {scope.type !== "system" && (
          <div className="card" style={{ marginBottom: 16, padding: 14 }}>
            <strong>Carica i tuoi prezzi</strong>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 8px" }}>
              Se i prezzi di {scope.label} differiscono da quelli del Consorzio, carica un Excel con EAN (o CODICE
              FORNITORE) e PREZZO: sostituirà il prezzo promo sui cartelli di questo ambito, articolo per articolo.{" "}
              <a href={`/stampe/zoo/excel?prezzi=1&scope=${scopeParam}`}>Scarica il modello precompilato</a>
            </p>
            <form action={importPvPrices.bind(null, scopeParam)} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="file" name="file" accept=".xlsx,.xls,.csv" required />
              <button className="btn btn-sm" type="submit">Importa prezzi</button>
            </form>
          </div>
        )}

        {sp.azzerati !== undefined && (
          <div className="alert alert-green">✓ Azzerato il &quot;già stampato&quot; su {sp.azzerati} cartelli.</div>
        )}

        <div className="card" style={{ marginBottom: 16, padding: 14 }}>
          <form method="get" style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr)) auto", gap: 10, alignItems: "end" }}>
            <input type="hidden" name="scope" value={scopeParam} />
            <input type="hidden" name="sel" value={sp.sel ?? ""} />
            {campaign && <input type="hidden" name="campagna" value={campaign.id} />}
            <label className="field" style={{ marginBottom: 0 }}>Cerca<input type="text" name="q" defaultValue={sp.q ?? ""} placeholder="descrizione, EAN, marca" /></label>
            <label className="field" style={{ marginBottom: 0 }}>
              Scheda volantino
              <select name="scheda" defaultValue={sp.scheda ?? ""}>
                <option value="">Tutte le offerte</option>
                {(campaign?.schede ?? []).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
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
              Marca
              <select name="marca" defaultValue={sp.marca ?? ""}>
                <option value="">Tutte</option>
                {marche.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <button className="btn btn-sm" type="submit">Filtra</button>
          </form>
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

        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr 300px", gap: 16, alignItems: "start" }}>
          <StampaPicker
            products={visible.slice(0, 150).map((o) => {
              const product = db.products.find((p) => p.id === o.productId);
              return {
                id: o.id,
                titolo: o.descrizione,
                codice: o.ean,
                prezzo: pvPriceFor(db, scope, o.ean, academyDb) ?? o.prezzoPromo,
                tipologia: product?.marca ?? "",
              };
            })}
            formats={ZOO_FORMATS.map((f) => ({ id: f.id, name: f.name }))}
            scopeParam={scopeParam}
            filters={{
              q: sp.q ?? "", scheda: sp.scheda ?? "", marca: sp.marca ?? "",
              volantino: sp.volantino ?? "", stampati: sp.stampati ?? "", campagna: campaign?.id ?? "",
            }}
            printed={Object.fromEntries(
              visible.map((o) => [o.id, printedAt(db, scope, o.id) ?? ""]).filter(([, v]) => v)
            )}
            onPrint={markZooPrinted.bind(null, scopeParam)}
            initialSelected={selectedIds}
            initialFormats={Object.fromEntries(
              selectedIds.map((id) => [id, sp[`formato_${id}`] ?? globalFormatId]).filter(([, v]) => v)
            )}
            initialPrices={Object.fromEntries(selectedIds.map((id) => [id, sp[`prezzo_${id}`] ?? ""]).filter(([, v]) => v))}
            initialNoPrice={Object.fromEntries(selectedIds.map((id) => [id, sp[`noprezzo_${id}`] === "1"]))}
            initialHidden={Object.fromEntries(
              selectedIds.map((id) => [id, (sp[`nascondi_${id}`] ?? "").split(",").filter(Boolean)])
            )}
            fields={ZOO_FIELDS.map((f) => ({ id: f.id, label: f.label }))}
            globalFormat={globalFormatId}
            baseUrl="/stampe/zoo/stampa"
          />

          {/* anteprima */}
          <div>
            {selected.slice(0, 2).map((o) => (
              <div key={o.id} style={{ marginBottom: 12 }}>
                <Cartello
                  format={formatFor(o.id)}
                  layout={effectiveZooLayout(db, scope, formatFor(o.id).id, academyDb, tagsFor(o))}
                  fields={ZOO_FIELDS}
                  values={valuesFor(o)}
                  scale={formatFor(o.id).w > 150 ? 1.6 : 2.4}
                />
              </div>
            ))}
            {selected.length === 0 && (
              <div className="card"><p className="empty">L&apos;anteprima appare dopo &quot;Aggiorna anteprima&quot;.</p></div>
            )}
          </div>
        </div>

        {/* personalizzazione dei testi del cartello per questo ambito */}
        {selected.length > 0 && (
          <div className="card" style={{ marginTop: 16, padding: 14 }}>
            <h2 style={{ marginTop: 0 }}>
              {scope.type === "system" ? "Testi del cartello (versione Consorzio)" : `Personalizza per ${scope.label}`}
            </h2>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 10px" }}>
              {scope.type === "system"
                ? "Stai modificando i testi comuni a tutte le insegne."
                : `Le modifiche qui sotto valgono solo per i cartelli di ${scope.label}: la versione del Consorzio resta intatta. Un campo lasciato uguale a quello del Consorzio non crea una personalizzazione.`}
            </p>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Titolo (padre)</th>
                    <th className="col-wide">Descrizione (cartello)</th>
                    <th>Animale</th>
                    <th>Caratteristica</th>
                    <th>Prezzo</th>
                    <th>Condizioni</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.map((o) => {
                    const product = db.products.find((p) => p.id === o.productId);
                    const parent = product?.parentId ? db.parents.find((x) => x.id === product.parentId) : undefined;
                    const nome = parent ? effectiveParentText(db, scope, parent, "nome", academyDb) : undefined;
                    const desc = parent ? effectiveParentText(db, scope, parent, "descCartello", academyDb) : undefined;
                    const animale = parent ? effectiveParentTag(db, scope, parent, "animale", academyDb) : undefined;
                    const caratt = parent ? effectiveParentTag(db, scope, parent, "prodotto", academyDb) : undefined;
                    const cond = effectiveOfferText(db, scope, o, "condizioni", academyDb);
                    const pv = pvPriceFor(db, scope, o.ean, academyDb);
                    return (
                      <tr key={o.id}>
                        <td>
                          {parent ? (
                            <>
                              <InlineEdit value={nome!.value}
                                onSave={updateParentFieldInline.bind(null, parent.id, "nome", scopeParam)} />
                              {nome!.custom && <span className="pill pill-orange">personalizzato</span>}
                            </>
                          ) : (
                            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{o.descrizione} (senza padre)</span>
                          )}
                        </td>
                        <td className="col-wide">
                          {parent ? (
                            <>
                              <InlineEdit value={desc!.value} multiline placeholder="descrizione per il cartello…"
                                onSave={updateParentFieldInline.bind(null, parent.id, "descCartello", scopeParam)} />
                              {desc!.custom && <span className="pill pill-orange">personalizzata</span>}
                            </>
                          ) : <span className="pill pill-gray">—</span>}
                        </td>
                        <td>
                          {parent ? (
                            <>
                              <InlineSelect value={animale!.value} options={db.settings.categorieAnimali}
                                onSave={setParentTagScoped.bind(null, parent.id, "animale", scopeParam)} />
                              {animale!.custom && <span className="pill pill-orange">personalizzato</span>}
                            </>
                          ) : <span className="pill pill-gray">—</span>}
                        </td>
                        <td>
                          {parent ? (
                            <>
                              <InlineSelect value={caratt!.value} options={db.settings.caratteristicheProdotto}
                                onSave={setParentTagScoped.bind(null, parent.id, "prodotto", scopeParam)} />
                              {caratt!.custom && <span className="pill pill-orange">personalizzata</span>}
                            </>
                          ) : <span className="pill pill-gray">—</span>}
                        </td>
                        <td>
                          {scope.type === "system" ? (
                            <strong>€ {o.prezzoPromo}</strong>
                          ) : (
                            <>
                              <InlineEdit value={pv ?? ""} placeholder={o.prezzoPromo}
                                onSave={setPvPriceInline.bind(null, o.ean, scopeParam)} />
                              {pv
                                ? <span className="pill pill-orange">vostro prezzo</span>
                                : <span className="hint">Consorzio: € {o.prezzoPromo}</span>}
                            </>
                          )}
                        </td>
                        <td>
                          {db.settings.condizioniStandard.length > 0 && (
                            <InlineSelect value={db.settings.condizioniStandard.includes(cond.value) ? cond.value : ""}
                              options={db.settings.condizioniStandard} vuoto="— scegli una condizione pronta —"
                              onSave={setOfferTextScoped.bind(null, o.id, "condizioni", scopeParam)} />
                          )}
                          <InlineEdit value={cond.value} placeholder="oppure scrivi le tue condizioni…"
                            onSave={setOfferTextScoped.bind(null, o.id, "condizioni", scopeParam)} />
                          {cond.custom && <span className="pill pill-orange">personalizzate</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
