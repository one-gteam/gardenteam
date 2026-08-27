import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import StampeHeader from "@/components/stampe/StampeHeader";
import { canAccessArea, isZooEditor, scopesForUser, resolveScope } from "@/lib/stampe";
import { getDb } from "@/lib/db";
import { listStorageFiles, publicUrlFor } from "@/lib/supabase";
import PhotoUploader from "@/components/stampe/PhotoUploader";
import BulkCheckbox from "@/components/stampe/BulkCheckbox";
import InlineEdit from "@/components/stampe/InlineEdit";
import InlineSelect from "@/components/stampe/InlineSelect";
import ColumnResize from "@/components/stampe/ColumnResize";
import ParentQuickEdit from "@/components/stampe/ParentQuickEdit";
import PhotoMatcher from "@/components/stampe/PhotoMatcher";
import {
  getZooDb, zooImageUrl, effectiveParentText, campagnaInLavorazione, campagnaInCorso, campaignStato,
  suggestPhotoMatch, buildAbbinamentoIndex, animaliDi, caratteristicheProdottoDi, migraVolantinoPages,
  NO_VOLANTINO, type ZooProduct, type ZooOffer,
} from "@/lib/zoo";
import {
  importZooOffers, updateCampaignDates, associaNuoviConAI, finalizeZooPhotoUpload,
  confirmZooPhotoTargets, createZooParent, associaConAI, rigeneraTestiAI, saveParentTexts, setParentImage,
  toggleParentCaratteristica, scioglieParent, chiudiVolantino, riapriVolantino, nuovoVolantino,
  svuotaOfferteVolantino, rimuoviOfferteMarginiamo, updateParentFieldInline, updateOfferFieldInline,
  updateOfferGroupFieldInline, setParentTagInline, moveProductToParent, setParentImageFromFile,
} from "@/lib/zoo-actions";

// "Associa con AI" può richiedere più dei 10s di default per un lotto di articoli:
// alza il limite dove la piattaforma lo consente (vale anche per le server action
// invocate da questa pagina, non solo per il render).
export const maxDuration = 60;

