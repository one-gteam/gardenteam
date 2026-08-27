import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import StampeHeader from "@/components/stampe/StampeHeader";
import LayoutEditor from "@/components/stampe/LayoutEditor";
import { canAccessArea, isZooEditor, scopesForUser, resolveScope } from "@/lib/stampe";
import {
  getZooDb, activeCampaign, effectiveZooLayout, zooCartelloValues, ZOO_FIELDS, ZOO_FORMATS,
} from "@/lib/zoo";

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
  const current = effectiveZooLayout(db, scope, format.id);
  const own = db.zooLayouts.some(
    (l) => l.formatId === format.id && l.scopeType === scope.type && l.scopeId === scope.id
  );

  // offerta di esempio per l'anteprima: la prima della campagna attiva
  const campaign = activeCampaign(db);
  const sample = campaign ? db.offers.find((o) => o.campaignId === campaign.id) : db.offers[0];
  const sampleValues = sample ? zooCartelloValues(db, sample) : {};

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
            </p>
          </div>
          <form method="get" style={{ display: "flex", gap: 8, alignItems: "end" }}>
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

        <LayoutEditor
          key={`${format.id}_${scopeParam}_${current.id}`}
          format={format}
          fields={ZOO_FIELDS}
          initialItems={current.items}
          initialBorder={current.border}
          scopeParam={scopeParam}
          initialTipologie={[]}
          tipologieDisponibili={[]}
          sampleValues={sampleValues}
          canEdit={canEdit}
          area="zoo"
        />
      </div>
    </div>
  );
}
