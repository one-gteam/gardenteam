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
  getZooDb, zooImageUrl, effectiveParentText, isZooHidden, hiddenEntriesFor, fornitoriList, marcheList,
  suggestPhotoMatch, buildAbbinamentoIndex, animaliDi, caratteristicheProdottoDi, type ZooProduct, type ZooParent,
} from "@/lib/zoo";
import {
  importZooProducts, finalizeZooPhotoUpload, confirmZooPhotoTargets, createZooParent, associaConAI,
  rigeneraTestiAI, saveParentTexts, setParentImage, toggleParentCaratteristica, scioglieParent, toggleZooHidden,
  toggleZooHiddenBulk, updateParentFieldInline, updateProductFieldInline, setParentTagInline, moveProductToParent,
  setParentImageFromFile, mergeParentsForm,
} from "@/lib/zoo-actions";

// "Associa con AI" può richiedere più dei 10s di default per un lotto di articoli.
export const maxDuration = 60;

/** Pagina a cui tornano le azioni su foto e prodotti padre (le stesse servono a Import offerte). */
const BACK = "/stampe/zoo/dati";

/** Ricostruisce la query string corrente, con delle sovrascritture (undefined = togli il parametro). */
function pageQs(sp: Record<string, string | undefined>, overrides: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  const merged = { ...sp, ...overrides };
  for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
  return params.toString();
}

/** Query string corrente con "abbina" aggiornato (undefined = sezione chiusa). */
function datiQs(sp: Record<string, string | undefined>, scopeParam: string, abbina?: string): string {
  return pageQs(sp, { scope: scopeParam, abbina });
}

