import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import StampeHeader from "@/components/stampe/StampeHeader";
import { canAccessStampe, isConsortiumEditor, scopesForUser, resolveScope } from "@/lib/stampe";
import { getDb } from "@/lib/db";
import { listStorageFiles } from "@/lib/supabase";
import {
  getZooDb, zooImageUrl, effectiveParentText, isZooHidden, hiddenEntriesFor, fornitoriList, marcheList,
} from "@/lib/zoo";
import {
  importZooProducts, uploadZooPhotos, associateZooPhoto, createZooParent, associaConAI,
  rigeneraTestiAI, saveParentTexts, setParentImage, toggleParentCaratteristica, scioglieParent, toggleZooHidden,
} from "@/lib/zoo-actions";

export default async function ZooDatiPage({
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

  // filtri
  const q = (sp.q ?? "").toLowerCase();
  const soloSenzaPadre = sp.senzapadre === "1";
  let products = db.products.filter((p) => {
    if (sp.fornitore && p.fornitore !== sp.fornitore) return false;
    if (sp.marca && p.marca !== sp.marca) return false;
    if (soloSenzaPadre && p.parentId) return false;
    if (q && !`${p.descrizione} ${p.ean} ${p.codice} ${p.marca}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const hiddenHere = hiddenEntriesFor(db, scope);
  const showHidden = sp.nascosti === "1";
  if (scope.type !== "system" && !showHidden) products = products.filter((p) => !isZooHidden(db, scope, p, academyDb));

  const activeParent = db.parents.find((p) => p.id === sp.padre);
  const parentChildren = activeParent ? db.products.filter((p) => p.parentId === activeParent.id) : [];

  // foto disponibili non ancora abbinate (per l'associazione manuale)
  const usedPhotos = new Set(db.products.map((p) => (p.image ?? "").split("/").pop()));
  const availablePhotos = (await listStorageFiles("zoo-foto")).filter(
    (f) => /\.(jpg|jpeg|png|webp)$/i.test(f) && !usedPhotos.has(f)
  );

  const senzaPadre = db.products.filter((p) => !p.parentId).length;

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
        {sp.padri !== undefined && (
          <div className="alert alert-green">
            ✓ Creati {sp.padri} prodotti padre {sp.ai === "1" ? "con l'AI (testi volantino e cartello generati)" : "con raggruppamento automatico (testi bozza da rivedere)"}.
            {sp.aierr && <span style={{ color: "#a33" }}> Nota AI: {sp.aierr}</span>}
          </div>
        )}

        {/* strumenti del Consorzio: import Excel + caricamento foto */}
        {consortium && scope.type === "system" && (
          <div className="card" style={{ marginBottom: 14, padding: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <strong>📥 Import Excel prodotti</strong>
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
                <strong>📷 Caricamento foto</strong>
                <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 8px" }}>
                  Puoi selezionare più foto insieme: se il nome del file contiene l&apos;EAN o il codice fornitore, l&apos;abbinamento è automatico.
                </p>
                <form action={uploadZooPhotos.bind(null, scopeParam)} style={{ display: "flex", gap: 8 }}>
                  <input type="file" name="foto" accept="image/*" multiple required />
                  <button className="btn btn-sm" type="submit">Carica foto</button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* editor del prodotto padre selezionato */}
        {activeParent && (
          <div className="card" style={{ marginBottom: 14, padding: 14, border: "2px solid #274b7a" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>
                📦 Prodotto padre: {effectiveParentText(db, scope, activeParent, "nome", academyDb).value}
                {activeParent.aiGenerated && <span className="pill pill-blue" style={{ marginLeft: 8 }}>✨ testi AI</span>}
              </h2>
              <a className="btn btn-outline btn-sm" href={`/stampe/zoo/dati?scope=${scopeParam}`}>✕ Chiudi</a>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 16 }}>
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={zooImageUrl(undefined, activeParent) === "/immagini/mancante.jpg" && parentChildren[0] ? zooImageUrl(parentChildren[0]) : zooImageUrl(undefined, activeParent)} alt="" style={{ width: "100%", borderRadius: 8, background: "#fff", border: "1px solid #e4e4e4" }} />
                {consortium && (
                  <>
                    <form action={setParentImage.bind(null, activeParent.id, scopeParam)} style={{ marginTop: 8, display: "grid", gap: 6 }}>
                      <select name="fromChild" style={{ fontSize: 12 }}>
                        <option value="">Immagine di riferimento: scegli da un articolo…</option>
                        {parentChildren.filter((c) => c.image).map((c) => (
                          <option key={c.id} value={c.id}>{c.descrizione.slice(0, 45)}</option>
                        ))}
                      </select>
                      <button className="btn btn-outline btn-sm" type="submit">Usa questa</button>
                    </form>
                    <form action={setParentImage.bind(null, activeParent.id, scopeParam)} style={{ marginTop: 6, display: "grid", gap: 6 }}>
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
                        <form key={c} action={toggleParentCaratteristica.bind(null, activeParent.id, c, scopeParam)}>
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
                <form action={saveParentTexts.bind(null, activeParent.id, scopeParam)} style={{ display: "grid", gap: 10 }}>
                  <label className="field" style={{ marginBottom: 0 }}>
                    Nome prodotto padre
                    <input type="text" name="nome" defaultValue={effectiveParentText(db, scope, activeParent, "nome", academyDb).value} />
                  </label>
                  <label className="field" style={{ marginBottom: 0 }}>
                    Descrizione per il VOLANTINO {effectiveParentText(db, scope, activeParent, "descVolantino", academyDb).custom && <span className="pill pill-orange">personalizzata</span>}
                    <textarea name="descVolantino" rows={2} defaultValue={effectiveParentText(db, scope, activeParent, "descVolantino", academyDb).value} />
                  </label>
                  <label className="field" style={{ marginBottom: 0 }}>
                    Descrizione per il CARTELLO {effectiveParentText(db, scope, activeParent, "descCartello", academyDb).custom && <span className="pill pill-orange">personalizzata</span>}
                    <textarea name="descCartello" rows={3} defaultValue={effectiveParentText(db, scope, activeParent, "descCartello", academyDb).value} />
                  </label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-sm" type="submit">
                      💾 Salva {scope.type === "system" ? "(versione Consorzio)" : `(personalizzazione ${scope.label})`}
                    </button>
                  </div>
                </form>
                {consortium && (
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <form action={rigeneraTestiAI.bind(null, activeParent.id, scopeParam)}>
                      <button className="btn btn-outline btn-sm" type="submit">✨ Rigenera testi con AI</button>
                    </form>
                    <form action={scioglieParent.bind(null, activeParent.id, scopeParam)}>
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

        {/* prodotti padre esistenti */}
        {db.parents.length > 0 && !activeParent && (
          <div className="card" style={{ marginBottom: 14, padding: 14 }}>
            <strong>📦 Prodotti padre ({db.parents.length})</strong>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {db.parents.map((p) => (
                <a key={p.id} className="pill pill-blue" href={`/stampe/zoo/dati?scope=${scopeParam}&padre=${p.id}`} style={{ textDecoration: "none" }}>
                  {effectiveParentText(db, scope, p, "nome", academyDb).value} ({db.products.filter((x) => x.parentId === p.id).length})
                </a>
              ))}
            </div>
          </div>
        )}

        {/* filtri */}
        <div className="card" style={{ marginBottom: 14, padding: 14 }}>
          <form method="get" style={{ display: "grid", gridTemplateColumns: "2fr 1.5fr 1.5fr auto auto auto", gap: 10, alignItems: "end" }}>
            <input type="hidden" name="scope" value={scopeParam} />
            <label className="field" style={{ marginBottom: 0 }}>Cerca<input type="text" name="q" defaultValue={sp.q ?? ""} placeholder="descrizione, EAN, codice" /></label>
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
            <label style={{ fontSize: 12.5 }}><input type="checkbox" name="senzapadre" value="1" defaultChecked={soloSenzaPadre} /> solo senza padre</label>
            {scope.type !== "system" && (
              <label style={{ fontSize: 12.5 }}><input type="checkbox" name="nascosti" value="1" defaultChecked={showHidden} /> mostra nascosti</label>
            )}
            <button className="btn btn-sm" type="submit">Filtra</button>
          </form>
        </div>

        {/* tabella articoli con selezione multipla → crea padre / associa con AI */}
        <form>
          <input type="hidden" name="scope" value={scopeParam} />
          {consortium && (
            <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <button className="btn btn-sm" formAction={createZooParent.bind(null, scopeParam)} type="submit">
                📦 Crea padre dagli articoli selezionati
              </button>
              <button className="btn btn-sm" formAction={associaConAI.bind(null, scopeParam)} type="submit" style={{ background: "#6d3fa7" }}>
                ✨ Associa con AI (raggruppa + genera testi)
              </button>
              <span className="hint">
                {db.settings.apiKey ? "chiave API Claude configurata" : "⚠️ nessuna chiave API: verrà usato il raggruppamento automatico con testi bozza"}
              </span>
            </div>
          )}
          <div className="card table-wrap">
            <table className="data">
              <thead>
                <tr>
                  {consortium && <th style={{ width: 30 }}></th>}
                  <th style={{ width: 56 }}>Foto</th>
                  <th>Descrizione</th>
                  <th>EAN / Codice</th>
                  <th>Marca · Fornitore</th>
                  <th>Padre</th>
                  {scope.type !== "system" && <th className="no-print">Visibilità</th>}
                </tr>
              </thead>
              <tbody>
                {products.length === 0 && <tr><td colSpan={7} className="empty">Nessun articolo: importa l&apos;Excel dei prodotti per iniziare.</td></tr>}
                {products.slice(0, 400).map((p) => {
                  const parent = db.parents.find((x) => x.id === p.parentId);
                  const hidden = scope.type !== "system" && isZooHidden(db, scope, p, academyDb);
                  return (
                    <tr key={p.id} style={hidden ? { opacity: 0.45 } : undefined}>
                      {consortium && <td><input type="checkbox" name="sel" value={p.id} /></td>}
                      <td>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={zooImageUrl(p)} alt="" style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 6, border: "1px solid #eee" }} />
                      </td>
                      <td>
                        <strong style={{ fontSize: 13 }}>{p.descrizione}</strong>
                        {p.prezzo && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>prezzo base € {p.prezzo}</div>}
                        {!p.image && availablePhotos.length > 0 && consortium && (
                          <details style={{ fontSize: 11.5, marginTop: 2 }}>
                            <summary style={{ cursor: "pointer", color: "#274b7a" }}>abbina una foto…</summary>
                            <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                              <select name="fileName" form={`ph_${p.id}`} style={{ fontSize: 11.5 }} defaultValue="">
                                <option value="" disabled>scegli file</option>
                                {availablePhotos.map((f) => <option key={f} value={f}>{f}</option>)}
                              </select>
                              <button className="btn btn-outline btn-sm" type="submit" form={`ph_${p.id}`}>OK</button>
                            </div>
                          </details>
                        )}
                      </td>
                      <td style={{ fontSize: 12 }}>{p.ean}<div style={{ color: "var(--muted)" }}>{p.codice}</div></td>
                      <td style={{ fontSize: 12.5 }}>{p.marca}<div style={{ color: "var(--muted)", fontSize: 11.5 }}>{p.fornitore}</div></td>
                      <td>
                        {parent ? (
                          <a className="pill pill-blue" href={`/stampe/zoo/dati?scope=${scopeParam}&padre=${parent.id}`} style={{ textDecoration: "none" }}>
                            {effectiveParentText(db, scope, parent, "nome", academyDb).value.slice(0, 26)}
                          </a>
                        ) : (
                          <span className="pill pill-gray">—</span>
                        )}
                      </td>
                      {scope.type !== "system" && (
                        <td className="no-print" style={{ whiteSpace: "nowrap" }}>
                          <button
                            className="btn btn-outline btn-sm" type="submit" title={hidden ? "Rendi di nuovo visibile" : "Nascondi questo articolo"}
                            formAction={toggleZooHidden.bind(null, scopeParam, "articolo", p.ean, "/stampe/zoo/dati")}
                          >
                            {hidden ? "👁 Mostra" : "🙈"}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </form>

        {/* form esterni (via attributo form=) per l'abbinamento manuale delle foto */}
        {consortium && products.slice(0, 400).filter((p) => !p.image).map((p) => (
          <form key={p.id} id={`ph_${p.id}`} action={associateZooPhoto.bind(null, scopeParam, p.id)} />
        ))}

        {/* fornitori/marchi nascosti per questo ambito */}
        {scope.type !== "system" && (
          <div className="card" style={{ marginTop: 14, padding: 14 }}>
            <strong>🙈 Fornitori e marchi non trattati da {scope.label}</strong>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 8px" }}>
              Clicca per nascondere/mostrare: gli articoli nascosti non compariranno nelle pagine di stampa di questo ambito.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {fornitoriList(db).map((f) => {
                const off = hiddenHere.some((h) => h.kind === "fornitore" && h.value === f);
                return (
                  <form key={`f_${f}`} action={toggleZooHidden.bind(null, scopeParam, "fornitore", f, "/stampe/zoo/dati")}>
                    <button type="submit" className={`pill ${off ? "pill-gray" : "pill-green"}`} style={{ cursor: "pointer", border: "none" }}>
                      {off ? "🙈 " : ""}Fornitore: {f}
                    </button>
                  </form>
                );
              })}
              {marcheList(db).map((m) => {
                const off = hiddenHere.some((h) => h.kind === "marca" && h.value === m);
                return (
                  <form key={`m_${m}`} action={toggleZooHidden.bind(null, scopeParam, "marca", m, "/stampe/zoo/dati")}>
                    <button type="submit" className={`pill ${off ? "pill-gray" : "pill-blue"}`} style={{ cursor: "pointer", border: "none" }}>
                      {off ? "🙈 " : ""}Marca: {m}
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
