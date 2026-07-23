import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import StampeHeader from "@/components/stampe/StampeHeader";
import LayoutEditor from "@/components/stampe/LayoutEditor";
import {
  getStampeDb,
  canAccessStampe,
  isConsortiumEditor,
  scopesForUser,
  resolveScope,
  cartelloValues,
  backgroundFor,
  isStoreBlocked,
} from "@/lib/stampe";
import { deleteLayout, uploadScopedBackground, removeScopedBackground, uploadLayoutImage } from "@/lib/stampe-actions";

export default async function LayoutPage({
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

  const formatId = sp.formato ?? db.formats[0]?.id;
  const format = db.formats.find((f) => f.id === formatId) ?? db.formats[0];
  const tipologie = [...new Set(db.products.map((p) => p.tipologia))].sort();

  // layout dell'ambito corrente, altrimenti si parte dal layout del Consorzio come base
  const own = db.layouts.find(
    (l) => l.formatId === format.id && l.scopeType === scope.type && l.scopeId === scope.id && l.tipologie.length === 0
  );
  const systemLayout = db.layouts.find((l) => l.formatId === format.id && l.scopeType === "system" && l.tipologie.length === 0);
  const current = own ?? systemLayout;

  // prodotto di esempio per l'anteprima
  const sample = db.products[0];
  const sampleValues: Record<string, string> = sample ? cartelloValues(db, scope, sample, academyDb) : {};

  const otherLayouts = db.layouts.filter(
    (l) => l.scopeType === scope.type && l.scopeId === scope.id
  );

  return (
    <div>
      <StampeHeader user={user} active="layout" />
      <div className="container">
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Layout cartelli</h1>
            <p className="subtitle" style={{ margin: "4px 0 0" }}>
              {canEdit
                ? scope.type === "system"
                  ? "Stai modificando il layout del Consorzio (comune a tutti)."
                  : `Stai personalizzando il layout di ${scope.label} — parte da quello del Consorzio.`
                : "Layout del Consorzio in sola lettura."}
            </p>
          </div>
          <form method="get" style={{ display: "flex", gap: 8, alignItems: "end" }}>
            <label className="field" style={{ marginBottom: 0 }}>
              Formato
              <select name="formato" defaultValue={format.id}>
                {db.formats.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.w}×{f.h} mm)</option>)}
              </select>
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              Insegna / PV
              <select name="scope" defaultValue={scopeParam}>
                {scopes.map((s) => <option key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>{s.label}</option>)}
              </select>
            </label>
            <button className="btn btn-sm" type="submit">OK</button>
          </form>
        </div>

        {!own && scope.type !== "system" && (
          <div className="alert alert-amber no-print">
            Stai vedendo il layout del Consorzio: qualsiasi modifica salvata creerà la versione personalizzata di {scope.label}.
          </div>
        )}

        <LayoutEditor
          key={`${format.id}_${scopeParam}_${current?.id ?? "new"}`}
          format={{ ...format, background: backgroundFor(db, format, scope, academyDb) }}
          fields={db.fields}
          initialItems={current?.items ?? []}
          scopeParam={scopeParam}
          initialTipologie={own?.tipologie ?? []}
          tipologieDisponibili={tipologie}
          sampleValues={sampleValues}
          canEdit={canEdit}
          images={db.layoutImages
            .filter((li) => li.scopeType === scope.type && li.scopeId === scope.id)
            .map((li) => ({ name: li.name, url: li.url }))}
        />

        {canEdit && (
          <div className="section grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>🖼️ Sfondo personalizzato per «{format.name}»</h3>
              <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 8px" }}>
                {scope.type === "system"
                  ? "Sostituisce lo sfondo del Consorzio per questo formato."
                  : `Vale solo per ${scope.label}: dimensioni e proporzioni del formato restano invariate (${format.w}×${format.h} mm).`}
              </p>
              <form action={uploadScopedBackground.bind(null, format.id, scopeParam)} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input type="file" name="background" accept="image/*" required style={{ marginTop: 0, fontSize: 12, flex: 1, minWidth: 180 }} />
                <button className="btn btn-sm" type="submit">⬆ Carica sfondo</button>
              </form>
              {scope.type !== "system" && db.scopedBackgrounds.some((b) => b.formatId === format.id && b.scopeType === scope.type && b.scopeId === scope.id) && (
                <form action={removeScopedBackground.bind(null, format.id, scopeParam)} style={{ marginTop: 8 }}>
                  <button className="btn btn-outline btn-sm" type="submit">↺ Torna allo sfondo del Consorzio</button>
                </form>
              )}
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>🏷️ I tuoi loghi e immagini</h3>
              <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 8px" }}>
                Caricali qui e poi trascinali sul cartello dal pannello &quot;Le tue immagini&quot;.
              </p>
              <form action={uploadLayoutImage.bind(null, scopeParam)} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input type="hidden" name="formatId" value={format.id} />
                <input type="text" name="name" placeholder="Nome (es. Logo negozio)" style={{ marginTop: 0, width: 160 }} />
                <input type="file" name="image" accept="image/*" required style={{ marginTop: 0, fontSize: 12, flex: 1, minWidth: 160 }} />
                <button className="btn btn-sm" type="submit">⬆ Carica immagine</button>
              </form>
            </div>
          </div>
        )}

        {otherLayouts.length > 0 && (
          <div className="section">
            <div className="section-head"><h2>Layout salvati in questo ambito</h2></div>
            <div className="card table-wrap">
              <table className="data">
                <thead><tr><th>Formato</th><th>Tipologie collegate</th><th>Campi</th><th></th></tr></thead>
                <tbody>
                  {otherLayouts.map((l) => {
                    const f = db.formats.find((x) => x.id === l.formatId);
                    return (
                      <tr key={l.id}>
                        <td><a href={`?formato=${l.formatId}&scope=${scopeParam}`}>{f?.name}</a></td>
                        <td style={{ fontSize: 13 }}>{l.tipologie.length ? l.tipologie.join(", ") : "Tutte"}</td>
                        <td>{l.items.length}</td>
                        <td>
                          <form action={deleteLayout.bind(null, l.id, scopeParam)}>
                            <button className="btn btn-outline btn-sm" type="submit" style={{ color: "var(--red)", borderColor: "var(--red)" }}>🗑</button>
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
      </div>
    </div>
  );
}
