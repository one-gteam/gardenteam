import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import StampeHeader from "@/components/stampe/StampeHeader";
import LayoutEditor from "@/components/stampe/LayoutEditor";
import AutoSubmitSelect from "@/components/stampe/AutoSubmitSelect";
import { canAccessArea, isZooEditor, scopesForUser, resolveScope } from "@/lib/stampe";
import {
  getZooDb, activeCampaign, zooCartelloValues, ZOO_FIELDS, ZOO_FORMATS,
} from "@/lib/zoo";
import { deleteZooLayout } from "@/lib/zoo-actions";

/** Layout dei cartelli Offerte Zoo: stessa meccanica dell'Arredo, campi delle offerte. */
export default async function ZooLayoutPage({
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
  const canEdit = scope.type !== "system" || isZooEditor(user);

  const format = ZOO_FORMATS.find((f) => f.id === sp.formato) ?? ZOO_FORMATS[0];
  const tipologieDisponibili = [...db.settings.categorieAnimali, ...db.settings.caratteristicheProdotto];

  // layout selezionabili per questo formato: i propri, più quelli del Consorzio come base
  const scopeLayouts = db.zooLayouts.filter((l) => l.formatId === format.id && l.scopeType === scope.type && l.scopeId === scope.id);
  const systemLayouts = db.zooLayouts.filter((l) => l.formatId === format.id && l.scopeType === "system");
  const selectableLayouts = scope.type === "system" ? scopeLayouts : [...scopeLayouts, ...systemLayouts];
  /*
   * ?layout="" = "nuovo layout" scelto apposta, resta vuoto. Un id che non è tra i layout di
   * QUESTO formato (tipico se si è appena cambiato formato: la tendina "Layout" porta ancora il
   * valore di quello precedente) si ignora e si torna al primo disponibile, invece di sembrare
   * "nuovo layout" per sbaglio.
   */
  const matchedByParam = sp.layout ? selectableLayouts.find((l) => l.id === sp.layout) : undefined;
  const current = matchedByParam ?? (sp.layout === "" ? undefined : (scopeLayouts[0] ?? systemLayouts[0]));
  const isOwnCopy = !!current && current.scopeType === scope.type && current.scopeId === scope.id;

  // offerta di esempio per l'anteprima: preferisce un padre con i tag di questo layout
  const campaign = activeCampaign(db);
  const offers = campaign ? db.offers.filter((o) => o.campaignId === campaign.id) : db.offers;
  const layoutTags = current?.tipologie ?? [];
  const sample = layoutTags.length > 0
    ? offers.find((o) => {
        const product = db.products.find((p) => p.id === o.productId);
        const parent = product?.parentId ? db.parents.find((x) => x.id === product.parentId) : undefined;
        return parent?.caratteristiche.some((c) => layoutTags.includes(c));
      }) ?? offers[0]
    : offers[0];
  const sampleValues = sample ? zooCartelloValues(db, sample, scope, academyDb) : {};

  const layoutOptions = [
    { value: "", label: "+ Nuovo layout" },
    ...selectableLayouts.map((l) => ({
      value: l.id,
      label: (l.nome || (l.tipologie.length ? l.tipologie.join(", ") : "Senza nome"))
        + (l.scopeType === "system" && scope.type !== "system" ? " (Consorzio)" : ""),
    })),
  ];

  return (
    <div>
      <StampeHeader user={user} active="layout" area="zoo" />
      <div className="container">
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Layout cartelli Zoo</h1>
            <p className="subtitle" style={{ margin: "4px 0 0" }}>
              {canEdit
                ? scope.type === "system"
                  ? "Stai modificando il layout del Consorzio (comune a tutti)."
                  : `Stai personalizzando il layout di ${scope.label} — parte da quello del Consorzio.`
                : "Layout del Consorzio in sola lettura."}
              {" "}Puoi avere più layout per lo stesso formato: scegli o creane uno qui sotto, e duplicalo dal pannello
              a destra per farne una variante.
            </p>
          </div>
          <form method="get" style={{ display: "flex", gap: 8, alignItems: "end" }}>
            <label className="field" style={{ marginBottom: 0 }}>
              Formato
              <AutoSubmitSelect name="formato" defaultValue={format.id}
                options={ZOO_FORMATS.map((f) => ({ value: f.id, label: `${f.name} (${f.w}×${f.h} mm)` }))} />
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              Layout
              <AutoSubmitSelect name="layout" defaultValue={current?.id ?? ""} options={layoutOptions} />
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

        {!isOwnCopy && scope.type !== "system" && (
          <div className="alert alert-amber no-print">
            Stai vedendo il layout del Consorzio: qualsiasi modifica salvata creerà la versione personalizzata di {scope.label}.
          </div>
        )}

        <LayoutEditor
          key={`${format.id}_${scopeParam}_${current?.id ?? "new"}`}
          format={format}
          fields={ZOO_FIELDS}
          initialLayoutId={isOwnCopy ? current?.id : undefined}
          initialNome={current?.nome}
          initialItems={current?.items ?? []}
          initialItemsNoPhoto={current?.itemsNoPhoto}
          initialMargin={current?.margin}
          scopeParam={scopeParam}
          initialTipologie={current?.tipologie ?? []}
          tipologieDisponibili={tipologieDisponibili}
          sampleValues={sampleValues}
          canEdit={canEdit}
          area="zoo"
        />

        {scopeLayouts.length > 0 && (
          <div className="section">
            <div className="section-head"><h2>I tuoi layout salvati</h2></div>
            <div className="card table-wrap">
              <table className="data">
                <thead><tr><th>Formato</th><th>Nome</th><th>Tag collegati</th><th>Campi</th><th></th></tr></thead>
                <tbody>
                  {db.zooLayouts.filter((l) => l.scopeType === scope.type && l.scopeId === scope.id).map((l) => {
                    const f = ZOO_FORMATS.find((x) => x.id === l.formatId);
                    return (
                      <tr key={l.id}>
                        <td>
                          <a href={`?formato=${l.formatId}&layout=${l.id}&scope=${scopeParam}`}>{f?.name}</a>
                        </td>
                        <td style={{ fontSize: 13 }}>{l.nome || "—"}</td>
                        <td style={{ fontSize: 13 }}>{l.tipologie.length ? l.tipologie.join(", ") : "Tutti"}</td>
                        <td>{l.items.length}</td>
                        <td>
                          <form action={deleteZooLayout.bind(null, l.id, scopeParam)}>
                            <button className="btn btn-outline btn-sm" type="submit" style={{ color: "var(--red)", borderColor: "var(--red)" }}>Elimina</button>
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
