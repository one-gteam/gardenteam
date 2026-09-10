import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import StampeHeader from "@/components/stampe/StampeHeader";
import { canAccessArea, resolveScope, scopesForUser } from "@/lib/stampe";
import {
  getZooDb, campagnaInLavorazione, campagnaInCorso, migraVolantinoPages, zooImageUrl, effectiveParentText,
  datiPrezzoOfferta,
} from "@/lib/zoo";
import { aggiungiNotaBozza, risolviNotaBozza } from "@/lib/zoo-actions";

/**
 * Bozza del volantino in sola lettura, con le note di chi la rivede.
 *
 * È una pagina a sé e non una modalità di "Crea Volantino" apposta: chi dà un
 * parere non deve poter spostare le offerte (basta un trascinamento distratto
 * per disfare l'impaginazione), e chi impagina vuole trovare tutte le note in un
 * posto solo. Le note sono visibili a tutti, così i pareri non si accavallano.
 */
export default async function ZooBozzaPage({
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

  const campaign = campagnaInLavorazione(db) ?? campagnaInCorso(db);
  const layout = campaign ? db.volantinoLayouts.find((l) => l.campaignId === campaign.id) : undefined;
  const pages = layout ? migraVolantinoPages(layout.pages) : [];
  const offerById = new Map(db.offers.map((o) => [o.id, o]));
  // le doppie pagine, come in Crea Volantino: copertina da sola, poi a coppie
  const spreads: number[][] = pages.length > 0 ? [[0]] : [];
  for (let i = 1; i < pages.length; i += 2) spreads.push(pages[i + 1] ? [i, i + 1] : [i]);

  const note = campaign ? db.noteBozza.filter((n) => n.campaignId === campaign.id) : [];
  const noteAperte = note.filter((n) => !n.risolta);
  const notePerPagina = (pageId: string) => note.filter((n) => n.pageId === pageId);
  const fmt = (iso: string) => new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div>
      <StampeHeader user={user} active="bozza" area="zoo" />
      <div className="container">
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Bozza del volantino</h1>
            <p className="subtitle" style={{ margin: "4px 0 0" }}>
              {campaign
                ? <>«{campaign.nome}» — {pages.length} pagine. Sfogliala e lascia le tue note: le vedono tutti, comprese quelle degli altri.</>
                : "Nessun volantino in lavorazione."}
            </p>
          </div>
          <form method="get" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ fontSize: 12.5, fontWeight: 700 }}>
              Insegna / PV{" "}
              <select name="scope" defaultValue={scopeParam} style={{ marginTop: 2 }}>
                {scopes.map((s) => <option key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>{s.label}</option>)}
              </select>
            </label>
            <button className="btn btn-sm" type="submit">OK</button>
          </form>
        </div>

        {sp.nota && <div className="alert alert-green">✓ Nota salvata: la vedono anche gli altri.</div>}

        {campaign && (
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <strong>Una nota su tutto il volantino</strong>
            <form action={aggiungiNotaBozza.bind(null, campaign.id, scopeParam)}
              style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <input type="text" name="testo" required placeholder="es. Sulla copertina metterei il cibo umido gatto"
                style={{ flex: 1, minWidth: 260 }} />
              <button className="btn btn-sm" type="submit">Aggiungi nota</button>
            </form>
            {noteAperte.filter((n) => !n.pageId).length > 0 && (
              <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 13 }}>
                {noteAperte.filter((n) => !n.pageId).map((n) => (
                  <li key={n.id} style={{ marginBottom: 4 }}>
                    {n.testo}{" "}
                    <span style={{ color: "var(--muted)", fontSize: 11.5 }}>— {n.userName} ({n.scopeLabel}), {fmt(n.date)}</span>{" "}
                    <form action={risolviNotaBozza.bind(null, n.id, scopeParam)} style={{ display: "inline" }}>
                      <button className="btn btn-outline btn-sm" type="submit" style={{ padding: "0 6px", fontSize: 11 }}>segna risolta</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {pages.length === 0 && (
          <div className="card"><p className="empty">Non c&apos;è ancora una bozza: si compone in Crea Volantino.</p></div>
        )}

        {/*
          * Le pagine si leggono come sul volantino vero: copertina da sola, poi
          * le doppie pagine affiancate (2-3, 4-5...), ognuna in proporzione A4.
          * Prima erano una sotto l'altra a tutta larghezza e non si capiva cosa
          * sarebbe finito accanto a cosa.
          */}
        {spreads.map((gruppo, gi) => (
          <div key={gi} className="vol-spread" style={{ marginBottom: 22 }}>
            {gruppo.map((i) => {
              const page = pages[i];
              const notePagina = notePerPagina(page.id);
              const aperte = notePagina.filter((n) => !n.risolta).length;
              return (
                <div key={page.id} className="vol-page-wrap">
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                    <span className="vol-numero">{i + 1}</span>
                    <strong style={{ fontSize: 13 }}>{page.titolo || `Pagina ${i + 1}`}</strong>
                    {page.animale && <span className="pill pill-blue">{page.animale}</span>}
                    {aperte > 0 && <span className="pill pill-orange">{aperte} note</span>}
                  </div>
                  {page.note && <p className="hint" style={{ margin: "0 0 6px" }}>Per il grafico: {page.note}</p>}

                  <div className="vol-page" style={{
                    gridTemplateColumns: `repeat(${page.cols}, 1fr)`,
                    gridTemplateRows: `repeat(${page.rows}, 1fr)`,
                  }}>
                    {(page.sezioni ?? []).map((sz) => (
                      <div key={sz.id} style={{
                        gridColumn: `${sz.c + 1} / span ${sz.cs}`, gridRow: `${sz.r + 1} / span ${sz.rs}`,
                        background: sz.bg, borderRadius: 6, padding: 4, fontSize: 10, fontWeight: 700, opacity: 0.9,
                      }}>
                        {sz.titolo}
                        {sz.testo && <div style={{ fontWeight: 400, fontSize: 9.5 }}>{sz.testo}</div>}
                      </div>
                    ))}
                    {page.blocks.filter((b) => (b.offerIds?.length ?? 0) > 0 || b.testo || b.imageUrl).map((b) => {
                      const offerte = (b.offerIds ?? []).map((id) => offerById.get(id)).filter(Boolean);
                      return (
                        <div key={b.id} className="vol-cell" style={{
                          gridColumn: `${b.c + 1} / span ${b.cs}`, gridRow: `${b.r + 1} / span ${b.rs}`,
                          background: "#fff", border: "1px solid #e6e6e6",
                        }}>
                          {b.label && <span className="vol-label">{b.label}</span>}
                          {b.testo && <div className="vol-testo">{b.testo}</div>}
                          <div style={{ display: "grid", gap: 2, gridTemplateColumns: offerte.length > 1 ? "1fr 1fr" : "1fr", textAlign: "center" }}>
                            {offerte.map((o) => {
                              const prod = db.products.find((pr) => pr.id === o!.productId);
                              const parent = prod?.parentId ? db.parents.find((x) => x.id === prod.parentId) : undefined;
                              const nome = parent
                                ? effectiveParentText(db, scope, parent, "nome", academyDb).value
                                : (prod?.descrizione ?? o!.descrizione);
                              const foto = zooImageUrl(prod, parent);
                              /*
                               * Prezzo, prezzo di partenza, sconto e tipologia: chi rivede la bozza
                               * deve poter dire se l'offerta è buona, non solo se è nella pagina
                               * giusta. Il prezzo del punto vendita, se c'è, vale su quello comune.
                               */
                              const dati = datiPrezzoOfferta(db, o!, scope, academyDb, b.prezzo);
                              return (
                                <div key={o!.id} style={{ minWidth: 0 }}>
                                  {foto !== "/immagini/mancante.jpg" && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={foto} alt="" style={{ maxWidth: "100%", height: b.rs > 1 ? 56 : 30, objectFit: "contain" }} />
                                  )}
                                  <div style={{ fontSize: 9.5, fontWeight: 700, lineHeight: 1.15 }}>{nome}</div>
                                  <div style={{ display: "flex", gap: 3, justifyContent: "center", alignItems: "baseline", flexWrap: "wrap" }}>
                                    {dati.prezzo ? (
                                      <span style={{ fontSize: 12, color: "#c8161d", fontWeight: 800 }}>€ {dati.prezzo}</span>
                                    ) : (
                                      <span style={{ fontSize: 8.5, color: "#b45309", fontWeight: 700 }}>prezzo da definire</span>
                                    )}
                                    {dati.listino && (
                                      <span style={{ fontSize: 9, color: "#777", textDecoration: "line-through" }}>€ {dati.listino}</span>
                                    )}
                                    {dati.sconto && <span style={{ fontSize: 9, fontWeight: 800, color: "#15803d" }}>{dati.sconto}</span>}
                                  </div>
                                  {dati.tipi.length > 0 && (
                                    <div style={{ fontSize: 8, color: "#274b7a", fontWeight: 700 }}>{dati.tipi.join(" · ")}</div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <form action={aggiungiNotaBozza.bind(null, campaign!.id, scopeParam)}
                    style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <input type="hidden" name="pageId" value={page.id} />
                    <input type="text" name="testo" required placeholder={`Nota su «${page.titolo || `pagina ${i + 1}`}»…`}
                      style={{ flex: 1, minWidth: 0, fontSize: 12 }} />
                    <button className="btn btn-outline btn-sm" type="submit">Aggiungi</button>
                  </form>

                  {notePagina.length > 0 && (
                    <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 12 }}>
                      {notePagina.map((n) => (
                        <li key={n.id} style={{ marginBottom: 3, opacity: n.risolta ? 0.5 : 1 }}>
                          {n.risolta && "✓ "}{n.testo}{" "}
                          <span style={{ color: "var(--muted)", fontSize: 11 }}>— {n.userName} ({n.scopeLabel}), {fmt(n.date)}</span>{" "}
                          <form action={risolviNotaBozza.bind(null, n.id, scopeParam)} style={{ display: "inline" }}>
                            <button className="btn btn-outline btn-sm" type="submit" style={{ padding: "0 6px", fontSize: 11 }}>
                              {n.risolta ? "riapri" : "segna risolta"}
                            </button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