/** Le azioni su foto e padri tornano qui (le stesse servono a "Database prodotti"). */
const BACK = "/stampe/zoo/offerte";

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
 * Import offerte: la pagina di partenza del volantino IN LAVORAZIONE. Qui dentro
 * si fa tutto quello che serve a quel volantino — caricare l'Excel, caricare le
 * foto, raggruppare gli articoli in prodotti padre (a mano o con l'AI) e scrivere
 * i testi — senza dover passare dal database prodotti generale.
 */
export default async function ZooOffertePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessArea(user, "zoo")) redirect("/studente");
  const sp = await searchParams;

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

  const campaign = campagnaInLavorazione(db);
  const inCorso = campagnaInCorso(db);
  const offers = campaign ? db.offers.filter((o) => o.campaignId === campaign.id) : [];

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

  const activeParent = sp.padre ? parentById.get(sp.padre) : undefined;
  const parentChildren = activeParent ? db.products.filter((p) => p.parentId === activeParent.id) : [];

  // foto già caricate ma non ancora abbinate ad alcun articolo
  const usedPhotos = new Set(db.products.map((p) => (p.image ?? "").split("/").pop()));
  const availablePhotos = tutteLeFoto.filter(
    (f) => /\.(jpg|jpeg|png|webp)$/i.test(f) && !usedPhotos.has(f)
  );
  /*
   * Le proposte di abbinamento costano: tokenizzare tutti gli articoli senza foto
   * e confrontarli con ogni file richiede centinaia di ms ad ogni caricamento
   * della pagina. Si calcolano solo quando la sezione è aperta davvero
   * (?abbina=1), che è anche il modo in cui la sezione si comprime.
   */
  const abbinaAperto = sp.abbina === "1";
  const senzaFoto = offerProducts.filter((p) => !p.image);
  const senzaFotoById = new Map(senzaFoto.map((p) => [p.id, p]));
  const photoSuggestions = abbinaAperto
    ? (() => {
        const index = buildAbbinamentoIndex(senzaFoto);
        return availablePhotos.slice(0, 200).map((f) => ({
          file: f,
          candidates: suggestPhotoMatch(f.replace(/\.[a-z0-9]+$/i, ""), index, 5),
        }));
      })()
    : [];
  /*
   * Catalogo su cui cerca l'abbinamento manuale: tutti gli articoli del volantino
   * e tutti i prodotti padre (una foto può stare bene sul padre più che sul
   * singolo gusto). Inviato una volta sola al componente, non per riga.
   */
  const catalogoAbbinabile = abbinaAperto
    ? [
        ...db.parents.map((p) => ({ id: `p:${p.id}`, label: `[padre] ${p.nome}` })),
        ...offerProducts.map((p) => ({ id: p.id, label: `${p.descrizione} · ${p.ean}` })),
      ]
    : [];

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
  const marcheList = [...new Set(offerProducts.map((p) => p.marca).filter(Boolean))].sort();
  const fornitoriList = [...new Set(offerProducts.map((p) => p.fornitore).filter(Boolean))].sort();
  const tipiPromo = [...new Set(offers.map((o) => (o.condizioni ?? "").trim()).filter(Boolean))].sort();

  const q = (sp.q ?? "").toLowerCase();
  const visibili = offers.filter((o) => {
    const prod = prodById.get(o.productId ?? "");
    if (sp.senzapadre === "1" && prod?.parentId) return false;
    if (sp.marca && prod?.marca !== sp.marca) return false;
    if (sp.fornitore && prod?.fornitore !== sp.fornitore) return false;
    if (sp.tipopromo && (o.condizioni ?? "").trim() !== sp.tipopromo) return false;
    if (sp.animale || sp.caratt) {
      const caratts = parentOf(o)?.caratteristiche ?? [];
      if (sp.animale && !caratts.includes(sp.animale)) return false;
      if (sp.caratt && !caratts.includes(sp.caratt)) return false;
    }
    if (q && !`${o.descrizione} ${o.ean}`.toLowerCase().includes(q)) return false;
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
      const key = parent?.id ?? `_o_${o.id}`;
      const g = map.get(key) ?? { parent, offs: [] };
      g.offs.push(o);
      map.set(key, g);
    }
    return [...map.values()];
  })();
  const RIGHE_MAX = 300;
  const gruppiVisibili = gruppi.slice(0, RIGHE_MAX);
  const visibiliCap = visibili.slice(0, RIGHE_MAX);
  const nCols = (consortium ? 1 : 0) + (vistaArticoli ? 12 : 11);

  /**
   * Dettaglio del padre aperto: non più una scheda separata in cima alla
   * pagina, ma una riga espansa in mezzo alla tabella, subito sotto la riga
   * del prodotto — resta chiaro a quale riga si riferisce.
   */
  const editorRow = activeParent && (
    <tr key={`ed_${activeParent.id}`}>
      <td colSpan={nCols} style={{ background: "#f5f8fc", borderTop: "2px solid #274b7a", borderBottom: "2px solid #274b7a" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <strong style={{ fontSize: 14 }}>
            Prodotto padre: {effectiveParentText(db, scope, activeParent, "nome", academyDb).value}
            {activeParent.aiGenerated && <span className="pill pill-blue" style={{ marginLeft: 8 }}>testi AI</span>}
          </strong>
          <a className="btn btn-outline btn-sm" href={`${BACK}?${pageQs(sp, { scope: scopeParam, padre: undefined })}`}>✕ Chiudi</a>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 16 }}>
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={zooImageUrl(undefined, activeParent) === "/immagini/mancante.jpg" && parentChildren[0]
                ? zooImageUrl(parentChildren[0])
                : zooImageUrl(undefined, activeParent)}
              alt=""
              style={{ width: "100%", borderRadius: 8, background: "#fff", border: "1px solid #e4e4e4" }}
            />
            {consortium && (
              <>
                <form action={setParentImage.bind(null, BACK, activeParent.id, scopeParam)} style={{ marginTop: 8, display: "grid", gap: 6 }}>
                  <select name="fromChild" style={{ fontSize: 12 }}>
                    <option value="">Immagine di riferimento: scegli da un articolo…</option>
                    {parentChildren.filter((c) => c.image).map((c) => (
                      <option key={c.id} value={c.id}>{c.descrizione.slice(0, 45)}</option>
                    ))}
                  </select>
                  <button className="btn btn-outline btn-sm" type="submit">Usa questa</button>
                </form>
                <form action={setParentImage.bind(null, BACK, activeParent.id, scopeParam)} style={{ marginTop: 6, display: "grid", gap: 6 }}>
                  <input type="file" name="file" accept="image/*" style={{ fontSize: 12 }} />
                  <button className="btn btn-outline btn-sm" type="submit">Carica nuova immagine</button>
                </form>
              </>
            )}
            <div style={{ marginTop: 10 }}>
              <strong style={{ fontSize: 12.5 }}>Caratteristiche</strong>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                {db.settings.caratteristiche.map((c) => {
                  const on = activeParent.caratteristiche.includes(c);
                  return consortium ? (
                    <form key={c} action={toggleParentCaratteristica.bind(null, BACK, activeParent.id, c, scopeParam)}>
                      <button type="submit" className={`pill ${on ? "pill-green" : "pill-gray"}`} style={{ cursor: "pointer", border: "none" }}>
                        {on ? "✓ " : ""}{c}
                      </button>
                    </form>
                  ) : on ? <span key={c} className="pill pill-green">{c}</span> : null;
                })}
              </div>
            </div>
          </div>
          <div>
            <form action={saveParentTexts.bind(null, BACK, activeParent.id, scopeParam)} style={{ display: "grid", gap: 10 }}>
              <label className="field" style={{ marginBottom: 0 }}>
                Nome prodotto padre
                <input type="text" name="nome" defaultValue={effectiveParentText(db, scope, activeParent, "nome", academyDb).value} />
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                Descrizione per il VOLANTINO{" "}
                {effectiveParentText(db, scope, activeParent, "descVolantino", academyDb).custom && <span className="pill pill-orange">personalizzata</span>}
                <textarea name="descVolantino" rows={2} defaultValue={effectiveParentText(db, scope, activeParent, "descVolantino", academyDb).value} />
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                Descrizione per il CARTELLO{" "}
                {effectiveParentText(db, scope, activeParent, "descCartello", academyDb).custom && <span className="pill pill-orange">personalizzata</span>}
                <textarea name="descCartello" rows={3} defaultValue={effectiveParentText(db, scope, activeParent, "descCartello", academyDb).value} />
              </label>
              <button className="btn btn-sm" type="submit">
                Salva {scope.type === "system" ? "(versione Consorzio)" : `(personalizzazione ${scope.label})`}
              </button>
            </form>
            {consortium && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <form action={rigeneraTestiAI.bind(null, BACK, activeParent.id, scopeParam)}>
                  <button className="btn btn-outline btn-sm" type="submit">Rigenera testi con AI</button>
                </form>
                <form action={scioglieParent.bind(null, BACK, activeParent.id, scopeParam)}>
                  <button className="btn btn-outline btn-sm" type="submit">Sciogli raggruppamento</button>
                </form>
              </div>
            )}
            {consortium && (
              <ParentQuickEdit
                parentId={activeParent.id}
                articoli={parentChildren.map((c) => ({ id: c.id, ean: c.ean, descrizione: c.descrizione }))}
                padri={db.parents
                  .map((p) => ({ id: p.id, nome: effectiveParentText(db, scope, p, "nome", academyDb).value }))
                  .sort((a, b) => a.nome.localeCompare(b.nome, "it"))}
                foto={availablePhotos}
                urlFoto={(f) => publicUrlFor(`zoo-foto/${f}`)}
                onMove={moveProductToParent.bind(null, BACK, scopeParam)}
                onSetImage={setParentImageFromFile.bind(null, activeParent.id)}
              />
            )}
          </div>
        </div>
      </td>
    </tr>
  );

  return (
    <div>
      <StampeHeader user={user} active="offerte" area="zoo" />
      <div className="container">
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Import offerte — volantino in lavorazione</h1>
            <p className="subtitle" style={{ margin: "4px 0 0" }}>
              L&apos;Excel delle promo viene confrontato con il database per EAN: dati e foto già presenti vengono
              riutilizzati, i prodotti nuovi entrano nel database.
            </p>
          </div>
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

        {sp.importate !== undefined && (
          <div className="alert alert-green">
            ✓ Importate {sp.importate} offerte ({sp.nuovi ?? 0} prodotti nuovi aggiunti al database base).
            {sp.senzaprezzo && ` ${sp.senzaprezzo} senza prezzo promo (vedi condizioni): da completare a mano.`}
            {sp.esclusemarginiamo && ` ${sp.esclusemarginiamo} righe "marginiamo" escluse dalle offerte.`}
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
        {sp.chiuso && (
          <div className="alert alert-green">
            ✓ Volantino chiuso. Le offerte restano stampabili in Stampa cartelli finché sono in corso; quando sarai
            pronto apri il volantino successivo qui sotto.
          </div>
        )}
        {sp.svuotato !== undefined && (
          <div className="alert alert-green">✓ Eliminate {sp.svuotato} offerte: carica di nuovo l&apos;Excel qui sotto.</div>
        )}
        {sp.rimossemarginiamo !== undefined && (
          <div className="alert alert-green">✓ Rimosse {sp.rimossemarginiamo} offerte &quot;marginiamo&quot;.</div>
        )}
        {sp.nuovo && <div className="alert alert-green">✓ Nuovo volantino aperto: le pagine ripartono pulite.</div>}
        {sp.riaperto && <div className="alert alert-green">✓ Volantino riaperto: puoi modificarlo di nuovo.</div>}
        {sp.errore === "giaaperto" && (
          <div className="alert alert-amber">
            C&apos;è già un volantino in lavorazione: chiudilo prima di aprirne un altro.
          </div>
        )}

        {/* ---------- stato del volantino: chiudi / apri il successivo ---------- */}
        {consortium && (
          <div className="card" style={{ marginBottom: 14, padding: 14 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              {campaign ? (
                <>
                  <span className="pill pill-blue">in lavorazione</span>
                  <strong>{campaign.nome}</strong>
                  <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                    {fmt(campaign.dal)} → {fmt(campaign.al)} · {offers.length} offerte
                  </span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    {offers.length > 0 && (
                      <form action={svuotaOfferteVolantino.bind(null, campaign.id, scopeParam)}>
                        <button className="btn btn-outline btn-sm" type="submit" title="Elimina tutte le offerte di questo volantino per ricaricare l'Excel da zero">
                          Elimina tutte le offerte
                        </button>
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

        {/* ---------- import Excel + caricamento foto ---------- */}
        {consortium && campaign && (
          <div className="card" style={{ marginBottom: 14, padding: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <strong>Carica l&apos;Excel delle offerte</strong>
                <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 8px" }}>
                  Colonne: EAN, DESCRIZIONE PROMO, PREZZO PROMO, PREZZO LISTINO, CONDIZIONI (+ MARCA/FORNITORE per i
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
              <div>
                <strong>Caricamento foto</strong>
                <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 8px" }}>
                  Puoi selezionare anche centinaia di foto insieme (caricate direttamente, niente limiti di
                  dimensione): se il nome del file contiene l&apos;EAN o il codice fornitore, l&apos;abbinamento è
                  automatico. Ogni articolo ha la sua foto; nel padre si sceglie quella di riferimento.
                </p>
                <PhotoUploader back={BACK} scopeParam={scopeParam} finalize={finalizeZooPhotoUpload} />
                {availablePhotos.length > 0 && (
                  <p className="hint" style={{ marginTop: 6 }}>
                    {availablePhotos.length} foto caricate non ancora abbinate: le abbini dalla tabella qui sotto.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ---------- offerte "marginiamo" già importate: rimozione in blocco ---------- */}
        {consortium && campaign && marginiamo.length > 0 && (
          <div className="alert alert-amber" style={{ marginBottom: 14 }}>
            <strong>{marginiamo.length} offerte &quot;marginiamo&quot;</strong> (nessuna promo dal fornitore, decide il
            PV): non sono offerte vere, non dovrebbero comparire nei cartelli.{" "}
            <form action={rimuoviOfferteMarginiamo.bind(null, campaign.id, scopeParam)} style={{ display: "inline" }}>
              <button className="btn btn-sm" type="submit">Rimuovile</button>
            </form>
          </div>
        )}

        {/* ---------- proposte di abbinamento foto→articolo per nome (nessuna AI) ---------- */}
        {consortium && campaign && availablePhotos.length > 0 && (
          <div className="card" style={{ marginBottom: 14, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <strong>Abbina le foto agli articoli</strong>
              <span className="pill pill-orange">{availablePhotos.length} da abbinare</span>
              <a className="btn btn-outline btn-sm" style={{ marginLeft: "auto" }}
                href={`${BACK}?${pageQs(sp, { scope: scopeParam, abbina: abbinaAperto ? undefined : "1" })}`}>
                {abbinaAperto ? "▴ Comprimi" : "▾ Apri"}
              </a>
            </div>
            {abbinaAperto && (
            <>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "8px 0" }}>
              Le foto senza EAN/codice nel nome non si abbinano da sole: qui sotto trovi un&apos;ipotesi per ciascuna,
              basata sul confronto tra il nome del file e la descrizione. Se la proposta non va bene — o se non ce
              n&apos;è nessuna — usa la ricerca sotto il menu: puoi scegliere qualsiasi articolo o prodotto padre.
            </p>
            <PhotoMatcher
              foto={photoSuggestions.map(({ file, candidates }) => ({
                file,
                url: publicUrlFor(`zoo-foto/${file}`),
                candidati: candidates
                  .map((c) => ({ c, p: senzaFotoById.get(c.productId) }))
                  .filter((x): x is { c: typeof candidates[number]; p: ZooProduct } => Boolean(x.p))
                  .map(({ c, p }) => ({ id: c.productId, label: p.descrizione, score: c.score })),
              }))}
              catalogo={catalogoAbbinabile}
              onConfirm={confirmZooPhotoTargets}
            />
            </>
            )}
          </div>
        )}

        {campaign && consortium && (
          <form action={updateCampaignDates.bind(null, campaign.id, scopeParam)} style={{ display: "flex", gap: 8, alignItems: "end", marginBottom: 14 }}>
            <label className="field" style={{ marginBottom: 0 }}>Nome<input type="text" name="nome" defaultValue={campaign.nome} /></label>
            <label className="field" style={{ marginBottom: 0 }}>Dal<input type="date" name="dal" defaultValue={campaign.dal} /></label>
            <label className="field" style={{ marginBottom: 0 }}>Al<input type="date" name="al" defaultValue={campaign.al} /></label>
            <button className="btn btn-outline btn-sm" type="submit">Aggiorna date</button>
          </form>
        )}

        {!campaign ? (
          <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
            Nessun volantino in lavorazione: aprine uno qui sopra per ricominciare da pagine pulite.
          </div>
        ) : (
          <>
            {/* ---------- raggruppamento: a mano o con l'AI ---------- */}
            {consortium && senzaPadre.length > 0 && (
              <div className="alert" style={{ background: "#f3ecfb", border: "1px solid #d9c6f2", marginBottom: 14 }}>
                <strong>{senzaPadre.length} articoli di questo volantino non hanno un prodotto padre.</strong>{" "}
                Raggruppali per avere una sola voce a volantino con un solo testo (es. le scatolette nei vari gusti).{" "}
                <form action={associaNuoviConAI.bind(null, scopeParam)} style={{ display: "inline" }}>
                  <button className="btn btn-sm" type="submit" style={{ background: "#6d3fa7" }}>
                    Associa tutti con l&apos;AI e genera i testi
                  </button>
                </form>{" "}
                <span className="hint">
                  oppure spunta gli articoli nella tabella e usa i pulsanti qui sotto. Non tutti gli articoli hanno
                  bisogno di un padre: quelli unici si lasciano così come sono.
                </span>
              </div>
            )}

            {/* filtri + vista */}
            <div className="card" style={{ marginBottom: 14, padding: 14 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <a className={`pill ${!vistaArticoli ? "pill-blue" : "pill-gray"}`} style={{ textDecoration: "none" }}
                  href={`${BACK}?${vistaQs(sp, scopeParam, "raggruppata")}`}>
                  Vista raggruppata ({gruppi.length})
                </a>
                <a className={`pill ${vistaArticoli ? "pill-blue" : "pill-gray"}`} style={{ textDecoration: "none" }}
                  href={`${BACK}?${vistaQs(sp, scopeParam, "articoli")}`}>
                  Vista articoli singoli ({visibili.length})
                </a>
              </div>
              <form method="get" style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr)) auto", gap: 10, alignItems: "end" }}>
                <input type="hidden" name="scope" value={scopeParam} />
                <input type="hidden" name="vista" value={vistaArticoli ? "articoli" : "raggruppata"} />
                {abbinaAperto && <input type="hidden" name="abbina" value="1" />}
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
            </div>

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
                  <span className="hint">
                    {db.settings.apiKey
                      ? "chiave API Claude configurata"
                      : "nessuna chiave API: verrà usato il raggruppamento automatico con testi bozza"}
                  </span>
                </div>
              )}
              <div className="card table-wrap">
                <ColumnResize tableId="tab-offerte" />
                <table className="data" id="tab-offerte">
                  <thead>
                    <tr>
                      {consortium && <th style={{ width: 30 }}><BulkCheckbox name="sel" /></th>}
                      <th style={{ width: 56 }}>Foto</th>
                      <th>{vistaArticoli ? "Offerta" : "Prodotto"}</th>
                      <th className="col-wide">Descrizione</th>
                      <th>Animale</th>
                      <th>Caratteristica</th>
                      <th>Pagina</th>
                      <th>Etichetta</th>
                      <th>Focus</th>
                      <th>{vistaArticoli ? "EAN" : "Articoli"}</th>
                      <th>Prezzo promo</th>
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
                      const key = parent?.id ?? `_o_${first.id}`;
                      const offIds = offs.map((o) => o.id);
                      const aperto = !!parent && activeParent?.id === parent.id;
                      const nome = parent ? effectiveParentText(db, scope, parent, "nome", academyDb).value : first.descrizione;
                      const descr = parent ? effectiveParentText(db, scope, parent, "descVolantino", academyDb).value : (first.condizioni ?? "");
                      return [
                        <tr key={key}>
                          {consortium && (
                            <td>{!parent && product && <input type="checkbox" name="sel" value={product.id} />}</td>
                          )}
                          <td>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={zooImageUrl(product, parent)} alt="" style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 6, border: "1px solid #eee" }} />
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
                            {parent && (
                              <a href={`${BACK}?${pageQs(sp, { scope: scopeParam, padre: aperto ? undefined : parent.id })}`}
                                style={{ fontSize: 10.5, color: "#274b7a", textDecoration: "none" }}>
                                {aperto ? "▾ dettagli" : "▸ dettagli"}
                              </a>
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
                          <td>
                            {consortium && parent ? (
                              <InlineSelect value={animali[0] ?? ""} options={db.settings.categorieAnimali}
                                onSave={setParentTagInline.bind(null, parent.id, "animale")} />
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
                            {consortium ? (
                              <InlineSelect value={first.paginaId ?? ""}
                                options={[...pagineVolantino.map((p) => p.id), NO_VOLANTINO]}
                                etichette={{ ...Object.fromEntries(pagineVolantino.map((p) => [p.id, p.nome])), [NO_VOLANTINO]: "✕ no volantino" }}
                                vuoto="— da assegnare —"
                                onSave={updateOfferGroupFieldInline.bind(null, offIds, "paginaId")} />
                            ) : (
                              <span style={{ fontSize: 11.5 }}>
                                {first.paginaId === NO_VOLANTINO ? "no volantino" : (nomePagina.get(first.paginaId ?? "") ?? "—")}
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
                              <InlineEdit value={first.focus ?? ""} placeholder="focus…"
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
                          <td style={{ fontSize: 12.5 }}>
                            {first.prezzoListino ? `€ ${first.prezzoListino}${offs.length > 1 ? "…" : ""}` : "—"}
                          </td>
                        </tr>,
                        aperto && editorRow,
                      ];
                    })}

                    {/* ---- vista articoli singoli: una riga per offerta ---- */}
                    {vistaArticoli && visibiliCap.map((o) => {
                      const product = prodById.get(o.productId ?? "");
                      const parent = product?.parentId ? parentById.get(product.parentId) : undefined;
                      const animali = animaliDi(db, parent?.caratteristiche ?? []);
                      const prodottoCarat = caratteristicheProdottoDi(db, parent?.caratteristiche ?? []);
                      const aperto = !!parent && activeParent?.id === parent.id;
                      const parentDescr = parent ? effectiveParentText(db, scope, parent, "descVolantino", academyDb).value : "";
                      return [
                        <tr key={o.id}>
                          {consortium && (
                            <td>{product && <input type="checkbox" name="sel" value={product.id} />}</td>
                          )}
                          <td>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={zooImageUrl(product, parent)} alt="" style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 6, border: "1px solid #eee" }} />
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
                          <td>
                            {consortium && parent ? (
                              <InlineSelect value={animali[0] ?? ""} options={db.settings.categorieAnimali}
                                onSave={setParentTagInline.bind(null, parent.id, "animale")} />
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
                            {consortium ? (
                              <InlineSelect value={o.paginaId ?? ""}
                                options={[...pagineVolantino.map((p) => p.id), NO_VOLANTINO]}
                                etichette={{ ...Object.fromEntries(pagineVolantino.map((p) => [p.id, p.nome])), [NO_VOLANTINO]: "✕ no volantino" }}
                                vuoto="— da assegnare —"
                                onSave={updateOfferFieldInline.bind(null, o.id, "paginaId")} />
                            ) : (
                              <span style={{ fontSize: 11.5 }}>
                                {o.paginaId === NO_VOLANTINO ? "no volantino" : (nomePagina.get(o.paginaId ?? "") ?? "—")}
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
                              <InlineEdit value={o.focus ?? ""} placeholder="focus…"
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
                          <td style={{ fontSize: 12.5 }}>{o.prezzoListino ? `€ ${o.prezzoListino}` : "—"}</td>
                          <td>
                            {parent ? (
                              <a className="pill pill-blue" href={`${BACK}?${pageQs(sp, { scope: scopeParam, padre: aperto ? undefined : parent.id })}`} style={{ textDecoration: "none" }}>
                                {effectiveParentText(db, scope, parent, "nome", academyDb).value.slice(0, 24)}
                              </a>
                            ) : (
                              <span className="pill pill-gray">senza padre</span>
                            )}
                          </td>
                        </tr>,
                        aperto && editorRow,
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