export default async function ZooDatiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessArea(user, "zoo")) redirect("/studente");
  const sp = await searchParams;

  // letture indipendenti: in parallelo pesa solo la più lenta, non la somma
  const [db, academyDb, tutteLeFoto] = await Promise.all([
    getZooDb(),
    getDb(),
    listStorageFiles("zoo-foto"),
  ]);
  const scopes = scopesForUser(user, academyDb);
  const scope = resolveScope(user, sp.scope, academyDb);
  const scopeParam = `${scope.type}:${scope.id}`;
  const consortium = isZooEditor(user);

  const parentById = new Map(db.parents.map((p) => [p.id, p]));

  // filtri
  const q = (sp.q ?? "").toLowerCase();
  const soloSenzaPadre = sp.senzapadre === "1";
  let products = db.products.filter((p) => {
    if (sp.fornitore && p.fornitore !== sp.fornitore) return false;
    if (sp.marca && p.marca !== sp.marca) return false;
    if (soloSenzaPadre && p.parentId) return false;
    if (sp.animale || sp.caratt) {
      const caratts = (p.parentId ? parentById.get(p.parentId) : undefined)?.caratteristiche ?? [];
      if (sp.animale && !caratts.includes(sp.animale)) return false;
      if (sp.caratt && !caratts.includes(sp.caratt)) return false;
    }
    if (q && !`${p.descrizione} ${p.ean} ${p.codice} ${p.marca}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const hiddenHere = hiddenEntriesFor(db, scope);
  const showHidden = sp.nascosti === "1";
  if (scope.type !== "system" && !showHidden) products = products.filter((p) => !isZooHidden(db, scope, p, academyDb));

  const activeParent = sp.padre ? parentById.get(sp.padre) : undefined;
  const parentChildren = activeParent ? db.products.filter((p) => p.parentId === activeParent.id) : [];

  // foto disponibili non ancora abbinate (per l'associazione manuale)
  const usedPhotos = new Set(db.products.map((p) => (p.image ?? "").split("/").pop()));
  const availablePhotos = tutteLeFoto.filter(
    (f) => /\.(jpg|jpeg|png|webp)$/i.test(f) && !usedPhotos.has(f)
  );
  /*
   * Proposte di abbinamento per nome (nessuna AI), su tutto il catalogo senza foto.
   * Calcolate solo a sezione aperta (?abbina=1): tokenizzare l'intero catalogo e
   * confrontarlo con ogni file costa centinaia di ms, sprecati se non si stanno
   * abbinando foto.
   */
  const abbinaAperto = sp.abbina === "1";
  const senzaFotoCatalogo = db.products.filter((p) => !p.image);
  const senzaFotoById = new Map(senzaFotoCatalogo.map((p) => [p.id, p]));
  const photoSuggestions = abbinaAperto
    ? (() => {
        const index = buildAbbinamentoIndex(senzaFotoCatalogo);
        return availablePhotos.slice(0, 200).map((f) => ({
          file: f,
          candidates: suggestPhotoMatch(f.replace(/\.[a-z0-9]+$/i, ""), index, 5),
        }));
      })()
    : [];

  const senzaPadre = db.products.filter((p) => !p.parentId).length;

  /*
   * Vista raggruppata (default): una riga per padre invece che per articolo,
   * come in Import offerte — molto più leggera da caricare con l'intero
   * catalogo, ed è il modo naturale di navigare i prodotti padre.
   */
  const vistaArticoli = sp.vista === "articoli";
  const gruppi = (() => {
    const map = new Map<string, { parent?: ZooParent; prods: ZooProduct[] }>();
    for (const p of products) {
      const parent = p.parentId ? parentById.get(p.parentId) : undefined;
      const key = parent?.id ?? `_o_${p.id}`;
      const g = map.get(key) ?? { parent, prods: [] };
      g.prods.push(p);
      map.set(key, g);
    }
    return [...map.values()];
  })();
  const RIGHE_MAX = 400;
  const gruppiVisibili = gruppi.slice(0, RIGHE_MAX);
  const productsVisibili = products.slice(0, RIGHE_MAX);
  const nCols = (consortium || scope.type !== "system" ? 1 : 0) + (vistaArticoli ? 8 : 7)
    + (scope.type !== "system" ? 1 : 0);

  /** Catalogo su cui cerca l'abbinamento manuale delle foto: articoli e prodotti padre. */
  const catalogoAbbinabile = abbinaAperto
    ? [
        ...db.parents.map((p) => ({ id: `p:${p.id}`, label: `[padre] ${p.nome}` })),
        ...db.products.map((p) => ({ id: p.id, label: `${p.descrizione} · ${p.ean}` })),
      ]
    : [];

  /**
   * Dettaglio del padre aperto: non una scheda separata in cima alla pagina, ma
   * una riga espansa in mezzo alla tabella, subito sotto la riga del prodotto.
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
      <StampeHeader user={user} active="dati" area="zoo" />
      <div className="container">
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Database prodotti — Offerte ZOO</h1>
            <p className="subtitle" style={{ margin: "4px 0 0" }}>
              {db.products.length} articoli · {db.parents.length} prodotti padre · {senzaPadre} da raggruppare
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

        {sp.importati !== undefined && <div className="alert alert-green">✓ Import Excel: {sp.importati} articoli elaborati.</div>}
        {sp.foto !== undefined && <div className="alert alert-green">✓ {sp.foto} foto caricate, {sp.abbinate} abbinate in automatico per EAN/codice.</div>}
        {sp.abbinatenome !== undefined && <div className="alert alert-green">✓ {sp.abbinatenome} foto abbinate per nome.</div>}
        {sp.padri !== undefined && (
          <div className="alert alert-green">
            ✓ Creati {sp.padri} prodotti padre {sp.ai === "1" ? "con l'AI (testi volantino e cartello generati)" : "con raggruppamento automatico (testi bozza da rivedere)"}.
            {sp.restanti && ` Ne restano ${sp.restanti} da raggruppare: si lavora a lotti, ripeti l'operazione per continuare.`}
            {sp.aierr && <span style={{ color: "#a33" }}> Nota AI: {sp.aierr}</span>}
          </div>
        )}
        {sp.nontenuti !== undefined && (
          <div className="alert alert-green">
            ✓ {sp.nontenuti} articoli segnati come non tenuti da {scope.label}: non compariranno nella stampa cartelli, ora né in futuro, finché non li rendi di nuovo visibili.
          </div>
        )}

        {/* strumenti del Consorzio: import Excel + caricamento foto */}
        {consortium && scope.type === "system" && (
          <div className="card" style={{ marginBottom: 14, padding: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <strong>Import Excel prodotti</strong>
                <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 8px" }}>
                  Colonne: EAN, CODICE FORNITORE, DESCRIZIONE, MARCA, FORNITORE, CATEGORIA, PREZZO.{" "}
                  <a href={`/stampe/zoo/excel?template=1&scope=${scopeParam}`}>Scarica il modello</a>
                </p>
                <form action={importZooProducts.bind(null, scopeParam)} style={{ display: "flex", gap: 8 }}>
                  <input type="file" name="file" accept=".xlsx,.xls,.csv" required />
                  <button className="btn btn-sm" type="submit">Importa</button>
                </form>
              </div>
              <div>
                <strong>Caricamento foto</strong>
                <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 8px" }}>
                  Puoi selezionare anche centinaia di foto insieme (caricate direttamente, niente limiti di
                  dimensione): se il nome del file contiene l&apos;EAN o il codice fornitore, l&apos;abbinamento è
                  automatico.
                </p>
                <PhotoUploader back={BACK} scopeParam={scopeParam} finalize={finalizeZooPhotoUpload} />
              </div>
            </div>
          </div>
        )}

        {/* ---------- proposte di abbinamento foto→articolo per nome (nessuna AI) ---------- */}
        {consortium && scope.type === "system" && availablePhotos.length > 0 && (
          <div className="card" style={{ marginBottom: 14, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <strong>Abbina le foto agli articoli</strong>
              <span className="pill pill-orange">{availablePhotos.length} da abbinare</span>
              <a className="btn btn-outline btn-sm" style={{ marginLeft: "auto" }}
                href={`${BACK}?${datiQs(sp, scopeParam, abbinaAperto ? undefined : "1")}`}>
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

        {/* vista + filtri */}
        <div className="card" style={{ marginBottom: 14, padding: 14 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <a className={`pill ${!vistaArticoli ? "pill-blue" : "pill-gray"}`} style={{ textDecoration: "none" }}
              href={`${BACK}?${pageQs(sp, { scope: scopeParam, vista: "raggruppata" })}`}>
              Vista raggruppata ({gruppi.length})
            </a>
            <a className={`pill ${vistaArticoli ? "pill-blue" : "pill-gray"}`} style={{ textDecoration: "none" }}
              href={`${BACK}?${pageQs(sp, { scope: scopeParam, vista: "articoli" })}`}>
              Vista articoli singoli ({products.length})
            </a>
          </div>
          <form method="get" style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr)) auto", gap: 10, alignItems: "end" }}>
            <input type="hidden" name="scope" value={scopeParam} />
            <input type="hidden" name="vista" value={vistaArticoli ? "articoli" : "raggruppata"} />
            {abbinaAperto && <input type="hidden" name="abbina" value="1" />}
            <label className="field" style={{ marginBottom: 0 }}>Cerca<input type="text" name="q" defaultValue={sp.q ?? ""} placeholder="descrizione, EAN, codice" /></label>
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
              Fornitore
              <select name="fornitore" defaultValue={sp.fornitore ?? ""}>
                <option value="">Tutti</option>
                {fornitoriList(db).map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              Marca
              <select name="marca" defaultValue={sp.marca ?? ""}>
                <option value="">Tutte</option>
                {marcheList(db).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <button className="btn btn-sm" type="submit">Filtra</button>
            <label style={{ fontSize: 12.5, gridColumn: "1 / -1" }}>
              <input type="checkbox" name="senzapadre" value="1" defaultChecked={soloSenzaPadre} /> solo senza padre
              {scope.type !== "system" && (
                <>
                  {" "}<input type="checkbox" name="nascosti" value="1" defaultChecked={showHidden} /> mostra nascosti
                </>
              )}
              {(sp.animale || sp.caratt || sp.marca || sp.fornitore || sp.q) && (
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

        {/* tabella prodotti con selezione multipla → crea padre / associa con AI / unisci / non tenuti */}
        <form>
          <input type="hidden" name="scope" value={scopeParam} />
          {(consortium || scope.type !== "system") && (
            <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
              {consortium && (
                <>
                  <button className="btn btn-sm" formAction={createZooParent.bind(null, BACK, scopeParam)} type="submit">
                    Crea padre dagli articoli selezionati
                  </button>
                  <button className="btn btn-sm" formAction={associaConAI.bind(null, BACK, scopeParam)} type="submit" style={{ background: "#6d3fa7" }}>
                    Associa con AI (raggruppa + genera testi)
                  </button>
                  {!vistaArticoli && (
                    <button className="btn btn-outline btn-sm" formAction={mergeParentsForm.bind(null, BACK, scopeParam)} type="submit"
                      title="Spunta due o più prodotti padre: gli articoli passeranno tutti sotto il primo spuntato">
                      Unisci i padri selezionati
                    </button>
                  )}
                  <span className="hint">
                    {db.settings.apiKey ? "chiave API Claude configurata" : "nessuna chiave API: verrà usato il raggruppamento automatico con testi bozza"}
                  </span>
                </>
              )}
              {scope.type !== "system" && (
                <button className="btn btn-outline btn-sm" formAction={toggleZooHiddenBulk.bind(null, BACK, scopeParam)} type="submit">
                  Segna selezionati come non tenuti
                </button>
              )}
            </div>
          )}
          <div className="card table-wrap">
            <ColumnResize tableId="tab-dati" />
            <table className="data" id="tab-dati">
              <thead>
                <tr>
                  {(consortium || scope.type !== "system") && <th style={{ width: 30 }}><BulkCheckbox name="sel" /></th>}
                  <th style={{ width: 56 }}>Foto</th>
                  <th>{vistaArticoli ? "Articolo" : "Prodotto"}</th>
                  <th className="col-wide">Descrizione</th>
                  <th>Animale</th>
                  <th>Caratteristica</th>
                  <th>{vistaArticoli ? "EAN" : "Articoli"}</th>
                  <th>Marca · Fornitore</th>
                  {vistaArticoli && <th>Padre</th>}
                  {scope.type !== "system" && <th className="no-print">Visibilità</th>}
                </tr>
              </thead>
              <tbody>
                {(vistaArticoli ? productsVisibili.length : gruppiVisibili.length) === 0 && (
                  <tr><td colSpan={nCols} className="empty">Nessun articolo: importa l&apos;Excel dei prodotti per iniziare.</td></tr>
                )}

                {/* ---- vista raggruppata: una riga per padre (le orfane restano singole) ---- */}
                {!vistaArticoli && gruppiVisibili.map((g) => {
                  const { parent, prods } = g;
                  const first = prods[0];
                  const animali = animaliDi(db, parent?.caratteristiche ?? []);
                  const prodottoCarat = caratteristicheProdottoDi(db, parent?.caratteristiche ?? []);
                  const key = parent?.id ?? `_o_${first.id}`;
                  const aperto = !!parent && activeParent?.id === parent.id;
                  const nome = parent ? effectiveParentText(db, scope, parent, "nome", academyDb).value : first.descrizione;
                  const descr = parent ? effectiveParentText(db, scope, parent, "descVolantino", academyDb).value : "";
                  const hidden = scope.type !== "system" && prods.length === 1 && isZooHidden(db, scope, first, academyDb);
                  return [
                    <tr key={key} style={hidden ? { opacity: 0.45 } : undefined}>
                      {(consortium || scope.type !== "system") && (
                        <td>
                          {parent
                            ? consortium && <input type="checkbox" name="selpadre" value={parent.id} title="Spunta due o più padri e usa «Unisci i padri selezionati»: il primo dà i testi" />
                            : <input type="checkbox" name="sel" value={first.id} />}
                        </td>
                      )}
                      <td>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={zooImageUrl(first, parent)} alt="" style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 6, border: "1px solid #eee" }} />
                      </td>
                      <td>
                        {consortium ? (
                          <InlineEdit value={nome} onSave={parent
                            ? updateParentFieldInline.bind(null, parent.id, "nome", scopeParam)
                            : updateProductFieldInline.bind(null, first.id, "descrizione")} />
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
                      <td style={{ fontSize: 12 }}>
                        {prods.length > 1 ? (
                          <details>
                            <summary style={{ cursor: "pointer", color: "#274b7a" }}>{prods.length} articoli</summary>
                            <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 11 }}>
                              {prods.map((p) => <li key={p.id}>{p.descrizione} · EAN {p.ean}</li>)}
                            </ul>
                          </details>
                        ) : (
                          <>{first.ean}<div style={{ color: "var(--muted)" }}>{first.codice}</div></>
                        )}
                      </td>
                      <td style={{ fontSize: 12.5 }}>
                        {first.marca}<div style={{ color: "var(--muted)", fontSize: 11.5 }}>{first.fornitore}</div>
                      </td>
                      {scope.type !== "system" && (
                        <td className="no-print" style={{ whiteSpace: "nowrap" }}>
                          {prods.length === 1 ? (
                            <button
                              className="btn btn-outline btn-sm" type="submit" title={hidden ? "Rendi di nuovo visibile" : "Nascondi questo articolo"}
                              formAction={toggleZooHidden.bind(null, scopeParam, "articolo", first.ean, "/stampe/zoo/dati")}
                            >
                              {hidden ? "Mostra" : "Nascondi"}
                            </button>
                          ) : (
                            <span className="hint">usa la selezione multipla</span>
                          )}
                        </td>
                      )}
                    </tr>,
                    aperto && editorRow,
                  ];
                })}

                {/* ---- vista articoli singoli: una riga per articolo ---- */}
                {vistaArticoli && productsVisibili.map((p) => {
                  const parent = p.parentId ? parentById.get(p.parentId) : undefined;
                  const animali = animaliDi(db, parent?.caratteristiche ?? []);
                  const prodottoCarat = caratteristicheProdottoDi(db, parent?.caratteristiche ?? []);
                  const aperto = !!parent && activeParent?.id === parent.id;
                  const parentDescr = parent ? effectiveParentText(db, scope, parent, "descVolantino", academyDb).value : "";
                  const hidden = scope.type !== "system" && isZooHidden(db, scope, p, academyDb);
                  return [
                    <tr key={p.id} style={hidden ? { opacity: 0.45 } : undefined}>
                      {(consortium || scope.type !== "system") && <td><input type="checkbox" name="sel" value={p.id} /></td>}
                      <td>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={zooImageUrl(p, parent)} alt="" style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 6, border: "1px solid #eee" }} />
                      </td>
                      <td>
                        <strong style={{ fontSize: 13 }}>{p.descrizione}</strong>
                        {p.prezzo && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>prezzo base € {p.prezzo}</div>}
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
                      <td style={{ fontSize: 12 }}>{p.ean}<div style={{ color: "var(--muted)" }}>{p.codice}</div></td>
                      <td style={{ fontSize: 12.5 }}>{p.marca}<div style={{ color: "var(--muted)", fontSize: 11.5 }}>{p.fornitore}</div></td>
                      <td>
                        {parent ? (
                          <a className="pill pill-blue" href={`${BACK}?${pageQs(sp, { scope: scopeParam, padre: aperto ? undefined : parent.id })}`} style={{ textDecoration: "none" }}>
                            {effectiveParentText(db, scope, parent, "nome", academyDb).value.slice(0, 24)}
                          </a>
                        ) : (
                          <span className="pill pill-gray">senza padre</span>
                        )}
                      </td>
                      {scope.type !== "system" && (
                        <td className="no-print" style={{ whiteSpace: "nowrap" }}>
                          <button
                            className="btn btn-outline btn-sm" type="submit" title={hidden ? "Rendi di nuovo visibile" : "Nascondi questo articolo"}
                            formAction={toggleZooHidden.bind(null, scopeParam, "articolo", p.ean, "/stampe/zoo/dati")}
                          >
                            {hidden ? "Mostra" : "Nascondi"}
                          </button>
                        </td>
                      )}
                    </tr>,
                    aperto && editorRow,
                  ];
                })}
              </tbody>
            </table>
          </div>
          {((vistaArticoli && products.length > RIGHE_MAX) || (!vistaArticoli && gruppi.length > RIGHE_MAX)) && (
            <p className="hint" style={{ marginTop: 6 }}>
              Mostrate le prime {RIGHE_MAX} righe: usa la ricerca per restringere l&apos;elenco.
            </p>
          )}
        </form>

        {/* fornitori/marchi nascosti per questo ambito */}
        {scope.type !== "system" && (
          <div className="card" style={{ marginTop: 14, padding: 14 }}>
            <strong>Fornitori e marchi non trattati da {scope.label}</strong>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 8px" }}>
              Clicca per nascondere/mostrare: gli articoli nascosti non compariranno nelle pagine di stampa di questo ambito.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {fornitoriList(db).map((f) => {
                const off = hiddenHere.some((h) => h.kind === "fornitore" && h.value === f);
                return (
                  <form key={`f_${f}`} action={toggleZooHidden.bind(null, scopeParam, "fornitore", f, "/stampe/zoo/dati")}>
                    <button type="submit" className={`pill ${off ? "pill-gray" : "pill-green"}`} style={{ cursor: "pointer", border: "none" }}>
                      {off ? "✕ " : ""}Fornitore: {f}
                    </button>
                  </form>
                );
              })}
              {marcheList(db).map((m) => {
                const off = hiddenHere.some((h) => h.kind === "marca" && h.value === m);
                return (
                  <form key={`m_${m}`} action={toggleZooHidden.bind(null, scopeParam, "marca", m, "/stampe/zoo/dati")}>
                    <button type="submit" className={`pill ${off ? "pill-gray" : "pill-blue"}`} style={{ cursor: "pointer", border: "none" }}>
                      {off ? "✕ " : ""}Marca: {m}
                    </button>
                  </form>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
