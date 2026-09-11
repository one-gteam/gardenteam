import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import StampeHeader from "@/components/stampe/StampeHeader";
import RepartoCheck, { type VoceReparto } from "@/components/stampe/RepartoCheck";
import { canAccessArea, resolveScope, scopesForUser } from "@/lib/stampe";
import {
  getZooDb, campagnaPerStampa, offertePerStampa, effectiveParentText, effectiveParentTag, isZooHidden, marcaEffettiva,
  noPrintSets, printedAt, ZOO_FIELDS, ZOO_FORMATS,
} from "@/lib/zoo";

/**
 * Controllo in reparto: la versione da cellulare di Stampa cartelli. Un
 * cartello alla volta, davanti allo scaffale, per verificare prezzi e
 * promozione, correggere e mandare in coda di stampa.
 */
export default async function ZooRepartoPage({
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
  const campaign = campagnaPerStampa(db, sp.campagna);
  const allOffers = offertePerStampa(db, scope, academyDb, campaign);
  const noPrint = noPrintSets(db, scope);
  const coda = db.coda.filter((c) => c.scopeType === scope.type && c.scopeId === scope.id && !c.stampato);
  const q = (sp.q ?? "").toLowerCase();

  // una voce per prodotto padre (l'offerta rappresentante), come in Stampa cartelli
  const gruppi = new Map<string, typeof allOffers>();
  for (const o of allOffers) {
    const product = db.products.find((p) => p.id === o.productId);
    if (product && isZooHidden(db, scope, product, academyDb)) continue;
    const key = product?.parentId ? `p:${product.parentId}` : `o:${o.id}`;
    gruppi.set(key, [...(gruppi.get(key) ?? []), o]);
  }
  const voci: VoceReparto[] = [...gruppi.entries()].map(([key, gruppo]) => {
    const o = gruppo[0];
    const product = db.products.find((p) => p.id === o.productId);
    const parent = key.startsWith("p:") ? db.parents.find((x) => x.id === key.slice(2)) : undefined;
    const nome = parent ? effectiveParentText(db, scope, parent, "nome", academyDb).value || o.descrizione : o.descrizione;
    const animale = parent ? effectiveParentTag(db, scope, parent, "animale", academyDb).value : "";
    const inCoda = coda.find((c) => gruppo.some((g) => g.id === c.offerId))?.stato;
    return {
      id: o.id, nome, ean: o.ean, nCodici: gruppo.length,
      marca: marcaEffettiva(product ?? { marca: "", fornitore: "" }), animale,
      inCoda, stampato: !!printedAt(db, scope, o.id),
      escluso: noPrint.offerIds.has(o.id) || noPrint.eans.has(o.ean),
      testo: `${nome} ${o.descrizione} ${o.ean} ${product?.descrizione ?? ""}`.toLowerCase(),
    };
  })
    .filter((v) => !q || v.testo.includes(q))
    .filter((v) => !sp.animale || v.animale.includes(sp.animale))
    .filter((v) => sp.tutti === "1" || (!v.inCoda && !v.stampato && !v.escluso))
    .map(({ testo: _t, ...v }) => v);

  return (
    <div>
      <StampeHeader user={user} active="reparto" area="zoo" />
      <div className="container" style={{ maxWidth: 640 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 22 }}>Controllo in reparto</h1>
            <p className="subtitle" style={{ margin: "2px 0 0" }}>
              {campaign?.nome ?? "Nessun volantino"} · {voci.length} cartelli da controllare
            </p>
          </div>
        </div>
        <form method="get" className="reparto-filtri">
          <select name="scope" defaultValue={scopeParam} title="Insegna / PV">
            {scopes.map((s) => <option key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>{s.label}</option>)}
          </select>
          <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="cerca prodotto o EAN" />
          <select name="animale" defaultValue={sp.animale ?? ""}>
            <option value="">Tutti gli animali</option>
            {db.settings.categorieAnimali.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <label className="hint" style={{ display: "flex", gap: 4, alignItems: "center", whiteSpace: "nowrap" }}>
            <input type="checkbox" name="tutti" value="1" defaultChecked={sp.tutti === "1"} /> anche confermati e stampati
          </label>
          <button className="btn btn-sm" type="submit">Vai</button>
        </form>

        <RepartoCheck
          voci={voci}
          scopeParam={scopeParam}
          scopeType={scope.type}
          scopeLabel={scope.label}
          fields={ZOO_FIELDS}
          formati={ZOO_FORMATS.map((f) => ({ id: f.id, name: f.name }))}
        />
      </div>
    </div>
  );
}
