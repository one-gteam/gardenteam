import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import StampeHeader from "@/components/stampe/StampeHeader";
import { canAccessArea, isZooEditor, scopesForUser, resolveScope } from "@/lib/stampe";
import { getDb } from "@/lib/db";
import { listStorageFiles, publicUrlFor } from "@/lib/supabase";
import PhotoUploader from "@/components/stampe/PhotoUploader";
import BulkCheckbox from "@/components/stampe/BulkCheckbox";
import {
  getZooDb, zooImageUrl, effectiveParentText, campagnaInLavorazione, campagnaInCorso, campaignStato,
  suggestPhotoMatch, buildAbbinamentoIndex, animaliDi, caratteristicheProdottoDi, type ZooProduct, type ZooOffer,
} from "@/lib/zoo";
import {
  importZooOffers, updateCampaignDates, associaNuoviConAI, finalizeZooPhotoUpload, associateZooPhoto,
  confirmZooPhotoMatches, createZooParent, associaConAI, rigeneraTestiAI, saveParentTexts, setParentImage,
  toggleParentCaratteristica, scioglieParent, chiudiVolantino, riapriVolantino, nuovoVolantino,
  svuotaOfferteVolantino, rimuoviOfferteMarginiamo,
} from "@/lib/zoo-actions";

// "Associa con AI" può richiedere più dei 10s di default per un lotto di articoli:
// alza il limite dove la piattaforma lo consente (vale anche per le server action
// invocate da questa pagina, non solo per il render).
export const maxDuration = 60;

/** Le azioni su foto e padri tornano qui (le stesse servono a "Database prodotti"). */
const BACK = "/stampe/zoo/offerte";

