import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import StampeHeader from "@/components/stampe/StampeHeader";
import { canAccessArea, resolveScope, scopesForUser } from "@/lib/stampe";
import {
  getZooDb, campagnaInLavorazione, campagnaInCorso, migraVolantinoPages, zooImageUrl, effectiveParentText,
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

        {pages.map((page, i) => {
          const notePagina = notePerPagina(page.id);
          return (
            <div key={page.id} className="card" style={{ padding: 14, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 15 }}>{i + 1}. {page.titolo || `Pagina ${i + 1}`}</strong>
                {page.animale && <span className="pill pill-blue">{page.animale}</span>}
                {notePagina.filter((n) => !n.risolta).length > 0 && (
                  <span className="pill pill-orange">{notePagina.filter((n) => !n.risolta).length} note</span>
                )}
                {page.note && <span className="hint">Indicazioni per il grafico: {page.note}</span>}
              </div>

              <div style={{
                display: "grid",
                gridTemplateColumns: `repeat(${page.cols}, 1fr)`,
                gap: 6,
                background: "#fafaf7",
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: 8,
              }}>
                {(page.sezioni ?? []).map((s) => (
                  <div key={s.id} style={{
                    gridColumn: `${s.c + 1} / span ${s.cs}`, gridRow: `${s.r + 1} / span ${s.rs}`,
                    background: s.bg, borderRadius: 6, padding: 6, fontSize: 12, fontWeight: 700, opacity: 0.9,
                  }}>
                    {s.titolo}
                    {s.testo && <div style={{ fontWeight: 400, fontSize: 11.5 }}>{s.testo}</div>}
                  </div>
                ))}
                {page.blocks.filter((b) => (b.offerIds?.length ?? 0) > 0 || b.testo || b.imageUrl).map((b) => {
                  const offerte = (b.offerIds ?? []).map((id) => offerById.get(id)).filter(Boolean);
                  return (
                    <div key={b.id} style={{
                      gridColumn: `${b.c + 1} / span ${b.cs}`, gridRow: `${b.r + 1} / span ${b.rs}`,
                      background: "#fff", border: "1px solid #e6e6e6", borderRadius: 6, padding: 6, minHeight: 74,
                    }}>
                      {b.label && <span className="pill pill-orange" style={{ fontSize: 10 }}>{b.label}</span>}
                      {b.testo && <div style={{ fontSize: 12, fontWeight: 700 }}>{b.testo}</div>}
                      {offerte.map((o) => {
                        const prod = db.products.find((p) => p.id === o!.productId);
                        const parent = prod?.parentId ? db.parents.find((x) => x.id === prod.parentId) : undefined;
                        const nome = parent
                          ? effectiveParentText(db, scope, parent, "nome", academyDb).value
                          : (prod?.descrizione ?? o!.descrizione);
                        const foto = zooImageUrl(prod, parent);
                        return (
                          <div key={o!.id} style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
                            {foto !== "/immagini/mancante.jpg" && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={foto} alt="" style={{ width: 34, height: 34, objectFit: "contain" }} />
                            )}
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 11.5, fontWeight: 700, lineHeight: 1.15 }}>{nome}</div>
                              <div style={{ fontSize: 12, color: "#c8161d", fontWeight: 800 }}>
                                € {b.prezzo || o!.prezzoPromo}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              <form action={aggiungiNotaBozza.bind(null, campaign!.id, scopeParam)}
                style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <input type="hidden" name="pageId" value={page.id} />
                <input type="text" name="testo" required placeholder={`Nota su «${page.titolo || `pagina ${i + 1}`}»…`}
                  style={{ flex: 1, minWidth: 240 }} />
                <button className="btn btn-outline btn-sm" type="submit">Aggiungi nota a questa pagina</button>
              </form>

              {notePagina.length > 0 && (
                <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>
                  {notePagina.map((n) => (
                    <li key={n.id} style={{ marginBottom: 4, opacity: n.risolta ? 0.5 : 1 }}>
                      {n.risolta && "✓ "}{n.testo}{" "}
                      <span style={{ color: "var(--muted)", fontSize: 11.5 }}>— {n.userName} ({n.scopeLabel}), {fmt(n.date)}</span>{" "}
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
    </div>
  );
}
