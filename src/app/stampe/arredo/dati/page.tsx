import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import StampeHeader from "@/components/stampe/StampeHeader";
import Cartello from "@/components/stampe/Cartello";
import FieldEditor from "@/components/stampe/FieldEditor";
import ProductClipboard from "@/components/stampe/ProductClipboard";
import {
  getStampeDb,
  canAccessStampe,
  isConsortiumEditor,
  scopesForUser,
  resolveScope,
  effectiveValue,
  isFieldHidden,
  isStoreBlocked,
  effectiveLayout,
  filterProducts,
  productImageUrl,
  cartelloValues,
  fieldsForScope,
  backgroundFor,
  listValues,
  isImageField,
} from "@/lib/stampe";
import {
  toggleFieldHidden,
  reportFieldError,
  addPrintProduct,
  createColorVariant,
  updateProductMeta,
  copyFieldBroadcast,
  importProductsExcel,
} from "@/lib/stampe-actions";

export default async function DatiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessStampe(user)) redirect("/studente");
  const sp = await searchParams;

  const db = await getStampeDb();
  const academyDb = await getDb();
  const scopes = scopesForUser(user, academyDb);
  const scope = resolveScope(user, sp.scope, academyDb);
  const scopeParam = `${scope.type}:${scope.id}`;
  const consortium = isConsortiumEditor(user);
  const blocked = isStoreBlocked(db, scope);
  const canEdit = !blocked && (scope.type !== "system" || consortium);

  const filtered = filterProducts(db, sp);
  const raggruppa = sp.raggruppa === "1";
  const openIds = (sp.aperti ?? "").split(",").filter(Boolean).slice(0, 6);
  const activeId = sp.prodotto && openIds.includes(sp.prodotto) ? sp.prodotto : sp.prodotto ?? openIds[0] ?? filtered[0]?.id;
  const openList = [...new Set([...(activeId ? [activeId] : []), ...openIds])].slice(0, 6);
  const product = db.products.find((p) => p.id === activeId);

  const tipologie = listValues(db, "tipologie", scope, academyDb);
  const marche = listValues(db, "marche", scope, academyDb);
  const scopeFields = fieldsForScope(db, scope, academyDb);

  const formatId = sp.formato ?? db.formats[0]?.id;
  const format = db.formats.find((f) => f.id === formatId) ?? db.formats[0];
  const formatEff = { ...format, background: backgroundFor(db, format, scope, academyDb) };
  const layout = product ? effectiveLayout(db, scope, format.id, academyDb, product.tipologia) : undefined;
  const values = product ? cartelloValues(db, scope, product, academyDb) : {};
  const photo = product ? productImageUrl(product) : "";
  const photoMissing = photo === "/immagini/mancante.jpg";

  const qs = (extra: Record<string, string>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) params.set(k, v);
    return params.toString();
  };
  const openHref = (pid: string) => qs({ prodotto: pid, aperti: [...new Set([pid, ...openList])].slice(0, 6).join(",") });
  const closeHref = (pid: string) => {
    const rest = openList.filter((x) => x !== pid);
    return qs({ prodotto: rest[0] ?? "", aperti: rest.join(",") });
  };

  // raggruppamento varianti colore: prodotti con lo stesso titolo o collegati da variantOf
  const groups: { key: string; items: typeof filtered }[] = [];
  if (raggruppa) {
    const map = new Map<string, typeof filtered>();
    for (const p of filtered) {
      const key = (p.variantOf ?? p.fields.titolo ?? p.id).toLowerCase();
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    for (const [key, items] of map) groups.push({ key, items });
  }

  return (
    <div>
      <StampeHeader user={user} active="dati" />
      <div className="container">
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Dati prodotti — Arredo Giardino</h1>
            <p className="subtitle" style={{ margin: "4px 0 0" }}>
              {blocked
                ? "🔒 La tua insegna ha disabilitato la personalizzazione per questo punto vendita (sola lettura)."
                : consortium && scope.type === "system"
                  ? "Versione del Consorzio · salvataggio automatico attivo"
                  : `Personalizzazione di ${scope.label} · salvataggio automatico attivo`}
            </p>
          </div>
          <span className="pill pill-green no-print" title="I campi si salvano da soli mentre scrivi">💾 Salvataggio automatico</span>
          <form method="get" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {Object.entries(sp).map(([k, v]) => (k !== "scope" && v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
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

        {sp.importati !== undefined && (
          <div className="alert alert-green no-print">✓ Import Excel: {sp.importati} prodotti elaborati ({sp.nuovi ?? 0} nuovi).</div>
        )}
        {sp.copiati !== undefined && <div className="alert alert-green no-print">✓ Campo copiato su {sp.copiati} prodotti.</div>}
        {sp.segnalato && <div className="alert alert-green no-print">✓ Segnalazione inviata al responsabile contenuti del Consorzio.</div>}

        {/* filtro + strumenti excel */}
        <div className="card" style={{ marginBottom: 14, padding: 14 }}>
          <form method="get" style={{ display: "grid", gridTemplateColumns: "2fr 2fr 2fr 1fr auto auto", gap: 10, alignItems: "end" }}>
            <input type="hidden" name="scope" value={scopeParam} />
            <input type="hidden" name="aperti" value={openList.join(",")} />
            <label className="field" style={{ marginBottom: 0 }}>Cerca<input type="text" name="q" defaultValue={sp.q ?? ""} placeholder="titolo o codice" /></label>
            <label className="field" style={{ marginBottom: 0 }}>
              Tipologia
              <select name="tipologia" defaultValue={sp.tipologia ?? ""}>
                <option value="">Tutte</option>
                {tipologie.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              Marca / fornitore
              <select name="marca" defaultValue={sp.marca ?? ""}>
                <option value="">Tutte</option>
                {marche.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="field" style={{ marginBottom: 0 }}>Prezzo max €<input type="text" name="prezzoMax" defaultValue={sp.prezzoMax ?? ""} /></label>
            <label style={{ fontSize: 12, display: "flex", gap: 5, alignItems: "center", whiteSpace: "nowrap", marginBottom: 10 }}>
              <input type="checkbox" name="raggruppa" value="1" defaultChecked={raggruppa} /> Raggruppa varianti colore
            </label>
            <button className="btn btn-sm" type="submit">🔍 Filtra</button>
          </form>
          {consortium && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
              <strong style={{ fontSize: 12.5 }}>Excel:</strong>
              <a className="btn btn-outline btn-sm" href={`/stampe/arredo/excel?${qs({})}`}>⬇ Esporta i {filtered.length} filtrati</a>
              <a className="btn btn-outline btn-sm" href="/stampe/arredo/excel?template=1">⬇ Scarica modello di esempio</a>
              <form action={importProductsExcel.bind(null, scopeParam)} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="file" name="file" accept=".xlsx,.xls" required style={{ marginTop: 0, fontSize: 12, maxWidth: 220 }} />
                <button className="btn btn-sm" type="submit">⬆ Importa Excel</button>
              </form>
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr 300px", gap: 16, alignItems: "start" }}>
          {/* elenco prodotti */}
          <div className="card" style={{ padding: 8, maxHeight: 700, overflowY: "auto" }}>
            <div style={{ padding: "4px 10px", fontSize: 12.5, color: "var(--muted)", fontWeight: 700 }}>
              {filtered.length} prodotti{filtered.length > 120 ? " (primi 120 — usa i filtri)" : ""}
            </div>
            {!raggruppa &&
              filtered.slice(0, 120).map((p) => (
                <a key={p.id} className={`prod-item ${activeId === p.id ? "active" : ""}`} href={`?${openHref(p.id)}`}>
                  {p.fields.titolo}
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{p.codice} · {p.tipologia}</div>
                </a>
              ))}
            {raggruppa &&
              groups.slice(0, 80).map((g) => (
                <div key={g.key} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 4, marginBottom: 4 }}>
                  <div style={{ padding: "6px 10px 2px", fontWeight: 700, fontSize: 13 }}>
                    {g.items[0].fields.titolo}
                    {g.items.length > 1 && <span className="pill pill-blue" style={{ marginLeft: 6 }}>{g.items.length} varianti</span>}
                  </div>
                  {g.items.map((p) => (
                    <a key={p.id} className={`prod-item ${activeId === p.id ? "active" : ""}`} href={`?${openHref(p.id)}`} style={{ borderBottom: "none", paddingLeft: 22 }}>
                      <span style={{ fontSize: 12 }}>🎨 {p.fields.colori?.split("  ")[0] || "—"}</span>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>{p.codice}</div>
                    </a>
                  ))}
                </div>
              ))}
            {consortium && (
              <details style={{ padding: 10 }}>
                <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13 }}>➕ Nuovo prodotto</summary>
                <form action={addPrintProduct.bind(null, scopeParam)} style={{ marginTop: 8 }}>
                  <label className="field">Titolo<input type="text" name="titolo" required /></label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <label className="field">Codice fornitore<input type="text" name="codice" /></label>
                    <label className="field">EAN<input type="text" name="ean" /></label>
                  </div>
                  <label className="field">
                    Tipologia
                    <select name="tipologia">{tipologie.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                  </label>
                  <label className="field">Marca<input type="text" name="marca" list="dl-marche" /></label>
                  <label className="field">
                    Copia i dati da… (cerca per codice)
                    <input type="text" name="copyFrom" list="dl-prodotti" placeholder="digita per cercare" />
                  </label>
                  <datalist id="dl-prodotti">
                    {db.products.slice(0, 400).map((p) => (
                      <option key={p.id} value={p.codice}>{p.fields.titolo}</option>
                    ))}
                  </datalist>
                  <datalist id="dl-marche">
                    {marche.map((m) => <option key={m} value={m} />)}
                  </datalist>
                  <button className="btn btn-sm" type="submit">Crea prodotto</button>
                </form>
              </details>
            )}
          </div>

          {/* scheda prodotto con tab */}
          <div>
            {openList.length > 0 && (
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                {openList.map((pid) => {
                  const p = db.products.find((x) => x.id === pid);
                  if (!p) return null;
                  const isActive = pid === activeId;
                  return (
                    <span key={pid} className={`tab-chip ${isActive ? "active" : ""}`}>
                      <a href={`?${qs({ prodotto: pid, aperti: openList.join(",") })}`} style={{ color: "inherit" }}>
                        {(p.fields.titolo ?? "").slice(0, 22)}{(p.fields.titolo ?? "").length > 22 ? "…" : ""}
                      </a>
                      <a href={`?${closeHref(pid)}`} title="Chiudi scheda" style={{ color: "inherit", opacity: 0.6 }}>✕</a>
                    </span>
                  );
                })}
              </div>
            )}

            {!product && <div className="card"><p className="empty">Nessun prodotto trovato con questi filtri.</p></div>}
            {product && (
              <div className="card">
                <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 10, flexWrap: "wrap" }}>
                  <div style={{ width: 130, display: "flex", flexDirection: "column", gap: 4 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo}
                      alt={product.fields.titolo}
                      style={{ width: 130, height: 95, objectFit: "contain", background: "#fff", border: "1px solid var(--line)", borderRadius: 10 }}
                    />
                    {db.settings.sharepointImagesUrl && (
                      <a href={db.settings.sharepointImagesUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, textAlign: "center" }}>
                        ☁️ Apri cartella SharePoint
                      </a>
                    )}
                    <span style={{ fontSize: 10, color: "var(--muted)", textAlign: "center" }}>
                      {photoMissing ? `Foto non trovata (${product.codice})` : "Foto automatica"}
                    </span>
                  </div>
                  <div style={{ flex: 1, minWidth: 260 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <h2 style={{ margin: 0, flex: 1 }}>{product.fields.titolo}</h2>
                      <ProductClipboard productId={product.id} scopeParam={scopeParam} fields={product.fields} canEdit={canEdit} />
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                      <span className="pill pill-blue">{product.tipologia}</span>
                      <span className="pill pill-gray">{product.marca}</span>
                      <span className="pill pill-gray">Cod. {product.codice}</span>
                      {product.ean && <span className="pill pill-gray">EAN {product.ean}</span>}
                      {product.variantOf && <span className="pill pill-amber">Variante colore</span>}
                    </div>
                    {consortium && (
                      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        <details>
                          <summary className="btn btn-outline btn-sm" style={{ display: "inline-block", cursor: "pointer" }}>🎨 Crea variante colore</summary>
                          <form action={createColorVariant.bind(null, product.id, scopeParam)} style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                            <input type="text" name="codice" required placeholder="Nuovo codice fornitore" style={{ marginTop: 0, width: 160 }} />
                            <input type="text" name="ean" placeholder="EAN" style={{ marginTop: 0, width: 130 }} />
                            <input type="text" name="colore" placeholder="Colore (es. Tortora)" list="dl-colori" style={{ marginTop: 0, width: 140 }} />
                            <datalist id="dl-colori">
                              {listValues(db, "colori", scope, academyDb).map((c) => <option key={c} value={c} />)}
                            </datalist>
                            <button className="btn btn-sm" type="submit">Crea</button>
                          </form>
                        </details>
                        <details>
                          <summary className="btn btn-outline btn-sm" style={{ display: "inline-block", cursor: "pointer" }}>✏️ Anagrafica</summary>
                          <form action={updateProductMeta.bind(null, product.id, scopeParam)} style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                            <input type="text" name="ean" defaultValue={product.ean} placeholder="EAN" style={{ marginTop: 0, width: 140 }} />
                            <select name="tipologia" defaultValue={product.tipologia} style={{ marginTop: 0 }}>
                              {tipologie.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <input type="text" name="marca" defaultValue={product.marca} list="dl-marche" style={{ marginTop: 0, width: 130 }} />
                            <button className="btn btn-sm" type="submit">Salva</button>
                          </form>
                        </details>
                      </div>
                    )}
                  </div>
                </div>

                {scopeFields
                  .filter((f) => !["foto", "logoAzienda", "logoInsegna", "codice"].includes(f.id))
                  .map((f) => {
                    const hidden = isFieldHidden(db, scope, f.id, academyDb);
                    const eff = effectiveValue(db, scope, product, f.id, academyDb);
                    const base = product.fields[f.id] ?? "";
                    const toggle = toggleFieldHidden.bind(null, f.id, scopeParam, product.id);
                    const report = reportFieldError.bind(null, product.id, f.id, scopeParam);
                    return (
                      <div key={f.id} style={{ borderTop: "1px solid var(--line)", padding: "8px 0", opacity: hidden ? 0.5 : 1 }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                          <strong style={{ fontSize: 13, flex: 1 }}>
                            {f.label}
                            {f.scopeType && <span className="pill pill-amber" style={{ marginLeft: 6 }}>campo {f.scopeType === "store" ? "PV" : "insegna"}</span>}
                          </strong>
                          {scope.type !== "system" && (
                            eff.custom
                              ? <span className="field-version fv-custom">✏️ personalizzata</span>
                              : <span className="field-version fv-consorzio">🏛️ Consorzio</span>
                          )}
                          {consortium && scope.type === "system" && (
                            <details className="flag-details">
                              <summary title="Copia questo campo su altri prodotti">⤢</summary>
                              <div className="flag-popover">
                                <form action={copyFieldBroadcast.bind(null, product.id, f.id, scopeParam, "tipologia")}>
                                  <button className="btn btn-outline btn-sm" type="submit" style={{ width: "100%" }}>→ Su tutta la tipologia «{product.tipologia}»</button>
                                </form>
                                <form action={copyFieldBroadcast.bind(null, product.id, f.id, scopeParam, "tutti")}>
                                  <button className="btn btn-outline btn-sm" type="submit" style={{ width: "100%" }}>→ Su TUTTI i prodotti</button>
                                </form>
                              </div>
                            </details>
                          )}
                          {canEdit && (
                            <form action={toggle}>
                              <button className="mini-btn" type="submit" title={hidden ? "Mostra il campo" : "Nascondi il campo per questo ambito"}>
                                {hidden ? "👁" : "🙈"}
                              </button>
                            </form>
                          )}
                          {!consortium && (
                            <details className="flag-details">
                              <summary title="Segnala un errore al Consorzio">🚩</summary>
                              <form action={report} className="flag-popover">
                                <input type="text" name="message" required placeholder="Descrivi l'errore trovato in questo campo" />
                                <button className="btn btn-sm" type="submit">Invia al Consorzio</button>
                              </form>
                            </details>
                          )}
                        </div>
                        <FieldEditor
                          productId={product.id}
                          fieldId={f.id}
                          scopeParam={scopeParam}
                          initialValue={eff.value}
                          initialCustom={eff.custom}
                          showVersionBadge={scope.type !== "system"}
                          canEdit={canEdit}
                          isImage={isImageField(f, f.id)}
                        />
                        {eff.custom && (
                          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>
                            🏛️ Consorzio: “{base || "—"}”
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* anteprima */}
          <div className="no-print">
            <div className="card" style={{ padding: 12, marginBottom: 12 }}>
              <form method="get" style={{ display: "flex", gap: 8, alignItems: "end" }}>
                {Object.entries(sp).map(([k, v]) => (k !== "formato" && v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
                <label className="field" style={{ marginBottom: 0, flex: 1 }}>
                  Formato anteprima
                  <select name="formato" defaultValue={format.id}>
                    {db.formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </label>
                <button className="btn btn-sm" type="submit">OK</button>
              </form>
            </div>
            {product && (
              <Cartello format={formatEff} layout={layout} fields={db.fields} values={values} scale={format.w > 150 ? 1.3 : 2} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
