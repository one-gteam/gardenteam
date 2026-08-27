import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import StampeHeader from "@/components/stampe/StampeHeader";
import { canAccessArea, isZooEditor, scopesForUser, resolveScope } from "@/lib/stampe";
import { getDb } from "@/lib/db";
import { getZooDb, campagnaInLavorazione, zooImageUrl, effectiveParentText, animaliDi } from "@/lib/zoo";
import {
  voteZooOffer, voteZooOffersBulk, toggleOfferSelected, toggleOffersGroupSelected, updateOfferVolantino,
  renameScheda, addScheda, resolveZooSuggestion, sendZooSuggestion,
} from "@/lib/zoo-actions";
import ShiftChecks from "@/components/stampe/ShiftChecks";

const RIGHE_MAX = 300;

export default async function ZooVolantinoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessArea(user, "zoo")) redirect("/studente");
  const sp = await searchParams;

  // letture indipendenti: in parallelo pesa solo la più lenta, non la somma
  const [db, academyDb] = await Promise.all([getZooDb(), getDb()]);
  const scopes = scopesForUser(user, academyDb);
  const scope = resolveScope(user, sp.scope, academyDb);
  const scopeParam = `${scope.type}:${scope.id}`;
  const consortium = isZooEditor(user);

  // solo il volantino IN LAVORAZIONE: su quelli chiusi o archiviati non si sceglie più
  const campaign = campagnaInLavorazione(db);
  const allOffers = campaign ? db.offers.filter((o) => o.campaignId === campaign.id) : [];
  const schedaFilter = sp.scheda ?? "";
  const baseOffers = schedaFilter
    ? allOffers.filter((o) => o.selezionata && o.schedaId === schedaFilter)
    : allOffers;

  /*
   * Indici per id: con oltre mille articoli e centinaia di offerte, un `.find()`
   * dentro il ciclo delle righe (per prodotto, padre e voti) costa quadratico ed
   * era una delle ragioni per cui questa pagina risultava lenta.
   */
  const prodById = new Map(db.products.map((p) => [p.id, p]));
  const parentById = new Map(db.parents.map((p) => [p.id, p]));
  const votesByOffer = new Map<string, typeof db.votes>();
  for (const v of db.votes) votesByOffer.set(v.offerId, [...(votesByOffer.get(v.offerId) ?? []), v]);

  // ---- filtro offerte (colonna sinistra) ----
  const parentOf = (o: (typeof allOffers)[number]) => {
    const parentId = prodById.get(o.productId ?? "")?.parentId;
    return parentId ? parentById.get(parentId) : undefined;
  };
  const caratteristicheOf = (o: (typeof allOffers)[number]): string[] => parentOf(o)?.caratteristiche ?? [];
  const prodOf = (o: (typeof allOffers)[number]) => prodById.get(o.productId ?? "");
  const ANIMALI = db.settings.categorieAnimali;
  const carattsProdotto = db.settings.caratteristicheProdotto;
  const marche = [...new Set(baseOffers.map((o) => prodOf(o)?.marca).filter(Boolean) as string[])].sort();
  const fornitori = [...new Set(baseOffers.map((o) => prodOf(o)?.fornitore).filter(Boolean) as string[])].sort();
  // se sono già su una scheda con nome animale (es. "Cane"), il filtro parte da lì
  const schedaNome = campaign?.schede.find((s) => s.id === schedaFilter)?.nome ?? "";
  const animale = sp.animale ?? (ANIMALI.includes(schedaNome) ? schedaNome : "");
  const caratt = sp.caratt ?? "";
  const offers = baseOffers.filter((o) => {
    if (animale && !caratteristicheOf(o).includes(animale)) return false;
    if (caratt && !caratteristicheOf(o).includes(caratt)) return false;
    if (sp.marca && prodOf(o)?.marca !== sp.marca) return false;
    if (sp.fornitore && prodOf(o)?.fornitore !== sp.fornitore) return false;
    return true;
  });

  // ordinamento per colonna (clic sull'intestazione): mantiene tutti i filtri correnti
  const sortDir = sp.dir === "desc" ? "desc" : "asc";
  const sortVal = (o: (typeof offers)[number]): string | number => {
    switch (sp.sort) {
      case "prezzo": return Number.parseFloat((o.prezzoPromo || "0").replace(",", "."));
      case "marca": return prodOf(o)?.marca ?? "";
      case "fornitore": return prodOf(o)?.fornitore ?? "";
      case "animale": return animaliDi(db, caratteristicheOf(o)).join(", ");
      default: return o.descrizione;
    }
  };
  const offersOrdinate = sp.sort
    ? [...offers].sort((a, b) => {
        const va = sortVal(a);
        const vb = sortVal(b);
        const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "it");
        return sortDir === "desc" ? -cmp : cmp;
      })
    : offers;
  /*
   * Le varianti di uno stesso padre diventano una riga sola: con centinaia di
   * offerte è molto più leggero da scorrere, e chi sceglie ragiona comunque per
   * prodotto ("mettiamo questa linea?") più che per singolo gusto/formato.
   */
  const gruppi = (() => {
    const map = new Map<string, { parent?: (typeof db.parents)[number]; offs: typeof offersOrdinate }>();
    for (const o of offersOrdinate) {
      const parent = parentOf(o);
      const key = parent?.id ?? `_o_${o.id}`;
      const g = map.get(key) ?? { parent, offs: [] };
      g.offs.push(o);
      map.set(key, g);
    }
    return [...map.values()];
  })();
  const gruppiVisibili = gruppi.slice(0, RIGHE_MAX);

  const sortHref = (field: string) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "sort" && k !== "dir" && k !== "scope") params.set(k, v);
    params.set("scope", scopeParam);
    params.set("sort", field);
    params.set("dir", sp.sort === field && sortDir === "asc" ? "desc" : "asc");
    return `?${params.toString()}`;
  };
  const sortArrow = (field: string) => (sp.sort === field ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  const activeOffer = allOffers.find((o) => o.id === sp.offerta);
  const selCount = allOffers.filter((o) => o.selezionata).length;
  const openSuggestions = db.suggestions.filter((s) => s.status === "aperta");

  return (
    <div>
      <StampeHeader user={user} active="volantino" area="zoo" />
      <div className="container">
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Scelta Offerte</h1>
            <p className="subtitle" style={{ margin: "4px 0 0" }}>
              {campaign
                ? `${campaign.nome} (${campaign.dal || "—"} → ${campaign.al || "—"}) · ${selCount} offerte scelte per il volantino`
                : "Nessun volantino in lavorazione: aprine uno da Import offerte"}
              {consortium
                ? " · Tu vedi i voti di tutti i PV e fai la selezione finale."
                : " · Segna le offerte che ti piacciono: il Consorzio vede i voti di tutti i responsabili."}
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

        {!campaign && (
          <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
            Importa prima le offerte mensili nella pagina &quot;Import offerte&quot;.
          </div>
        )}

        {campaign && (
          <>
            {/* schede (pagine del volantino) */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
              <a className={`pill ${!schedaFilter ? "pill-blue" : "pill-gray"}`} href={`/stampe/zoo/volantino?scope=${scopeParam}`} style={{ textDecoration: "none" }}>
                Tutte le offerte ({allOffers.length})
              </a>
              {campaign.schede.map((s) => {
                const n = allOffers.filter((o) => o.selezionata && o.schedaId === s.id).length;
                return (
                  <a key={s.id} className={`pill ${schedaFilter === s.id ? "pill-blue" : "pill-gray"}`}
                    href={`/stampe/zoo/volantino?scope=${scopeParam}&scheda=${s.id}`} style={{ textDecoration: "none" }}>
                    {s.nome} ({n})
                  </a>
                );
              })}
              {consortium && (
                <form action={addScheda.bind(null, campaign.id, scopeParam)}>
                  <button className="btn btn-outline btn-sm" type="submit">+ scheda</button>
                </form>
              )}
              <span style={{ flex: 1 }} />
              {consortium && (
                <>
                  <a className="btn btn-outline btn-sm" href={`/stampe/zoo/excel?volantino=1&campagna=${campaign.id}&scope=${scopeParam}`}>
                    Excel per il grafico
                  </a>
                  <a className="btn btn-outline btn-sm" href={`/stampe/zoo/foto?campagna=${campaign.id}&scope=${scopeParam}`}>
                    Raccolta foto
                  </a>
                </>
              )}
            </div>

            {/* rinomina schede */}
            {consortium && schedaFilter && (
              <div className="card" style={{ padding: 10, marginBottom: 12 }}>
                <form action={renameScheda.bind(null, campaign.id, schedaFilter, scopeParam)} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>Rinomina scheda:</span>
                  <input type="text" name="nome" defaultValue={campaign.schede.find((s) => s.id === schedaFilter)?.nome} style={{ width: 240 }} />
                  <button className="btn btn-sm" type="submit">Salva</button>
                </form>
              </div>
            )}

            {/* pannello modifica offerta (Consorzio) */}
            {consortium && activeOffer && (
              <div className="card" style={{ padding: 14, marginBottom: 12, border: "2px solid #274b7a" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <strong>Modifica offerta per il volantino</strong>
                  <a className="btn btn-outline btn-sm" href={`/stampe/zoo/volantino?scope=${scopeParam}`}>✕ Chiudi</a>
                </div>
                <form action={updateOfferVolantino.bind(null, activeOffer.id, scopeParam)} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label className="field" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
                    Descrizione promo
                    <textarea name="descrizione" rows={2} defaultValue={activeOffer.descrizione} />
                  </label>
                  <label className="field" style={{ marginBottom: 0 }}>
                    Scheda
                    <select name="schedaId" defaultValue={activeOffer.schedaId ?? ""}>
                      <option value="">— non assegnata —</option>
                      {campaign.schede.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                    </select>
                  </label>
                  <label className="field" style={{ marginBottom: 0 }}>
                    Etichetta
                    <select name="label" defaultValue={activeOffer.label ?? ""}>
                      <option value="">— nessuna —</option>
                      {db.settings.labels.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </label>
                  <label className="field" style={{ marginBottom: 0 }}>
                    Area tematica (gruppo)
                    <input type="text" name="gruppo" defaultValue={activeOffer.gruppo ?? ""} placeholder="es. Speciale cuccioli" />
                  </label>
                  <label className="field" style={{ marginBottom: 0 }}>
                    Descrizione area tematica
                    <input type="text" name="gruppoDescrizione" defaultValue={activeOffer.gruppoDescrizione ?? ""} placeholder="testo introduttivo del gruppo" />
                  </label>
                  <label className="field" style={{ marginBottom: 0 }}>
                    Tieni vicino a
                    <select name="tieniVicinoA" defaultValue={activeOffer.tieniVicinoA ?? ""}>
                      <option value="">—</option>
                      {allOffers.filter((o) => o.id !== activeOffer.id && o.selezionata).map((o) => (
                        <option key={o.id} value={o.id}>{o.descrizione.slice(0, 50)}</option>
                      ))}
                    </select>
                  </label>
                  <div style={{ display: "flex", alignItems: "end" }}>
                    <button className="btn btn-sm" type="submit">Salva</button>
                  </div>
                </form>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "230px 1fr", gap: 14, alignItems: "start" }}>
            {/* filtro offerte */}
            <div className="card" style={{ padding: 14 }}>
              <strong style={{ fontSize: 13.5 }}>Filtro offerte</strong>
              <form method="get" style={{ marginTop: 8 }}>
                <input type="hidden" name="scope" value={scopeParam} />
                {schedaFilter && <input type="hidden" name="scheda" value={schedaFilter} />}
                <label className="field">Tipologia di animale
                  <select name="animale" defaultValue={animale}>
                    <option value="">Tutte</option>
                    {ANIMALI.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </label>
                <label className="field">Caratteristica prodotto
                  <select name="caratt" defaultValue={caratt}>
                    <option value="">Tutte</option>
                    {carattsProdotto.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="field">Marca
                  <select name="marca" defaultValue={sp.marca ?? ""}>
                    <option value="">Tutte</option>
                    {marche.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
                <label className="field">Fornitore
                  <select name="fornitore" defaultValue={sp.fornitore ?? ""}>
                    <option value="">Tutti</option>
                    {fornitori.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
                <button className="btn btn-sm" type="submit" style={{ width: "100%" }}>Filtra</button>
              </form>
              <p className="hint" style={{ marginTop: 10, fontSize: 11.5 }}>
                {offers.length} offerte in {gruppi.length} prodotti{gruppi.length > RIGHE_MAX ? ` (mostrati i primi ${RIGHE_MAX}: restringi con i filtri)` : ""}.
                Spunta più offerte (anche con Shift+clic) e usa i pulsanti sopra la tabella per proporle o segnarle
                non trattate in blocco. Clic sulle intestazioni della tabella per ordinare.
              </p>
            </div>

            <div>
            <ShiftChecks />
            {sp.votate && <div className="alert alert-green">✓ Voto registrato su {sp.votate} offerte.</div>}
            {/* le spunte in tabella appartengono a questo form via attributo form="bulkform" */}
            <form id="bulkform" action={voteZooOffersBulk.bind(null, "preferita", scopeParam)}
              style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <button className="btn btn-sm" type="submit">Proponi le offerte spuntate</button>
              <button className="btn btn-outline btn-sm" formAction={voteZooOffersBulk.bind(null, "nontrattato", scopeParam)}>
                Segna spuntate come non trattate
              </button>
            </form>
            <div className="card table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 30 }}></th>
                    <th style={{ width: 56 }}>Foto</th>
                    <th><a href={sortHref("descrizione")} style={{ textDecoration: "none", color: "inherit" }}>Offerta{sortArrow("descrizione")}</a></th>
                    <th><a href={sortHref("fornitore")} style={{ textDecoration: "none", color: "inherit" }}>Fornitore{sortArrow("fornitore")}</a></th>
                    <th><a href={sortHref("marca")} style={{ textDecoration: "none", color: "inherit" }}>Marca{sortArrow("marca")}</a></th>
                    <th><a href={sortHref("animale")} style={{ textDecoration: "none", color: "inherit" }}>Animale{sortArrow("animale")}</a></th>
                    <th><a href={sortHref("prezzo")} style={{ textDecoration: "none", color: "inherit" }}>Prezzo{sortArrow("prezzo")}</a></th>
                    <th>Voti dei PV</th>
                    <th className="no-print">Il tuo voto</th>
                    {consortium && <th>Volantino (selezione finale)</th>}
                  </tr>
                </thead>
                <tbody>
                  {gruppi.length === 0 && <tr><td colSpan={10} className="empty">Nessuna offerta {schedaFilter ? "assegnata a questa scheda" : "in campagna"}.</td></tr>}
                  {gruppiVisibili.map((g) => {
                    const { parent, offs } = g;
                    const first = offs[0];
                    const isGroup = offs.length > 1;
                    const product = prodOf(first);
                    const animaliOfferta = animaliDi(db, parent?.caratteristiche ?? []);
                    const num = (s: string) => Number.parseFloat((s || "0").replace(",", "."));
                    const prezzi = [...new Set(offs.map((o) => o.prezzoPromo).filter(Boolean))];
                    const prezzoLabel = prezzi.length <= 1
                      ? `€ ${prezzi[0] ?? first.prezzoPromo}`
                      : `€ ${Math.min(...prezzi.map(num)).toFixed(2).replace(".", ",")} – € ${Math.max(...prezzi.map(num)).toFixed(2).replace(".", ",")}`;
                    // voti aggregati: PV distinti che hanno votato almeno una variante del gruppo
                    const groupVotes = offs.flatMap((o) => votesByOffer.get(o.id) ?? []);
                    const pref = [...new Map(groupVotes.filter((v) => v.tipo === "preferita").map((v) => [v.userId, v])).values()];
                    const non = [...new Map(groupVotes.filter((v) => v.tipo === "nontrattato").map((v) => [v.userId, v])).values()];
                    const myPref = pref.some((v) => v.userId === user.id);
                    const myNon = non.some((v) => v.userId === user.id);
                    const scheda = campaign.schede.find((s) => s.id === first.schedaId);
                    const ids = offs.map((o) => o.id);
                    const selCountGroup = offs.filter((o) => o.selezionata).length;
                    return (
                      <tr key={parent?.id ?? first.id} style={selCountGroup === offs.length ? { background: "#f4faf4" } : undefined}>
                        <td>
                          {/* la spunta porta l'id della prima offerta: l'azione in blocco estende
                              il voto a tutte le varianti dello stesso padre */}
                          <input type="checkbox" name="zsel" value={first.id} form="bulkform"
                            title={isGroup
                              ? `Spunta per proporre/segnalare tutte le ${offs.length} varianti (Shift+clic per intervalli)`
                              : "Spunta per proporre/segnalare in blocco (Shift+clic per intervalli)"} />
                        </td>
                        <td>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={zooImageUrl(product, parent)} alt="" style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 6, border: "1px solid #eee" }} />
                        </td>
                        <td>
                          <strong style={{ fontSize: 13 }}>
                            {parent ? effectiveParentText(db, scope, parent, "nome", academyDb).value : first.descrizione}
                          </strong>
                          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                            {product?.marca}
                            {isGroup ? ` · ${offs.length} varianti` : ` · EAN ${first.ean}`}
                            {parent && <> · <span title="descrizione volantino del padre">{effectiveParentText(db, scope, parent, "descVolantino", academyDb).value.slice(0, 60)}</span></>}
                          </div>
                          {!isGroup && (
                            <div style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap" }}>
                              {first.label && <span className="pill pill-orange">{first.label}</span>}
                              {first.gruppo && <span className="pill pill-blue" title={first.gruppoDescrizione}>{first.gruppo}</span>}
                              {first.tieniVicinoA && <span className="pill pill-gray" title="da tenere adiacente a un'altra offerta">adiacente</span>}
                              {scheda && <span className="pill pill-green">{scheda.nome}</span>}
                            </div>
                          )}
                          <details style={{ marginTop: 4 }}>
                            <summary style={{ cursor: "pointer", fontSize: 11.5, color: "var(--green-700)", fontWeight: 600 }}>
                              Vedi {offs.length > 1 ? `i ${offs.length} articoli inclusi` : "l'articolo"}
                            </summary>
                            <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 11.5, color: "var(--muted)" }}>
                              {offs.map((o) => (
                                <li key={o.id}>
                                  {o.descrizione}
                                  <span style={{ opacity: 0.75 }}> · EAN {o.ean} · € {o.prezzoPromo}</span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        </td>
                        <td style={{ fontSize: 12.5 }}>{product?.fornitore || "—"}</td>
                        <td style={{ fontSize: 12.5 }}>{product?.marca || "—"}</td>
                        <td style={{ fontSize: 11.5, color: "var(--muted)" }}>{animaliOfferta.join(", ") || "—"}</td>
                        <td>
                          <strong>{prezzoLabel}</strong>
                          {!isGroup && first.prezzoListino && <div style={{ fontSize: 11.5, color: "var(--muted)", textDecoration: "line-through" }}>€ {first.prezzoListino}</div>}
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {pref.length > 0 && (
                            <div title={pref.map((v) => `${v.userName} (${v.scopeLabel})`).join(", ")}>
                              {pref.length}: {pref.map((v) => v.scopeLabel).slice(0, 3).join(", ")}{pref.length > 3 ? "…" : ""}
                            </div>
                          )}
                          {non.length > 0 && (
                            <div style={{ color: "#a33" }} title={non.map((v) => `${v.userName} (${v.scopeLabel})`).join(", ")}>
                              non trattato da {non.length}: {non.map((v) => v.scopeLabel).slice(0, 3).join(", ")}{non.length > 3 ? "…" : ""}
                            </div>
                          )}
                          {pref.length === 0 && non.length === 0 && <span style={{ color: "var(--muted)" }}>—</span>}
                        </td>
                        <td className="no-print" style={{ whiteSpace: "nowrap" }}>
                          {isGroup ? (
                            <>
                              <form action={voteZooOffersBulk.bind(null, "preferita", scopeParam)} style={{ display: "inline" }}>
                                {ids.map((id) => <input key={id} type="hidden" name="zsel" value={id} />)}
                                <button className={`btn btn-sm ${myPref ? "" : "btn-outline"}`} type="submit" title="Proponi tutte le varianti (clic di nuovo per togliere il tuo voto)">
                                  Proponi
                                </button>
                              </form>{" "}
                              <form action={voteZooOffersBulk.bind(null, "nontrattato", scopeParam)} style={{ display: "inline" }}>
                                {ids.map((id) => <input key={id} type="hidden" name="zsel" value={id} />)}
                                <button className={`btn btn-sm ${myNon ? "" : "btn-outline"}`} type="submit" title="Non tratto nessuna variante (clic di nuovo per togliere)">
                                  Non tratto
                                </button>
                              </form>
                            </>
                          ) : (
                            <>
                              <form action={voteZooOffer.bind(null, first.id, "preferita", scopeParam)} style={{ display: "inline" }}>
                                <button className={`btn btn-sm ${myPref ? "" : "btn-outline"}`} type="submit" title="La proporrei nel volantino (clic di nuovo per togliere)">
                                  Proponi
                                </button>
                              </form>{" "}
                              <form action={voteZooOffer.bind(null, first.id, "nontrattato", scopeParam)} style={{ display: "inline" }}>
                                <button className={`btn btn-sm ${myNon ? "" : "btn-outline"}`} type="submit" title="Non ho in vendita questo prodotto (clic di nuovo per togliere)">
                                  Non tratto
                                </button>
                              </form>
                            </>
                          )}{" "}
                          <details className="flag-details" style={{ display: "inline-block" }}>
                            <summary className="mini-btn" title="Segnala un errore o un'incongruenza su questa offerta">⚑</summary>
                            <form action={sendZooSuggestion.bind(null, scopeParam)} className="flag-popover">
                              <input type="hidden" name="offerId" value={first.id} />
                              <input type="hidden" name="back" value="/stampe/zoo/volantino" />
                              <input type="text" name="message" required placeholder="Descrivi l'errore o l'incongruenza" />
                              <button className="btn btn-sm" type="submit">Invia al Consorzio</button>
                            </form>
                          </details>
                        </td>
                        {consortium && (
                          <td style={{ whiteSpace: "nowrap" }}>
                            {isGroup ? (
                              <form action={toggleOffersGroupSelected.bind(null, ids, scopeParam)} style={{ display: "inline" }}>
                                <button className={`btn btn-sm ${selCountGroup === offs.length ? "" : "btn-outline"}`} type="submit">
                                  {selCountGroup === offs.length ? "✓ Nel volantino" : selCountGroup > 0 ? `${selCountGroup}/${offs.length} nel volantino` : "Aggiungi tutte"}
                                </button>
                              </form>
                            ) : (
                              <>
                                <form action={toggleOfferSelected.bind(null, first.id, scopeParam)} style={{ display: "inline" }}>
                                  <button className={`btn btn-sm ${first.selezionata ? "" : "btn-outline"}`} type="submit">
                                    {first.selezionata ? "✓ Nel volantino" : "Aggiungi"}
                                  </button>
                                </form>{" "}
                                <a className="btn btn-outline btn-sm" href={`/stampe/zoo/volantino?scope=${scopeParam}${schedaFilter ? `&scheda=${schedaFilter}` : ""}&offerta=${first.id}`}>Modifica</a>
                              </>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </div>
            </div>

            {/* proposte di correzione dai PV */}
            {consortium && openSuggestions.length > 0 && (
              <div className="section" style={{ marginTop: 16 }}>
                <div className="section-head">
                  <h2>Proposte di correzione dai PV ({openSuggestions.length})</h2>
                </div>
                <div className="card table-wrap">
                  <table className="data">
                    <thead><tr><th>Riferimento</th><th>Messaggio</th><th>Da</th><th></th></tr></thead>
                    <tbody>
                      {openSuggestions.map((s) => {
                        const parent = s.parentId ? db.parents.find((p) => p.id === s.parentId) : undefined;
                        const offer = s.offerId ? db.offers.find((o) => o.id === s.offerId) : undefined;
                        return (
                          <tr key={s.id}>
                            <td style={{ fontSize: 12.5 }}>{parent?.nome ?? offer?.descrizione ?? "—"}</td>
                            <td style={{ maxWidth: 320 }}>{s.message}</td>
                            <td style={{ fontSize: 12.5 }}>
                              {s.userName}
                              <div style={{ fontSize: 11, color: "var(--muted)" }}>{s.scopeLabel} · {new Date(s.date).toLocaleDateString("it-IT")}</div>
                            </td>
                            <td>
                              <form action={resolveZooSuggestion.bind(null, s.id)}>
                                <button className="btn btn-outline btn-sm" type="submit">✓ Risolta</button>
                              </form>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