/** Ricostruisce la query string corrente cambiando solo "vista" (mantiene ricerca/filtri). */
function vistaQs(sp: Record<string, string | undefined>, scopeParam: string, vista: string): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v && k !== "scope" && k !== "vista") params.set(k, v);
  params.set("scope", scopeParam);
  params.set("vista", vista);
  return params.toString();
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

  const db = await getZooDb();
  const academyDb = await getDb();
  const scopes = scopesForUser(user, academyDb);
  const scope = resolveScope(user, sp.scope, academyDb);
  const scopeParam = `${scope.type}:${scope.id}`;
  const consortium = isZooEditor(user);

  const campaign = campagnaInLavorazione(db);
  const inCorso = campagnaInCorso(db);
  const offers = campaign ? db.offers.filter((o) => o.campaignId === campaign.id) : [];

  // articoli di QUESTO volantino: è su questi che si lavora, non su tutto il database
  // (senza ripetizioni: più offerte possono puntare allo stesso articolo)
  const offerProducts = [
    ...new Map(
      offers
        .map((o) => db.products.find((p) => p.id === o.productId))
        .filter((p): p is ZooProduct => Boolean(p))
        .map((p) => [p.id, p])
    ).values(),
  ];
  const senzaPadre = offerProducts.filter((p) => !p.parentId);

  const activeParent = db.parents.find((p) => p.id === sp.padre);
  const parentChildren = activeParent ? db.products.filter((p) => p.parentId === activeParent.id) : [];

  // foto già caricate ma non ancora abbinate ad alcun articolo
  const usedPhotos = new Set(db.products.map((p) => (p.image ?? "").split("/").pop()));
  const availablePhotos = (await listStorageFiles("zoo-foto")).filter(
    (f) => /\.(jpg|jpeg|png|webp)$/i.test(f) && !usedPhotos.has(f)
  );
  // proposte di abbinamento per nome (nessuna AI): solo sugli articoli di questo volantino, senza foto
  const senzaFoto = offerProducts.filter((p) => !p.image);
  const abbinamentoIndex = buildAbbinamentoIndex(senzaFoto);
  const photoSuggestions = availablePhotos.slice(0, 200).map((f) => ({
    file: f,
    candidates: suggestPhotoMatch(f.replace(/\.[a-z0-9]+$/i, ""), abbinamentoIndex, 5),
  }));

  // offerte "marginiamo": nessuna promo dal fornitore, il PV decide il margine da sé — non sono offerte vere
  const marginiamo = offers.filter((o) => (o.condizioni ?? "").trim().toLowerCase() === "marginiamo");

  const fmt = (d?: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("it-IT") : "—");
  const q = (sp.q ?? "").toLowerCase();
  const visibili = offers.filter((o) => {
    if (sp.senzapadre === "1") {
      const prod = db.products.find((p) => p.id === o.productId);
      if (prod?.parentId) return false;
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
      const product = db.products.find((p) => p.id === o.productId);
      const parent = product?.parentId ? db.parents.find((x) => x.id === product.parentId) : undefined;
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
        {consortium && campaign && photoSuggestions.length > 0 && (
          <div className="card" style={{ marginBottom: 14, padding: 14 }}>
            <strong>Abbina le foto agli articoli</strong>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 8px" }}>
              Le foto senza EAN/codice nel nome non si abbinano da sole: qui sotto trovi un&apos;ipotesi per ciascuna,
              basata sul confronto tra il nome del file e la descrizione dell&apos;articolo. Controlla, correggi dove
              serve con il menu a tendina, poi conferma in blocco.
            </p>
            <form action={confirmZooPhotoMatches.bind(null, BACK, scopeParam)}>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr><th style={{ width: 56 }}>Foto</th><th>File</th><th>Abbina a</th></tr>
                  </thead>
                  <tbody>
                    {photoSuggestions.map(({ file, candidates }) => {
                      const altri = senzaFoto.filter((p) => !candidates.some((c) => c.productId === p.id));
                      return (
                        <tr key={file}>
                          <td>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={publicUrlFor(`zoo-foto/${file}`)} alt="" style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 6, border: "1px solid #eee" }} />
                          </td>
                          <td style={{ fontSize: 12 }}>{file}</td>
                          <td>
                            <select name={`pick_${file}`} defaultValue={candidates[0]?.productId ?? ""} style={{ fontSize: 12.5, maxWidth: 420 }}>
                              <option value="">— nessuno —</option>
                              {candidates.map((c) => {
                                const p = senzaFoto.find((x) => x.id === c.productId)!;
                                return (
                                  <option key={c.productId} value={c.productId}>
                                    {Math.round(c.score * 100)}% — {p.descrizione}
                                  </option>
                                );
                              })}
                              {altri.length > 0 && <option disabled>──────────</option>}
                              {altri.map((p) => (
                                <option key={p.id} value={p.id}>{p.descrizione}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button className="btn btn-sm" type="submit" style={{ marginTop: 10 }}>Conferma abbinamenti</button>
            </form>
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
            {/* ---------- editor del prodotto padre selezionato ---------- */}
            {activeParent && (
              <div className="card" style={{ marginBottom: 14, padding: 14, border: "2px solid #274b7a" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <h2 style={{ margin: 0 }}>
                    Prodotto padre: {effectiveParentText(db, scope, activeParent, "nome", academyDb).value}
                    {activeParent.aiGenerated && <span className="pill pill-blue" style={{ marginLeft: 8 }}>testi AI</span>}
                  </h2>
                  <a className="btn btn-outline btn-sm" href={`${BACK}?scope=${scopeParam}`}>✕ Chiudi</a>
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
                    <div style={{ marginTop: 12 }}>
                      <strong style={{ fontSize: 12.5 }}>Articoli del padre ({parentChildren.length})</strong>
                      <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12.5 }}>
                        {parentChildren.map((c) => <li key={c.id}>{c.descrizione} — EAN {c.ean}</li>)}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            )}

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
              <form method="get" style={{ display: "grid", gridTemplateColumns: "2fr auto auto", gap: 10, alignItems: "end" }}>
                <input type="hidden" name="scope" value={scopeParam} />
                <input type="hidden" name="vista" value={vistaArticoli ? "articoli" : "raggruppata"} />
                <label className="field" style={{ marginBottom: 0 }}>
                  Cerca<input type="text" name="q" defaultValue={sp.q ?? ""} placeholder="descrizione o EAN" />
                </label>
                <label style={{ fontSize: 12.5 }}>
                  <input type="checkbox" name="senzapadre" value="1" defaultChecked={sp.senzapadre === "1"} /> solo senza padre
                </label>
                <button className="btn btn-sm" type="submit">Filtra</button>
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
                <table className="data">
                  <thead>
                    <tr>
                      {consortium && <th style={{ width: 30 }}><BulkCheckbox name="sel" /></th>}
                      <th style={{ width: 56 }}>Foto</th>
                      <th>{vistaArticoli ? "Offerta" : "Prodotto"}</th>
                      <th>Animale</th>
                      <th>Caratteristica</th>
                      <th>{vistaArticoli ? "EAN" : "Articoli"}</th>
                      <th>Prezzo promo</th>
                      <th>Listino</th>
                      {vistaArticoli && <th>Padre</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(vistaArticoli ? visibiliCap.length : gruppiVisibili.length) === 0 && (
                      <tr><td colSpan={9} className="empty">Nessuna offerta: carica l&apos;Excel delle promo qui sopra.</td></tr>
                    )}

                    {/* ---- vista raggruppata: una riga per padre (le orfane restano singole) ---- */}
                    {!vistaArticoli && gruppiVisibili.map((g) => {
                      const { parent, offs } = g;
                      const first = offs[0];
                      const product = db.products.find((p) => p.id === first.productId);
                      const num = (s: string) => Number.parseFloat(s.replace(",", "."));
                      const prezzi = [...new Set(offs.map((o) => o.prezzoPromo).filter(Boolean))];
                      const prezzoLabel = prezzi.length === 0 ? "—"
                        : prezzi.length === 1 ? `€ ${prezzi[0]}`
                        : `€ ${Math.min(...prezzi.map(num)).toFixed(2).replace(".", ",")} – € ${Math.max(...prezzi.map(num)).toFixed(2).replace(".", ",")}`;
                      const animali = animaliDi(db, parent?.caratteristiche ?? []);
                      const prodottoCarat = caratteristicheProdottoDi(db, parent?.caratteristiche ?? []);
                      const key = parent?.id ?? `_o_${first.id}`;
                      return (
                        <tr key={key}>
                          {consortium && (
                            <td>{!parent && product && <input type="checkbox" name="sel" value={product.id} />}</td>
                          )}
                          <td>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={zooImageUrl(product, parent)} alt="" style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 6, border: "1px solid #eee" }} />
                          </td>
                          <td>
                            {parent ? (
                              <a className="pill pill-blue" href={`${BACK}?scope=${scopeParam}&padre=${parent.id}`} style={{ textDecoration: "none" }}>
                                {effectiveParentText(db, scope, parent, "nome", academyDb).value}
                              </a>
                            ) : (
                              <strong style={{ fontSize: 13 }}>{first.descrizione}</strong>
                            )}
                            {!parent && <span className="pill pill-gray" style={{ marginLeft: 6 }}>senza padre</span>}
                          </td>
                          <td style={{ fontSize: 11.5, color: "var(--muted)" }}>{animali.join(", ") || "—"}</td>
                          <td style={{ fontSize: 11.5, color: "var(--muted)" }}>{prodottoCarat.join(", ") || "—"}</td>
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
                          <td><strong>{prezzoLabel}</strong></td>
                          <td style={{ fontSize: 12.5 }}>
                            {first.prezzoListino ? `€ ${first.prezzoListino}${offs.length > 1 ? "…" : ""}` : "—"}
                          </td>
                        </tr>
                      );
                    })}

                    {/* ---- vista articoli singoli: una riga per offerta ---- */}
                    {vistaArticoli && visibiliCap.map((o) => {
                      const product = db.products.find((p) => p.id === o.productId);
                      const parent = product?.parentId ? db.parents.find((x) => x.id === product.parentId) : undefined;
                      const animali = animaliDi(db, parent?.caratteristiche ?? []);
                      const prodottoCarat = caratteristicheProdottoDi(db, parent?.caratteristiche ?? []);
                      return (
                        <tr key={o.id}>
                          {consortium && (
                            <td>{product && <input type="checkbox" name="sel" value={product.id} />}</td>
                          )}
                          <td>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={zooImageUrl(product, parent)} alt="" style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 6, border: "1px solid #eee" }} />
                          </td>
                          <td>
                            <strong style={{ fontSize: 13 }}>{o.descrizione}</strong>
                            {o.condizioni && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{o.condizioni}</div>}
                            {o.nuovo && <span className="pill pill-orange" style={{ marginTop: 2 }}>nuovo nel database</span>}
                            {product && !product.image && availablePhotos.length > 0 && consortium && (
                              <details style={{ fontSize: 11.5, marginTop: 2 }}>
                                <summary style={{ cursor: "pointer", color: "#274b7a" }}>abbina una foto…</summary>
                                <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                                  <select name="fileName" form={`ph_${product.id}`} style={{ fontSize: 11.5 }} defaultValue="">
                                    <option value="" disabled>scegli file</option>
                                    {availablePhotos.map((f) => <option key={f} value={f}>{f}</option>)}
                                  </select>
                                  <button className="btn btn-outline btn-sm" type="submit" form={`ph_${product.id}`}>OK</button>
                                </div>
                              </details>
                            )}
                          </td>
                          <td style={{ fontSize: 11.5, color: "var(--muted)" }}>{animali.join(", ") || "—"}</td>
                          <td style={{ fontSize: 11.5, color: "var(--muted)" }}>{prodottoCarat.join(", ") || "—"}</td>
                          <td style={{ fontSize: 12 }}>{o.ean}</td>
                          <td><strong>€ {o.prezzoPromo}</strong></td>
                          <td style={{ fontSize: 12.5 }}>{o.prezzoListino ? `€ ${o.prezzoListino}` : "—"}</td>
                          <td>
                            {parent ? (
                              <a className="pill pill-blue" href={`${BACK}?scope=${scopeParam}&padre=${parent.id}`} style={{ textDecoration: "none" }}>
                                {effectiveParentText(db, scope, parent, "nome", academyDb).value.slice(0, 24)}
                              </a>
                            ) : (
                              <span className="pill pill-gray">senza padre</span>
                            )}
                          </td>
                        </tr>
                      );
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

            {/* form esterni (via attributo form=) per l'abbinamento manuale delle foto */}
            {consortium && offerProducts.filter((p) => !p.image).map((p) => (
              <form key={p.id} id={`ph_${p.id}`} action={associateZooPhoto.bind(null, BACK, scopeParam, p.id)} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
