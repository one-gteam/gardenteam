import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import StampeHeader from "@/components/stampe/StampeHeader";
import { canAccessStampe, isConsortiumEditor, scopesForUser, resolveScope } from "@/lib/stampe";
import { getDb } from "@/lib/db";
import { getZooDb, activeCampaign, zooImageUrl, effectiveParentText } from "@/lib/zoo";
import { importZooOffers, updateCampaignDates, associaNuoviConAI } from "@/lib/zoo-actions";

export default async function ZooOffertePage({
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
  const offers = campaign ? db.offers.filter((o) => o.campaignId === campaign.id) : [];
  const orphans = db.products.filter((p) => !p.parentId).length;

  return (
    <div>
      <StampeHeader user={user} active="offerte" area="zoo" />
      <div className="container">
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Importazione offerte mensili — ZOO</h1>
            <p className="subtitle" style={{ margin: "4px 0 0" }}>
              L&apos;Excel delle promo viene confrontato con il database per EAN: dati e foto già presenti vengono riutilizzati, i prodotti nuovi entrano nel database.
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
          </div>
        )}
        {sp.padri !== undefined && (
          <div className="alert alert-green">
            ✓ Creati {sp.padri} prodotti padre {sp.ai === "1" ? "con l'AI" : "con raggruppamento automatico (testi bozza)"}.
            {sp.aierr && <span style={{ color: "#a33" }}> Nota AI: {sp.aierr}</span>}
          </div>
        )}

        {consortium && (
          <div className="card" style={{ marginBottom: 14, padding: 14 }}>
            <strong>📥 Nuovo import offerte</strong>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 8px" }}>
              Colonne: EAN, DESCRIZIONE PROMO, PREZZO PROMO, PREZZO LISTINO, CONDIZIONI (+ MARCA/FORNITORE per i prodotti nuovi).{" "}
              <a href={`/stampe/zoo/excel?offerte=1&scope=${scopeParam}`}>Scarica il modello</a>
            </p>
            <form action={importZooOffers.bind(null, scopeParam)} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 2fr auto", gap: 10, alignItems: "end" }}>
              <label className="field" style={{ marginBottom: 0 }}>Nome campagna<input type="text" name="nome" placeholder="es. Offerte Marzo" /></label>
              <label className="field" style={{ marginBottom: 0 }}>Valida dal<input type="date" name="dal" required /></label>
              <label className="field" style={{ marginBottom: 0 }}>al<input type="date" name="al" required /></label>
              <label className="field" style={{ marginBottom: 0 }}>File Excel<input type="file" name="file" accept=".xlsx,.xls,.csv" required /></label>
              <button className="btn" type="submit">Importa offerte</button>
            </form>
          </div>
        )}

        {campaign ? (
          <>
            <div className="card" style={{ marginBottom: 14, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <h2 style={{ margin: 0 }}>
                    🗓️ {campaign.nome} {campaign.attiva && <span className="pill pill-green">attiva</span>}
                  </h2>
                  <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 0" }}>
                    Validità: {campaign.dal || "—"} → {campaign.al || "—"} · {offers.length} offerte
                  </p>
                </div>
                {db.campaigns.length > 1 && (
                  <form method="get" style={{ display: "flex", gap: 8 }}>
                    <input type="hidden" name="scope" value={scopeParam} />
                    <select name="campagna" defaultValue={campaign.id}>
                      {db.campaigns.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                    <button className="btn btn-sm" type="submit">Vedi</button>
                  </form>
                )}
              </div>
              {consortium && (
                <form action={updateCampaignDates.bind(null, campaign.id, scopeParam)} style={{ display: "flex", gap: 8, alignItems: "end", marginTop: 10 }}>
                  <label className="field" style={{ marginBottom: 0 }}>Nome<input type="text" name="nome" defaultValue={campaign.nome} /></label>
                  <label className="field" style={{ marginBottom: 0 }}>Dal<input type="date" name="dal" defaultValue={campaign.dal} /></label>
                  <label className="field" style={{ marginBottom: 0 }}>Al<input type="date" name="al" defaultValue={campaign.al} /></label>
                  <button className="btn btn-outline btn-sm" type="submit">Aggiorna date</button>
                </form>
              )}
            </div>

            {consortium && orphans > 0 && (
              <div className="alert" style={{ background: "#f3ecfb", border: "1px solid #d9c6f2", marginBottom: 14 }}>
                ⚠️ Ci sono <strong>{orphans} prodotti senza padre</strong> (inclusi quelli appena importati).{" "}
                <form action={associaNuoviConAI.bind(null, scopeParam)} style={{ display: "inline" }}>
                  <button className="btn btn-sm" type="submit" style={{ background: "#6d3fa7" }}>✨ Associa con AI e genera i testi</button>
                </form>{" "}
                <span className="hint">oppure raggruppali a mano nella pagina Database prodotti.</span>
              </div>
            )}

            <div className="card table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>Foto</th>
                    <th>Offerta</th>
                    <th>EAN</th>
                    <th>Prezzo promo</th>
                    <th>Listino</th>
                    <th>Prodotto nel DB</th>
                    <th>Padre</th>
                  </tr>
                </thead>
                <tbody>
                  {offers.length === 0 && <tr><td colSpan={7} className="empty">Nessuna offerta in questa campagna.</td></tr>}
                  {offers.map((o) => {
                    const product = db.products.find((p) => p.id === o.productId);
                    const parent = product?.parentId ? db.parents.find((x) => x.id === product.parentId) : undefined;
                    return (
                      <tr key={o.id}>
                        <td>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={zooImageUrl(product, parent)} alt="" style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 6, border: "1px solid #eee" }} />
                        </td>
                        <td>
                          <strong style={{ fontSize: 13 }}>{o.descrizione}</strong>
                          {o.condizioni && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{o.condizioni}</div>}
                        </td>
                        <td style={{ fontSize: 12 }}>{o.ean}</td>
                        <td><strong>€ {o.prezzoPromo}</strong></td>
                        <td style={{ fontSize: 12.5 }}>{o.prezzoListino ? `€ ${o.prezzoListino}` : "—"}</td>
                        <td>
                          {o.nuovo
                            ? <span className="pill pill-orange">nuovo → aggiunto al DB</span>
                            : <span className="pill pill-green">già presente</span>}
                        </td>
                        <td>
                          {parent ? (
                            <a className="pill pill-blue" href={`/stampe/zoo/dati?scope=${scopeParam}&padre=${parent.id}`} style={{ textDecoration: "none" }}>
                              {effectiveParentText(db, scope, parent, "nome", academyDb).value.slice(0, 24)}
                            </a>
                          ) : (
                            <span className="pill pill-gray">da raggruppare</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
            Nessuna campagna importata: carica il primo Excel delle offerte mensili qui sopra.
          </div>
        )}
      </div>
    </div>
  );
}
