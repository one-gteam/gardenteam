import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import StampeHeader from "@/components/stampe/StampeHeader";
import { getStampeDb, canAccessStampe, isConsortiumEditor, scopesForUser, resolveScope, isStoreBlocked } from "@/lib/stampe";
import {
  saveFormat,
  deleteFormat,
  addField,
  deleteField,
  saveStampeSettings,
  addScopedField,
  deleteScopedField,
  addListValue,
  removeListValue,
  toggleStoreBlock,
  importInternalCodes,
} from "@/lib/stampe-actions";

export default async function ImpostazioniPage({
  searchParams,
}: {
  searchParams: Promise<{ salvato?: string; scope?: string; codici?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessStampe(user)) redirect("/stampe");
  if (!["system_admin", "course_manager", "group_admin", "store_admin"].includes(user.role)) redirect("/stampe");
  const { salvato, scope: scopeQ, codici } = await searchParams;

  const db = await getStampeDb();
  const academy = await getDb();
  const consortium = isConsortiumEditor(user);
  const scopes = scopesForUser(user, academy);
  const scope = resolveScope(user, scopeQ, academy);
  const scopeParam = `${scope.type}:${scope.id}`;
  const blocked = isStoreBlocked(db, scope);

  const myFields = db.fields.filter((f) =>
    scope.type === "system" ? f.custom && !f.scopeType : f.scopeType === scope.type && f.scopeId === scope.id
  );
  const myListValues = (key: "marche" | "tipologie" | "colori") =>
    db.lists[key].filter((v) =>
      scope.type === "system" ? !v.scopeType : v.scopeType === scope.type && v.scopeId === scope.id
    );
  const myStores = user.role === "group_admin" ? academy.stores.filter((s) => s.tenantId === user.tenantId) : [];

  return (
    <div>
      <StampeHeader user={user} active="impostazioni" />
      <div className="container">
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Impostazioni Stampe</h1>
            <p className="subtitle" style={{ margin: "4px 0 0" }}>
              {consortium
                ? "Impostazioni del Consorzio + personalizzazioni per ambito. Utenti e ruoli si gestiscono dalla pagina Utenti (gestione comune)."
                : `Personalizzazioni di ${scope.label}.`}
            </p>
          </div>
          {scopes.length > 1 && (
            <form method="get" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ fontSize: 12.5, fontWeight: 700 }}>
                Ambito{" "}
                <select name="scope" defaultValue={scopeParam} style={{ marginTop: 2 }}>
                  {scopes.map((s) => (
                    <option key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>{s.label}</option>
                  ))}
                </select>
              </label>
              <button className="btn btn-sm" type="submit">OK</button>
            </form>
          )}
        </div>

        {salvato && <div className="alert alert-green">✓ Salvato.</div>}
        {codici !== undefined && (
          <div className={`alert ${Number(codici) > 0 ? "alert-green" : "alert-amber"}`}>
            {Number(codici) > 0
              ? `✓ Associati ${codici} codici interni ai prodotti.`
              : "Nessun codice associato: controlla che il file abbia le colonne CODICE FORNITORE e CODICE INTERNO compilate."}
          </div>
        )}
        {blocked && (
          <div className="alert alert-amber">🔒 La tua insegna ha disabilitato la personalizzazione per questo punto vendita.</div>
        )}

        {/* ---------- Catalogo e codici interni ---------- */}
        <div className="section-head"><h2>📦 Catalogo e codici interni</h2></div>
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <a className="btn btn-outline btn-sm" href="/stampe/arredo/excel?catalogo=1">
              ⬇ Scarica il catalogo completo (Excel)
            </a>
            {scope.type !== "system" && (
              <a className="btn btn-outline btn-sm" href={`/stampe/arredo/excel?associa=1&scope=${encodeURIComponent(scopeParam)}`}>
                ⬇ Scarica modello associazione codici
              </a>
            )}
          </div>
          {scope.type !== "system" && (
            <>
              <p style={{ fontSize: 13, color: "var(--muted)", margin: "12px 0 8px" }}>
                <strong>Associa i tuoi codici interni:</strong> scarica il modello (tutti i codici fornitore in colonna,
                con l&apos;eventuale codice già associato), compila la colonna <code>CODICE INTERNO</code> e ricaricalo qui.
                Il codice interno compare poi sui cartelli di {scope.label}.
              </p>
              {!blocked && (
                <form action={importInternalCodes.bind(null, scopeParam)} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input type="file" name="file" accept=".xlsx,.xls" required style={{ marginTop: 0, fontSize: 12, flex: 1, minWidth: 200 }} />
                  <button className="btn btn-sm" type="submit">⬆ Carica e associa</button>
                </form>
              )}
            </>
          )}
        </div>

        {/* ---------- Campi personalizzati dell'ambito ---------- */}
        <div className="section-head"><h2>🏷️ Campi personalizzati di {scope.label} ({myFields.length})</h2></div>
        <div className="card" style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
            I campi aggiunti qui compaiono nella scheda di <strong>tutti i prodotti</strong> (per questo ambito) e
            nell&apos;editor Layout. Un campo può anche essere un&apos;immagine (si inserisce l&apos;URL o il percorso del file).
          </p>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Campo</th><th>Tipo</th><th></th></tr></thead>
              <tbody>
                {myFields.length === 0 && <tr><td colSpan={3} className="empty">Nessun campo personalizzato in questo ambito.</td></tr>}
                {myFields.map((f) => (
                  <tr key={f.id}>
                    <td><strong>{f.label}</strong></td>
                    <td>{f.type === "image" ? <span className="pill pill-blue">🖼 Immagine</span> : <span className="pill pill-gray">Testo</span>}</td>
                    <td>
                      {!blocked && (
                        <form action={deleteScopedField.bind(null, f.id, scopeParam)}>
                          <button className="btn btn-outline btn-sm" type="submit" style={{ color: "var(--red)", borderColor: "var(--red)" }}>🗑</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!blocked && (
            <form action={addScopedField.bind(null, scopeParam)} style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <input type="text" name="label" required placeholder="Nome del nuovo campo (es. Garanzia, Bollino eco)" style={{ marginTop: 0, flex: 1, minWidth: 200 }} />
              <select name="type" defaultValue="text" style={{ marginTop: 0 }}>
                <option value="text">Testo</option>
                <option value="image">Immagine</option>
              </select>
              <button className="btn btn-sm" type="submit">➕ Aggiungi campo</button>
            </form>
          )}
        </div>

        {/* ---------- Liste: marchi, tipologie, colori ---------- */}
        <div className="section-head"><h2>📚 Marchi, tipologie e colori di {scope.label}</h2></div>
        <div className="grid grid-3" style={{ marginBottom: 24 }}>
          {(["marche", "tipologie", "colori"] as const).map((key) => (
            <div className="card" key={key}>
              <h3 style={{ marginTop: 0, textTransform: "capitalize" }}>{key === "marche" ? "Marchi" : key}</h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {myListValues(key).length === 0 && <span className="empty">Nessuna aggiunta.</span>}
                {myListValues(key).map((v) => (
                  <span key={v.value} className="pill pill-green" style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                    {v.value}
                    {!blocked && (
                      <form action={removeListValue.bind(null, key, v.value, scopeParam)} style={{ display: "inline" }}>
                        <button type="submit" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 11 }}>✕</button>
                      </form>
                    )}
                  </span>
                ))}
              </div>
              {!blocked && (
                <form action={addListValue.bind(null, key, scopeParam)} style={{ display: "flex", gap: 6 }}>
                  <input type="text" name="value" required placeholder="Nuovo valore" style={{ marginTop: 0, flex: 1 }} />
                  <button className="btn btn-sm" type="submit">➕</button>
                </form>
              )}
            </div>
          ))}
        </div>

        {/* ---------- Permessi PV (responsabile insegna) ---------- */}
        {user.role === "group_admin" && myStores.length > 0 && (
          <>
            <div className="section-head"><h2>🔐 Personalizzazione dei punti vendita</h2></div>
            <div className="card" style={{ marginBottom: 24 }}>
              <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
                Decidi quali tuoi punti vendita possono personalizzare dati, layout e cartelli. Se disabilitato,
                il PV usa solo le versioni dell&apos;insegna/Consorzio.
              </p>
              <table className="data">
                <tbody>
                  {myStores.map((s) => {
                    const isBlocked = (db.settings.blockedStores ?? []).includes(s.id);
                    return (
                      <tr key={s.id}>
                        <td><strong>{s.name}</strong></td>
                        <td>{isBlocked ? <span className="pill pill-red">Personalizzazione disabilitata</span> : <span className="pill pill-green">Può personalizzare</span>}</td>
                        <td>
                          <form action={toggleStoreBlock.bind(null, s.id, scopeParam)}>
                            <button className="btn btn-outline btn-sm" type="submit">
                              {isBlocked ? "🔓 Consenti" : "🔒 Disabilita"}
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {consortium && (<>

        <div className="section-head"><h2>☁️ Collegamento SharePoint</h2></div>
        <div className="card" style={{ maxWidth: 720, marginBottom: 28 }}>
          <p style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 0 }}>
            Le foto dei prodotti restano su SharePoint e vengono collegate tramite il{" "}
            <strong>codice articolo fornitore</strong>. Incolla qui il link della cartella immagini:
            comparirà il pulsante &quot;Apri foto su SharePoint&quot; nella pagina Dati prodotti.
          </p>
          <form action={saveStampeSettings}>
            <label className="field">
              🖼️ Link cartella immagini SharePoint
              <input type="text" name="sharepointImagesUrl" defaultValue={db.settings.sharepointImagesUrl ?? ""} placeholder="https://…sharepoint.com/…/immagini/foto prodotti" />
            </label>
            <label className="field">
              📊 Link file Excel di origine (opzionale)
              <input type="text" name="sharepointExcelUrl" defaultValue={db.settings.sharepointExcelUrl ?? ""} placeholder="https://…sharepoint.com/…/2026_GARDEN TEAM.xlsx" />
            </label>
            <label className="field">
              Note per gli operatori (opzionale)
              <textarea name="note" rows={2} defaultValue={db.settings.note ?? ""} placeholder="es. Nominare le foto con il codice articolo fornitore" />
            </label>
            <button className="btn btn-sm" type="submit">💾 Salva collegamento</button>
          </form>
        </div>

        <div className="section-head"><h2>📐 Formati cartelli ({db.formats.length})</h2></div>
        <div className="grid grid-3">
          {db.formats.map((f) => (
            <div className="card" key={f.id}>
              <form action={saveFormat.bind(null, f.id)}>
                <label className="field">Nome<input type="text" name="name" defaultValue={f.name} required /></label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label className="field">Larghezza (mm)<input type="text" name="w" defaultValue={String(f.w)} /></label>
                  <label className="field">Altezza (mm)<input type="text" name="h" defaultValue={String(f.h)} /></label>
                </div>
                <label className="field">
                  Sfondo cartello (immagine PNG/JPG/SVG)
                  <input type="file" name="background" accept="image/*,.pdf" style={{ marginTop: 4 }} />
                </label>
                {f.background && (
                  <div style={{ marginBottom: 8 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.background} alt="Sfondo" style={{ maxWidth: 140, maxHeight: 80, borderRadius: 6, border: "1px solid var(--line)" }} />
                    <label className="checkbox-row" style={{ margin: "6px 0 0" }}>
                      <input type="checkbox" name="removeBackground" /> Rimuovi sfondo
                    </label>
                  </div>
                )}
                <button className="btn btn-sm" type="submit">💾 Salva formato</button>
              </form>
              <form action={deleteFormat.bind(null, f.id)} style={{ marginTop: 8 }}>
                <button className="btn btn-outline btn-sm" type="submit" style={{ color: "var(--red)", borderColor: "var(--red)" }}>🗑 Elimina</button>
              </form>
            </div>
          ))}
          <div className="card" style={{ background: "var(--green-50)" }}>
            <h3 style={{ marginTop: 0 }}>➕ Nuovo formato</h3>
            <form action={saveFormat.bind(null, null)}>
              <label className="field">Nome<input type="text" name="name" required placeholder="es. A3 orizzontale" /></label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label className="field">Larghezza (mm)<input type="text" name="w" defaultValue="420" /></label>
                <label className="field">Altezza (mm)<input type="text" name="h" defaultValue="297" /></label>
              </div>
              <label className="field">
                Sfondo (opzionale)
                <input type="file" name="background" accept="image/*,.pdf" style={{ marginTop: 4 }} />
              </label>
              <button className="btn btn-sm" type="submit">Crea formato</button>
            </form>
          </div>
        </div>

        <div className="section">
          <div className="section-head">
            <h2>🏷️ Campi disponibili ({db.fields.length})</h2>
            <span className="hint">i nuovi campi compaiono nella pagina Dati e nell&apos;editor Layout</span>
          </div>
          <div className="card table-wrap">
            <table className="data">
              <thead><tr><th>Campo</th><th>Origine</th><th></th></tr></thead>
              <tbody>
                {db.fields.map((f) => (
                  <tr key={f.id}>
                    <td><strong>{f.label}</strong></td>
                    <td>{f.custom ? <span className="pill pill-amber">Aggiunto</span> : <span className="pill pill-blue">Excel Garden Team</span>}</td>
                    <td>
                      {f.custom && (
                        <form action={deleteField.bind(null, f.id)}>
                          <button className="btn btn-outline btn-sm" type="submit" style={{ color: "var(--red)", borderColor: "var(--red)" }}>🗑</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <form action={addField} style={{ display: "flex", gap: 10, marginTop: 12, maxWidth: 420 }}>
              <input type="text" name="label" required placeholder="Nome del nuovo campo (es. Garanzia)" style={{ flex: 1, marginTop: 0 }} />
              <button className="btn btn-sm" type="submit">➕ Aggiungi campo</button>
            </form>
          </div>
        </div>
        </>)}
      </div>
    </div>
  );
}
