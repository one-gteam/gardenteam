import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import StampeHeader from "@/components/stampe/StampeHeader";
import LayoutEditor from "@/components/stampe/LayoutEditor";
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
  /**
   * Si possono avere più layout per lo stesso formato, ciascuno collegato a
   * tag diversi (es. uno per "Gatto", uno per "Cane"): quale si sta
   * modificando lo dice il parametro ?tipologie, non solo il formato.
   */
  const tipologieDisponibili = [...db.settings.categorieAnimali, ...db.settings.caratteristicheProdotto];
  const editingTipologie = (sp.tipologie ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const own = db.zooLayouts.find(
    (l) => l.formatId === format.id && l.scopeType === scope.type && l.scopeId === scope.id
      && l.tipologie.join(",") === editingTipologie.join(",")
  );
  const systemLayout = db.zooLayouts.find(
    (l) => l.formatId === format.id && l.scopeType === "system" && l.tipologie.join(",") === editingTipologie.join(",")
  );
  const current = own ?? systemLayout;

  // offerta di esempio per l'anteprima: preferisce un padre con i tag che si stanno modificando
  const campaign = activeCampaign(db);
  const offers = campaign ? db.offers.filter((o) => o.campaignId === campaign.id) : db.offers;
  const sample = editingTipologie.length > 0
    ? offers.find((o) => {
        const product = db.products.find((p) => p.id === o.productId);
        const parent = product?.parentId ? db.parents.find((x) => x.id === product.parentId) : undefined;
        return parent?.caratteristiche.some((c) => editingTipologie.includes(c));
      }) ?? offers[0]
    : offers[0];
  const sampleValues = sample ? zooCartelloValues(db, sample, scope, academyDb) : {};

  const otherLayouts = db.zooLayouts.filter((l) => l.scopeType === scope.type && l.scopeId === scope.id);

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
              {" "}Puoi avere più layout per lo stesso formato: collegane uno a dei tag (es. «Gatto») nel pannello a
              destra, salva, poi passa da un layout all&apos;altro dall&apos;elenco qui sotto.
            </p>
          </div>
          <form method="get" style={{ display: "flex", gap: 8, alignItems: "end" }}>
            <input type="hidden" name="tipologie" value={sp.tipologie ?? ""} />
            <label className="field" style={{ marginBottom: 0 }}>
              Formato
              <select name="formato" defaultValue={format.id}>
                {ZOO_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.w}×{f.h} mm)</option>)}
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
        {editingTipologie.length > 0 && (
          <div className="alert alert-green no-print" style={{ marginBottom: 12 }}>
            Stai modificando il layout collegato a: <strong>{editingTipologie.join(", ")}</strong>.{" "}
            <a href={`/stampe/zoo/layout?formato=${format.id}&scope=${scopeParam}`}>Torna al layout generico</a>
          </div>
        )}

        <LayoutEditor
          key={`${format.id}_${scopeParam}_${editingTipologie.join(",")}_${current?.id ?? "new"}`}
          format={format}
          fields={ZOO_FIELDS}
          initialItems={current?.items ?? []}
          initialItemsNoPhoto={current?.itemsNoPhoto}
          initialBorder={current?.border}
          scopeParam={scopeParam}
          initialTipologie={editingTipologie}
          tipologieDisponibili={tipologieDisponibili}
          sampleValues={sampleValues}
          canEdit={canEdit}
          area="zoo"
        />

        {otherLayouts.length > 0 && (
          <div className="section">
            <div className="section-head"><h2>Layout salvati in questo ambito</h2></div>
            <div className="card table-wrap">
              <table className="data">
                <thead><tr><th>Formato</th><th>Tag collegati</th><th>Campi</th><th></th></tr></thead>
                <tbody>
                  {otherLayouts.map((l) => {
                    const f = ZOO_FORMATS.find((x) => x.id === l.formatId);
                    return (
                      <tr key={l.id}>
                        <td>
                          <a href={`?formato=${l.formatId}&tipologie=${encodeURIComponent(l.tipologie.join(","))}&scope=${scopeParam}`}>
                            {f?.name}
                          </a>
                        </td>
                        <td style={{ fontSize: 13 }}>{l.tipologie.length ? l.tipologie.join(", ") : "Tutti (generico)"}</td>
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
