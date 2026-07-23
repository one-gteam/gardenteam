import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import StampeHeader from "@/components/stampe/StampeHeader";
import { canAccessStampe, isConsortiumEditor, scopesForUser, resolveScope } from "@/lib/stampe";
import { getDb } from "@/lib/db";
import { getZooDb, activeCampaign, zooImageUrl, effectiveParentText } from "@/lib/zoo";
import {
  voteZooOffer, toggleOfferSelected, updateOfferVolantino, renameScheda, addScheda, resolveZooSuggestion,
} from "@/lib/zoo-actions";

export default async function ZooVolantinoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessStampe(user)) redirect("/studente");
  const sp = await searchParams;

  const db = await getZooDb();
  const academyDb = await getDb();
  const scopes = scopesForUser(user, academyDb);
  const scope = resolveScope(user, sp.scope, academyDb);
  const scopeParam = `${scope.type}:${scope.id}`;
  const consortium = isConsortiumEditor(user);

  const campaign = db.campaigns.find((c) => c.id === sp.campagna) ?? activeCampaign(db);
  const allOffers = campaign ? db.offers.filter((o) => o.campaignId === campaign.id) : [];
  const schedaFilter = sp.scheda ?? "";
  const offers = schedaFilter
    ? allOffers.filter((o) => o.selezionata && o.schedaId === schedaFilter)
    : allOffers;
  const activeOffer = allOffers.find((o) => o.id === sp.offerta);
  const selCount = allOffers.filter((o) => o.selezionata).length;
  const openSuggestions = db.suggestions.filter((s) => s.status === "aperta");

  return (
    <div>
      <StampeHeader user={user} active="volantino" area="zoo" />
      <div className="container">
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Volantino — scelta promo</h1>
            <p className="subtitle" style={{ margin: "4px 0 0" }}>
              {campaign ? `${campaign.nome} (${campaign.dal || "—"} → ${campaign.al || "—"}) · ${selCount} offerte scelte per il volantino` : "Nessuna campagna attiva"}
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
                    📤 Excel per il grafico
                  </a>
                  <a className="btn btn-outline btn-sm" href={`/stampe/zoo/foto?campagna=${campaign.id}&scope=${scopeParam}`}>
                    📷 Raccolta foto
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
                  <strong>✏️ Modifica offerta per il volantino</strong>
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
                    <button className="btn btn-sm" type="submit">💾 Salva</button>
                  </div>
                </form>
              </div>
            )}

            <div className="card table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>Foto</th>
                    <th>Offerta</th>
                    <th>Prezzo</th>
                    <th>Voti dei PV</th>
                    <th className="no-print">Il tuo voto</th>
                    {consortium && <th>Volantino (selezione finale)</th>}
                  </tr>
                </thead>
                <tbody>
                  {offers.length === 0 && <tr><td colSpan={6} className="empty">Nessuna offerta {schedaFilter ? "assegnata a questa scheda" : "in campagna"}.</td></tr>}
                  {offers.map((o) => {
                    const product = db.products.find((p) => p.id === o.productId);
                    const parent = product?.parentId ? db.parents.find((x) => x.id === product.parentId) : undefined;
                    const votes = db.votes.filter((v) => v.offerId === o.id);
                    const pref = votes.filter((v) => v.tipo === "preferita");
                    const non = votes.filter((v) => v.tipo === "nontrattato");
                    const myPref = pref.some((v) => v.userId === user.id);
                    const myNon = non.some((v) => v.userId === user.id);
                    const scheda = campaign.schede.find((s) => s.id === o.schedaId);
                    return (
                      <tr key={o.id} style={o.selezionata ? { background: "#f4faf4" } : undefined}>
                        <td>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={zooImageUrl(product, parent)} alt="" style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 6, border: "1px solid #eee" }} />
                        </td>
                        <td>
                          <strong style={{ fontSize: 13 }}>{o.descrizione}</strong>
                          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                            {product?.marca} · EAN {o.ean}
                            {parent && <> · <span title="descrizione volantino del padre">📄 {effectiveParentText(db, scope, parent, "descVolantino", academyDb).value.slice(0, 60)}</span></>}
                          </div>
                          <div style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap" }}>
                            {o.label && <span className="pill pill-orange">{o.label}</span>}
                            {o.gruppo && <span className="pill pill-blue" title={o.gruppoDescrizione}>{o.gruppo}</span>}
                            {o.tieniVicinoA && <span className="pill pill-gray" title="da tenere adiacente a un'altra offerta">🔗 adiacente</span>}
                            {scheda && <span className="pill pill-green">{scheda.nome}</span>}
                          </div>
                        </td>
                        <td>
                          <strong>€ {o.prezzoPromo}</strong>
                          {o.prezzoListino && <div style={{ fontSize: 11.5, color: "var(--muted)", textDecoration: "line-through" }}>€ {o.prezzoListino}</div>}
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {pref.length > 0 && (
                            <div title={pref.map((v) => `${v.userName} (${v.scopeLabel})`).join(", ")}>
                              👍 {pref.length}: {pref.map((v) => v.scopeLabel).slice(0, 3).join(", ")}{pref.length > 3 ? "…" : ""}
                            </div>
                          )}
                          {non.length > 0 && (
                            <div style={{ color: "#a33" }} title={non.map((v) => `${v.userName} (${v.scopeLabel})`).join(", ")}>
                              🚫 non trattato da {non.length}: {non.map((v) => v.scopeLabel).slice(0, 3).join(", ")}{non.length > 3 ? "…" : ""}
                            </div>
                          )}
                          {votes.length === 0 && <span style={{ color: "var(--muted)" }}>—</span>}
                        </td>
                        <td className="no-print" style={{ whiteSpace: "nowrap" }}>
                          <form action={voteZooOffer.bind(null, o.id, "preferita", scopeParam)} style={{ display: "inline" }}>
                            <button className={`btn btn-sm ${myPref ? "" : "btn-outline"}`} type="submit" title="La proporrei nel volantino (clic di nuovo per togliere)">
                              👍
                            </button>
                          </form>{" "}
                          <form action={voteZooOffer.bind(null, o.id, "nontrattato", scopeParam)} style={{ display: "inline" }}>
                            <button className={`btn btn-sm ${myNon ? "" : "btn-outline"}`} type="submit" title="Non ho in vendita questo prodotto (clic di nuovo per togliere)">
                              🚫
                            </button>
                          </form>
                        </td>
                        {consortium && (
                          <td style={{ whiteSpace: "nowrap" }}>
                            <form action={toggleOfferSelected.bind(null, o.id, scopeParam)} style={{ display: "inline" }}>
                              <button className={`btn btn-sm ${o.selezionata ? "" : "btn-outline"}`} type="submit">
                                {o.selezionata ? "✓ Nel volantino" : "Aggiungi"}
                              </button>
                            </form>{" "}
                            <a className="btn btn-outline btn-sm" href={`/stampe/zoo/volantino?scope=${scopeParam}${schedaFilter ? `&scheda=${schedaFilter}` : ""}&offerta=${o.id}`}>✏️</a>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* proposte di correzione dai PV */}
            {consortium && openSuggestions.length > 0 && (
              <div className="section" style={{ marginTop: 16 }}>
                <div className="section-head">
                  <h2>🚩 Proposte di correzione dai PV ({openSuggestions.length})</h2>
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
